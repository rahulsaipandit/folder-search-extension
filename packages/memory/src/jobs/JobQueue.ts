import type { BackgroundJob, JobStatus, JobType } from '../types'

/**
 * In-memory background job queue (Phase 1 - mobile/web).
 *
 * Design (from GBrain Minions pattern + Smriti):
 *   - Time-boxed: each job has a budgetMs; executor cancels overruns
 *   - Max 2 parallel jobs (mobile default)
 *   - Exponential backoff: delay = 2^retryCount × 1000ms (max 3 retries)
 *   - Job handlers registered per JobType
 *
 * Phase 3 (desktop) will replace this with a Postgres-native durable queue.
 */

export type JobHandler = (job: BackgroundJob) => Promise<void>

export interface JobQueueConfig {
	maxParallel?: number // default 2
	defaultBudgetMs?: number // default 5000
}

export class JobQueue {
	private readonly handlers = new Map<JobType, JobHandler>()
	private readonly pending: BackgroundJob[] = []
	private running = 0
	private readonly maxParallel: number
	private readonly defaultBudgetMs: number
	private readonly history: BackgroundJob[] = []
	private readonly MAX_HISTORY = 100

	constructor(config: JobQueueConfig = {}) {
		this.maxParallel = config.maxParallel ?? 2
		this.defaultBudgetMs = config.defaultBudgetMs ?? 5_000
	}

	/** Register a handler for a job type. */
	register(type: JobType, handler: JobHandler): void {
		this.handlers.set(type, handler)
	}

	/** Enqueue a new job. Returns the job ID. */
	enqueue(
		type: JobType,
		options: Partial<Pick<BackgroundJob, 'priority' | 'inputRefs' | 'budgetMs'>> = {}
	): string {
		const job: BackgroundJob = {
			id: generateId(),
			type,
			priority: options.priority ?? 0,
			status: 'pending',
			inputRefs: options.inputRefs ?? [],
			budgetMs: options.budgetMs ?? this.defaultBudgetMs,
			retryCount: 0,
			scheduledAt: new Date().toISOString(),
		}

		// Insert sorted by priority (descending)
		const insertAt = this.pending.findIndex((j) => j.priority < job.priority)
		if (insertAt >= 0) {
			this.pending.splice(insertAt, 0, job)
		} else {
			this.pending.push(job)
		}

		this.drain()
		return job.id
	}

	/** Get current queue stats. */
	get stats(): { pending: number; running: number; completed: number; failed: number } {
		const completed = this.history.filter((j) => j.status === 'completed').length
		const failed = this.history.filter((j) => j.status === 'failed').length
		return { pending: this.pending.length, running: this.running, completed, failed }
	}

	// ── Internal ───────────────────────────────────────────────────────────────

	private drain(): void {
		while (this.running < this.maxParallel && this.pending.length > 0) {
			const job = this.pending.shift()!
			this.running++
			this.executeJob(job).finally(() => {
				this.running--
				this.drain()
			})
		}
	}

	private async executeJob(job: BackgroundJob): Promise<void> {
		const handler = this.handlers.get(job.type)
		if (!handler) {
			job.status = 'failed'
			job.error = `No handler registered for job type: ${job.type}`
			this.archive(job)
			return
		}

		job.status = 'running'
		job.startedAt = new Date().toISOString()

		// Time-box execution
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Job timeout after ${job.budgetMs}ms`)), job.budgetMs)
		)

		try {
			await Promise.race([handler(job), timeout])
			job.status = 'completed'
			job.completedAt = new Date().toISOString()
		} catch (err) {
			job.status = 'failed'
			job.error = String(err)
			job.retryCount++

			// Retry with exponential backoff (max 3 retries)
			if (job.retryCount <= 3) {
				const delay = Math.pow(2, job.retryCount) * 1000
				await new Promise((resolve) => setTimeout(resolve, delay))
				job.status = 'pending'
				this.pending.push(job)
				this.drain()
				return
			}
		}

		this.archive(job)
	}

	private archive(job: BackgroundJob): void {
		this.history.push(job)
		if (this.history.length > this.MAX_HISTORY) {
			this.history.splice(0, this.history.length - this.MAX_HISTORY)
		}
	}
}

function generateId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
