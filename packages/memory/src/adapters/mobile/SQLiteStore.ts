/**
 * SQLiteStore - mobile adapter for IMemoryStore
 *
 * Uses @op-engineering/op-sqlite for persistent storage on React Native / Expo.
 * Ported from GA's production MemoryStore.native.ts with CB interface adaptations:
 *   - putRelation accepts { sourceId, ...relation } (flat object, not (id, relation))
 *   - delete supports soft-delete (purge = false) vs. hard-delete (purge = true)
 *   - MemoryFilter supports lifecycleState and ids predicates
 *   - MemoryEntry columns extended: lifecycle_state, retention_policy, retrieval_count,
 *     compression_level, synthesis_quality, synthesized_at, linked_procedure_ids
 *   - close() releases the DB connection
 */

import { open, type DB } from '@op-engineering/op-sqlite'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry, MemoryFilter, MemoryRelation } from '../../types'

const DB_NAME = 'cb_memory.db'

export class SQLiteStore implements IMemoryStore {
	private db: DB | null = null
	private initialized = false

	constructor(private dbName: string = DB_NAME) {}

	// ── Lifecycle ────────────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.initialized) return

		try {
			this.db = open({ name: this.dbName })
			await this.createTables()
			this.initialized = true
			console.log('[SQLiteStore] Initialized SQLite successfully')
		} catch (error) {
			console.error('[SQLiteStore] Initialization failed:', error)
			throw error
		}
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db.close()
			this.db = null
			this.initialized = false
		}
	}

	private async createTables(): Promise<void> {
		if (!this.db) throw new Error('Database not open')

		// ── memories ─────────────────────────────────────────────────────────────
		this.db.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id                  TEXT PRIMARY KEY,
        type                TEXT NOT NULL,
        title               TEXT,
        content             TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT,
        tags                TEXT,
        entities            TEXT,
        importance          INTEGER,
        confidence          REAL,
        salience            REAL,
        outcome             TEXT,
        source_ids          TEXT,
        relations           TEXT,
        user_id             TEXT,
        agent_id            TEXT,
        session_id          TEXT,
        metadata            TEXT,
        lifecycle_state     TEXT DEFAULT 'active',
        retention_policy    TEXT,
        retrieval_count     INTEGER DEFAULT 0,
        compression_level   INTEGER DEFAULT 0,
        synthesis_quality   TEXT,
        synthesized_at      TEXT,
        linked_procedure_ids TEXT
      )
    `)

		// Migrations: add columns that may be missing in older DBs
		const alterColumns = [
			`ALTER TABLE memories ADD COLUMN salience REAL`,
			`ALTER TABLE memories ADD COLUMN outcome TEXT`,
			`ALTER TABLE memories ADD COLUMN lifecycle_state TEXT DEFAULT 'active'`,
			`ALTER TABLE memories ADD COLUMN retention_policy TEXT`,
			`ALTER TABLE memories ADD COLUMN retrieval_count INTEGER DEFAULT 0`,
			`ALTER TABLE memories ADD COLUMN compression_level INTEGER DEFAULT 0`,
			`ALTER TABLE memories ADD COLUMN synthesis_quality TEXT`,
			`ALTER TABLE memories ADD COLUMN synthesized_at TEXT`,
			`ALTER TABLE memories ADD COLUMN linked_procedure_ids TEXT`,
		]
		for (const sql of alterColumns) {
			try {
				this.db.execute(sql)
			} catch {
				/* column already exists - safe to ignore */
			}
		}

		// Indexes
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_type       ON memories(type)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_user       ON memories(user_id)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_agent      ON memories(agent_id)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_session    ON memories(session_id)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_created    ON memories(created_at)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_lifecycle  ON memories(lifecycle_state)')

		// ── memory_relations ──────────────────────────────────────────────────────
		this.db.execute(`
      CREATE TABLE IF NOT EXISTS memory_relations (
        id            TEXT PRIMARY KEY,
        from_id       TEXT NOT NULL,
        to_id         TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight        REAL,
        metadata      TEXT,
        created_at    TEXT NOT NULL
      )
    `)

		this.db.execute('CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id)')
		this.db.execute('CREATE INDEX IF NOT EXISTS idx_relations_to   ON memory_relations(to_id)')

		// ── pipeline_retries ──────────────────────────────────────────────────────
		this.db.execute(`
      CREATE TABLE IF NOT EXISTS pipeline_retries (
        id              TEXT PRIMARY KEY,
        entry_id        TEXT NOT NULL,
        processor_name  TEXT NOT NULL,
        attempt_count   INTEGER DEFAULT 0,
        last_error      TEXT,
        created_at      TEXT NOT NULL,
        last_attempt_at TEXT,
        status          TEXT DEFAULT 'pending'
      )
    `)

		// ── pruning_state ─────────────────────────────────────────────────────────
		this.db.execute(`
      CREATE TABLE IF NOT EXISTS pruning_state (
        id                        INTEGER PRIMARY KEY,
        last_daily_summary_date   TEXT,
        last_weekly_summary_date  TEXT,
        last_monthly_summary_date TEXT
      )
    `)

		// ── working_memory ────────────────────────────────────────────────────────
		this.db.execute(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entry_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )
    `)

		this.db.execute('CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id)')
	}

	// ── CRUD ─────────────────────────────────────────────────────────────────────

	async put(entry: MemoryEntry): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute(
			`INSERT OR REPLACE INTO memories
       (id, type, title, content, created_at, updated_at,
        tags, entities, importance, confidence, salience, outcome,
        source_ids, relations, user_id, agent_id, session_id, metadata,
        lifecycle_state, retention_policy, retrieval_count, compression_level,
        synthesis_quality, synthesized_at, linked_procedure_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.type,
				entry.title ?? null,
				entry.content,
				entry.createdAt,
				entry.updatedAt ?? null,
				JSON.stringify(entry.tags ?? []),
				JSON.stringify(entry.entities ?? []),
				entry.importance ?? null,
				entry.confidence ?? null,
				entry.salience ?? null,
				entry.outcome ?? null,
				JSON.stringify(entry.sourceIds ?? []),
				JSON.stringify(entry.relations ?? []),
				entry.userId ?? null,
				entry.agentId ?? null,
				entry.sessionId ?? null,
				JSON.stringify(entry.metadata ?? {}),
				entry.lifecycleState ?? 'active',
				entry.retentionPolicy ?? null,
				entry.retrievalCount ?? 0,
				entry.compressionLevel ?? 0,
				entry.synthesisQuality ?? null,
				entry.synthesizedAt ?? null,
				JSON.stringify(entry.linkedProcedureIds ?? []),
			],
		)
	}

	async get(id: string): Promise<MemoryEntry | null> {
		if (!this.db) throw new Error('Store not initialized')

		const result = await this.db.execute('SELECT * FROM memories WHERE id = ?', [id])

		if (!result.rows || result.rows.length === 0) return null

		return this.mapRowToEntry(result.rows[0])
	}

	/**
	 * Soft-delete (default): sets lifecycle_state = 'deleted'.
	 * Hard-delete (purge = true): removes the row entirely.
	 */
	async delete(id: string, purge = false): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		if (purge) {
			await this.db.execute('DELETE FROM memories WHERE id = ?', [id])
		} else {
			await this.db.execute(
				`UPDATE memories SET lifecycle_state = 'deleted', updated_at = ? WHERE id = ?`,
				[new Date().toISOString(), id],
			)
		}
	}

	async putMany(entries: MemoryEntry[]): Promise<void> {
		for (const entry of entries) {
			await this.put(entry)
		}
	}

	async deleteMany(ids: string[]): Promise<void> {
		for (const id of ids) {
			// Hard-delete for bulk operations
			await this.delete(id, true)
		}
	}

	async query(
		filter: MemoryFilter,
		limit = 100,
		cursor?: string,
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }> {
		if (!this.db) throw new Error('Store not initialized')

		const { whereClause, params } = this.buildWhereClause(filter, cursor)

		const sql = `
      SELECT * FROM memories
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `

		const result = await this.db.execute(sql, [...params, limit + 1])
		const rows = (result.rows ?? []) as any[]
		const entries = rows.map(row => this.mapRowToEntry(row))

		const nextCursor =
			entries.length > limit ? this.encodeCursor(entries[limit - 1]) : null

		return {
			entries: entries.slice(0, limit),
			cursor: nextCursor,
		}
	}

	async count(filter?: MemoryFilter): Promise<number> {
		if (!this.db) throw new Error('Store not initialized')

		const { whereClause, params } = this.buildWhereClause(filter ?? {})
		const result = await this.db.execute(
			`SELECT COUNT(*) as cnt FROM memories ${whereClause}`,
			params,
		)
		return (result.rows as any[])?.[0]?.cnt ?? 0
	}

	// ── Relations ────────────────────────────────────────────────────────────────

	async getRelations(entryId: string): Promise<MemoryRelation[]> {
		if (!this.db) throw new Error('Store not initialized')

		const result = await this.db.execute(
			'SELECT * FROM memory_relations WHERE from_id = ?',
			[entryId],
		)

		const rows = (result.rows ?? []) as Array<{
			to_id: string
			relation_type: string
			weight: number | null
			metadata: string | null
		}>

		return rows.map(row => ({
			targetId: String(row.to_id),
			type: row.relation_type as MemoryRelation['type'],
			weight: row.weight ?? undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}))
	}

	/** CB interface: putRelation({ sourceId, targetId, type, weight?, metadata? }) */
	async putRelation(relation: MemoryRelation & { sourceId: string }): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		const relationId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

		await this.db.execute(
			`INSERT OR REPLACE INTO memory_relations
       (id, from_id, to_id, relation_type, weight, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				relationId,
				relation.sourceId,
				relation.targetId,
				relation.type,
				relation.weight ?? null,
				relation.metadata ? JSON.stringify(relation.metadata) : null,
				new Date().toISOString(),
			],
		)
	}

	async deleteRelation(sourceId: string, targetId: string): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute(
			'DELETE FROM memory_relations WHERE from_id = ? AND to_id = ?',
			[sourceId, targetId],
		)
	}

	// ── Full reset ───────────────────────────────────────────────────────────────

	async clear(): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute('DELETE FROM memories')
		await this.db.execute('DELETE FROM memory_relations')
		await this.db.execute('DELETE FROM pipeline_retries')
		await this.db.execute('DELETE FROM working_memory')
	}

	// ── Private helpers ───────────────────────────────────────────────────────────

	private buildWhereClause(
		filter: MemoryFilter,
		cursor?: string,
	): { whereClause: string; params: any[] } {
		const conditions: string[] = []
		const params: any[] = []

		// type - scalar or array
		if (filter.type) {
			const types = Array.isArray(filter.type) ? filter.type : [filter.type]
			if (types.length > 0) {
				conditions.push(`type IN (${types.map(() => '?').join(',')})`)
				params.push(...types)
			}
		}

		// ids - explicit ID list
		if (filter.ids && filter.ids.length > 0) {
			conditions.push(`id IN (${filter.ids.map(() => '?').join(',')})`)
			params.push(...filter.ids)
		}

		// lifecycleState filter
		if (filter.lifecycleState) {
			const states = Array.isArray(filter.lifecycleState)
				? filter.lifecycleState
				: [filter.lifecycleState]
			if (states.length > 0) {
				conditions.push(`lifecycle_state IN (${states.map(() => '?').join(',')})`)
				params.push(...states)
			}
		} else {
			// By default exclude soft-deleted entries
			conditions.push(`lifecycle_state != 'deleted'`)
		}

		// tags
		if (filter.tags && filter.tags.length > 0) {
			if (filter.tagMatchMode === 'any') {
				const orClauses = filter.tags.map(() => 'tags LIKE ?').join(' OR ')
				conditions.push(`(${orClauses})`)
				for (const tag of filter.tags) params.push(`%"${tag}"%`)
			} else {
				// AND (default)
				for (const tag of filter.tags) {
					conditions.push('tags LIKE ?')
					params.push(`%"${tag}"%`)
				}
			}
		}

		if (filter.minImportance !== undefined) {
			conditions.push('importance >= ?')
			params.push(filter.minImportance)
		}

		if (filter.minSalience !== undefined) {
			conditions.push('COALESCE(salience, importance, 0) >= ?')
			params.push(filter.minSalience)
		}

		if (filter.outcome && filter.outcome.length > 0) {
			conditions.push(`outcome IN (${filter.outcome.map(() => '?').join(',')})`)
			params.push(...filter.outcome)
		}

		if (filter.timeRange?.start) {
			conditions.push('created_at >= ?')
			params.push(filter.timeRange.start)
		}

		if (filter.timeRange?.end) {
			conditions.push('created_at <= ?')
			params.push(filter.timeRange.end)
		}

		if (filter.userId) {
			conditions.push('user_id = ?')
			params.push(filter.userId)
		}

		if (filter.agentId) {
			conditions.push('agent_id = ?')
			params.push(filter.agentId)
		}

		if (filter.sessionId) {
			conditions.push('session_id = ?')
			params.push(filter.sessionId)
		}

		// Cursor-based pagination: composite (created_at DESC, id DESC)
		if (cursor) {
			const decoded = this.decodeCursor(cursor)
			if (decoded) {
				conditions.push('(created_at < ? OR (created_at = ? AND id < ?))')
				params.push(decoded.createdAt, decoded.createdAt, decoded.id)
			}
		}

		const whereClause =
			conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

		return { whereClause, params }
	}

	private mapRowToEntry(row: any): MemoryEntry {
		return {
			id: row.id,
			type: row.type,
			title: row.title ?? undefined,
			content: row.content,
			createdAt: row.created_at,
			updatedAt: row.updated_at ?? undefined,
			tags: row.tags ? JSON.parse(row.tags) : [],
			entities: row.entities ? JSON.parse(row.entities) : [],
			importance: row.importance ?? undefined,
			confidence: row.confidence ?? undefined,
			salience: row.salience ?? undefined,
			outcome: row.outcome ?? undefined,
			sourceIds: row.source_ids ? JSON.parse(row.source_ids) : [],
			relations: row.relations ? JSON.parse(row.relations) : [],
			userId: row.user_id ?? undefined,
			agentId: row.agent_id ?? undefined,
			sessionId: row.session_id ?? undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : {},
			lifecycleState: row.lifecycle_state ?? 'active',
			retentionPolicy: row.retention_policy ?? undefined,
			retrievalCount: row.retrieval_count ?? 0,
			compressionLevel: row.compression_level ?? 0,
			synthesisQuality: row.synthesis_quality ?? undefined,
			synthesizedAt: row.synthesized_at ?? undefined,
			linkedProcedureIds: row.linked_procedure_ids
				? JSON.parse(row.linked_procedure_ids)
				: [],
		}
	}

	private encodeCursor(entry: MemoryEntry): string {
		return Buffer.from(
			JSON.stringify({ c: entry.createdAt, i: entry.id }),
		).toString('base64')
	}

	private decodeCursor(cursor: string): { createdAt: string; id: string } | null {
		try {
			const { c, i } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
			return { createdAt: c, id: i }
		} catch {
			return null
		}
	}
}

export default SQLiteStore
