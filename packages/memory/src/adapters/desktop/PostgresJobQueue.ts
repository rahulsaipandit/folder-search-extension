import { JobQueue } from '../../jobs/JobQueue'
import type { JobHandler } from '../../jobs/JobQueue'
import type { BackgroundJob, JobStatus, JobType } from '../../types'

/**
 * PostgresJobQueue - durable background job queue backed by a Postgres table.
 *
 * Uses `pg` package via dynamic import for browser tree-shaking.
 * Gracefully falls back to the in-memory JobQueue when `pg` is not installed
 * or the database is unreachable.
 *
 * Schema (auto-created on initialize()):
 *   CREATE TABLE page_agent_jobs (
 *     id            TEXT PRIMARY KEY,
 *     type          TEXT NOT NULL,
 *     status        TEXT NOT NULL DEFAULT 'pending',
 *     priority      INTEGER NOT NULL DEFAULT 5,
 *     input_refs    TEXT NOT NULL DEFAULT '[]',
 *     budget_ms     INTEGER NOT NULL DEFAULT 5000,
 *     retry_count   INTEGER NOT NULL DEFAULT 0,
 *     max_retries   INTEGER NOT NULL DEFAULT 3,
 *     scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     started_at    TIMESTAMPTZ,
 *     completed_at  TIMESTAMPTZ,
 *     error         TEXT
 *   );
 *
 * Concurrent-safe job claiming uses SELECT ... FOR UPDATE SKIP LOCKED.
 * Retry uses exponential backoff: retry_delay_ms = 1000 * 2^retry_count.
 */

export interface PostgresJobQueueConfig {
	connectionString: string
	tableName?: string // default: 'page_agent_jobs'
	pollIntervalMs?: number // default: 2000
	maxParallel?: number // default: 4
	budgetMs?: number // default: 30_000
}

// Minimal interface for the pg Pool we'll use dynamically
interface PgPool {
	query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
	end(): Promise<void>
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS {TABLE} (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  priority      INTEGER NOT NULL DEFAULT 5,
  input_refs    TEXT NOT NULL DEFAULT '[]',
  budget_ms     INTEGER NOT NULL DEFAULT 5000,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 3,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_{TABLE_SAFE}_status_priority
  ON {TABLE}(status, priority DESC, scheduled_at ASC);
`.trim()

export class PostgresJobQueue {
	private readonly connectionString: string
	private readonly tableName: string
	private readonly pollIntervalMs: number
	private readonly maxParallel: number
	private readonly budgetMs: number

	private pool: PgPool | null = null
	private fallback: JobQueue | null = null
	private running = 0
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private readonly handlers = new Map<JobType, JobHandler>()
	private isStarted = false

	constructor(config: PostgresJobQueueConfig) {
		this.connectionString = config.connectionString
		this.tableName = config.tableName ?? 'page_agent_jobs'
		this.pollIntervalMs = config.pollIntervalMs ?? 2_000
		this.maxParallel = config.maxParallel ?? 4
		this.budgetMs = config.budgetMs ?? 30_000
	}

	/**
	 * Initialize: create the Postgres table if not exists.
	 * Falls back to in-memory JobQueue if pg is unavailable.
	 */
	async initialize(): Promise<void> {
		try {
			// Dynamic import via Function constructor - avoids TypeScript module resolution
			// requirement while still allowing graceful fallback when pg is not installed.
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			const pg = (await new Function('spec', 'return import(spec)')('pg')) as {
				default?: { Pool: new (opts: { connectionString: string }) => PgPool }
				Pool?: new (opts: { connectionString: string }) => PgPool
			}
			const Pool = pg.default?.Pool ?? pg.Pool
			if (!Pool) throw new Error('pg.Pool not found')

			this.pool = new Pool({ connectionString: this.connectionString }) as unknown as PgPool

			// Test connection
			await this.pool.query('SELECT 1')

			// Create table
			const tableSafe = this.tableName.replace(/[^a-z0-9_]/gi, '_')
			const sql = CREATE_TABLE_SQL.replace(/\{TABLE\}/g, this.tableName).replace(
				/\{TABLE_SAFE\}/g,
				tableSafe
			)

			// Execute each statement separately (CREATE TABLE and CREATE INDEX)
			for (const stmt of sql
				.split(';')
				.map((s) => s.trim())
				.filter(Boolean)) {
				await this.pool.query(stmt)
			}
		} catch (err) {
			console.warn(
				'[PostgresJobQueue] pg unavailable, falling back to in-memory JobQueue:',
				String(err)
			)
			this.pool = null
			this.fallback = new JobQueue({
				maxParallel: this.maxParallel,
				defaultBudgetMs: this.budgetMs,
			})
		}
	}

	async close(): Promise<void> {
		this.stop()
		if (this.pool) {
			await this.pool.end()
			this.pool = null
		}
	}

	/** Register a handler for a job type. */
	register(type: JobType, handler: JobHandler): void {
		this.handlers.set(type, handler)
		if (this.fallback) {
			this.fallback.register(type, handler)
		}
	}

	/**
	 * Enqueue a new job. Returns the job ID.
	 * Accepts the same shape as BackgroundJob minus auto-assigned fields.
	 */
	async enqueue(
		job: Omit<BackgroundJob, 'id' | 'status' | 'startedAt' | 'completedAt' | 'error'>
	): Promise<string> {
		if (this.fallback) {
			// Fallback: use in-memory queue
			return this.fallback.enqueue(job.type, {
				priority: job.priority,
				inputRefs: job.inputRefs,
				budgetMs: job.budgetMs,
			})
		}

		if (!this.pool) {
			throw new Error('[PostgresJobQueue] Not initialized - call initialize() first')
		}

		const id = generateId()
		const now = new Date().toISOString()

		await this.pool.query(
			`INSERT INTO ${this.tableName}
			 (id, type, status, priority, input_refs, budget_ms, retry_count, max_retries, scheduled_at)
			 VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)`,
			[
				id,
				job.type,
				job.priority ?? 5,
				JSON.stringify(job.inputRefs ?? []),
				job.budgetMs ?? this.budgetMs,
				job.retryCount ?? 0,
				3, // max_retries
				now,
			]
		)

		return id
	}

	/** Start polling for pending jobs. */
	start(): void {
		if (this.isStarted) return
		if (this.fallback) {
			// Fallback queue self-drains - nothing to start
			this.isStarted = true
			return
		}
		this.isStarted = true
		this.pollTimer = setInterval(() => {
			void this.poll()
		}, this.pollIntervalMs)
	}

	/** Stop polling. */
	stop(): void {
		this.isStarted = false
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	// ── Internal ───────────────────────────────────────────────────────────────

	private async poll(): Promise<void> {
		if (!this.pool) return
		if (this.running >= this.maxParallel) return

		const slots = this.maxParallel - this.running
		const jobs = await this.claimJobs(slots)

		for (const job of jobs) {
			this.running++
			this.executeJob(job).finally(() => {
				this.running--
			})
		}
	}

	private async claimJobs(limit: number): Promise<BackgroundJob[]> {
		if (!this.pool) return []

		// SELECT ... FOR UPDATE SKIP LOCKED - concurrent-safe job claiming
		const result = await this.pool.query(
			`UPDATE ${this.tableName}
			 SET status = 'running', started_at = NOW()
			 WHERE id IN (
			   SELECT id FROM ${this.tableName}
			   WHERE status = 'pending'
			     AND scheduled_at <= NOW()
			   ORDER BY priority DESC, scheduled_at ASC
			   LIMIT $1
			   FOR UPDATE SKIP LOCKED
			 )
			 RETURNING *`,
			[limit]
		)

		return result.rows.map(rowToJob)
	}

	private async executeJob(job: BackgroundJob): Promise<void> {
		const handler = this.handlers.get(job.type)
		if (!handler) {
			await this.finalizeJob(job.id, 'failed', `No handler registered for job type: ${job.type}`)
			return
		}

		// Time-box execution
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Job timeout after ${job.budgetMs}ms`)), job.budgetMs)
		)

		try {
			await Promise.race([handler(job), timeout])
			await this.finalizeJob(job.id, 'completed')
		} catch (err) {
			const errMsg = String(err)
			const newRetryCount = job.retryCount + 1

			if (newRetryCount <= 3) {
				// Exponential backoff: 1000 * 2^retryCount ms
				const delayMs = 1000 * Math.pow(2, newRetryCount)
				const retryAt = new Date(Date.now() + delayMs).toISOString()
				await this.rescheduleJob(job.id, newRetryCount, errMsg, retryAt)
			} else {
				await this.finalizeJob(job.id, 'failed', errMsg)
			}
		}
	}

	private async finalizeJob(id: string, status: JobStatus, error?: string): Promise<void> {
		if (!this.pool) return
		const completedAt = new Date().toISOString()

		await this.pool.query(
			`UPDATE ${this.tableName}
			 SET status = $1, completed_at = $2, error = $3
			 WHERE id = $4`,
			[status, completedAt, error ?? null, id]
		)
	}

	private async rescheduleJob(
		id: string,
		retryCount: number,
		error: string,
		scheduledAt: string
	): Promise<void> {
		if (!this.pool) return

		await this.pool.query(
			`UPDATE ${this.tableName}
			 SET status = 'pending', retry_count = $1, error = $2, scheduled_at = $3, started_at = NULL
			 WHERE id = $4`,
			[retryCount, error, scheduledAt, id]
		)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToJob(row: Record<string, unknown>): BackgroundJob {
	return {
		id: (row.id as string | null) ?? '',
		type: ((row.type as string | null) ?? '') as JobType,
		status: ((row.status as string | null) ?? 'pending') as JobStatus,
		priority: Number(row.priority ?? 5),
		inputRefs: parseJsonArray(row.input_refs),
		budgetMs: Number(row.budget_ms ?? 5000),
		retryCount: Number(row.retry_count ?? 0),
		scheduledAt: toISOString(row.scheduled_at),
		startedAt: row.started_at ? toISOString(row.started_at) : undefined,
		completedAt: row.completed_at ? toISOString(row.completed_at) : undefined,
		error: row.error ? String(row.error as string | number) : undefined,
	}
}

function parseJsonArray(value: unknown): string[] {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value)
			return Array.isArray(parsed) ? parsed.map(String) : []
		} catch {
			return []
		}
	}
	return []
}

function toISOString(value: unknown): string {
	if (value instanceof Date) return value.toISOString()
	if (typeof value === 'string') return value
	return new Date().toISOString()
}

function generateId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
