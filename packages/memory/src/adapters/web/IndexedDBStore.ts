import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { LifecycleState, MemoryEntry, MemoryFilter, MemoryRelation, MemoryType } from '../../types'

/**
 * IndexedDB-backed MemoryStore for web and browser extension environments.
 * Uses the `idb` library (already a monorepo dependency).
 *
 * Object stores:
 *   - entries: MemoryEntry by id
 *   - tags:    MemoryEntry by tag (multi-entry index)
 */

const DB_NAME = 'page-agent-memory'
const DB_VERSION = 1
const STORE_ENTRIES = 'entries'
const STORE_RELATIONS = 'relations'

interface StoredRelation extends MemoryRelation {
	sourceId: string
	id: string
}

interface MemoryDBSchema extends DBSchema {
	entries: {
		key: string
		value: MemoryEntry
		indexes: {
			by_type: MemoryType
			by_session: string
			by_lifecycle: LifecycleState
			by_salience: number
			by_created: string
		}
	}
	relations: {
		key: string // composite: `${sourceId}:${targetId}:${type}`
		value: StoredRelation
		indexes: {
			by_source: string
		}
	}
}

export class IndexedDBStore implements IMemoryStore {
	private db: IDBPDatabase<MemoryDBSchema> | null = null
	private readonly dbName: string

	constructor(dbName = DB_NAME) {
		this.dbName = dbName
	}

	async initialize(): Promise<void> {
		if (this.db) return

		this.db = await openDB<MemoryDBSchema>(this.dbName, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
					const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' })
					store.createIndex('by_type', 'type')
					store.createIndex('by_session', 'sessionId')
					store.createIndex('by_lifecycle', 'lifecycleState')
					store.createIndex('by_salience', 'salience')
					store.createIndex('by_created', 'createdAt')
				}
			},
		})
	}

	private ensureDb(): IDBPDatabase<MemoryDBSchema> {
		if (!this.db) throw new Error('[IndexedDBStore] Not initialized. Call initialize() first.')
		return this.db
	}

	async get(id: string): Promise<MemoryEntry | null> {
		const entry = await this.ensureDb().get(STORE_ENTRIES, id)
		return entry ?? null
	}

	async put(entry: MemoryEntry): Promise<void> {
		await this.ensureDb().put(STORE_ENTRIES, entry)
	}

	async putMany(entries: MemoryEntry[]): Promise<void> {
		const db = this.ensureDb()
		const tx = db.transaction(STORE_ENTRIES, 'readwrite')
		await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done])
	}

	async delete(id: string, purge = false): Promise<void> {
		if (purge) {
			await this.ensureDb().delete(STORE_ENTRIES, id)
		} else {
			const entry = await this.get(id)
			if (entry) {
				entry.lifecycleState = 'deleted'
				entry.updatedAt = new Date().toISOString()
				await this.put(entry)
			}
		}
	}

	async query(
		filter: MemoryFilter,
		limit?: number,
		cursor?: string,
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }> {
		const db = this.ensureDb()
		let entries: MemoryEntry[]

		// Use index when possible for performance
		if (filter.sessionId) {
			entries = await db.getAllFromIndex(STORE_ENTRIES, 'by_session', filter.sessionId)
		} else if (filter.lifecycleState && !Array.isArray(filter.lifecycleState)) {
			entries = await db.getAllFromIndex(STORE_ENTRIES, 'by_lifecycle', filter.lifecycleState)
		} else if (filter.type && !Array.isArray(filter.type)) {
			entries = await db.getAllFromIndex(STORE_ENTRIES, 'by_type', filter.type)
		} else {
			entries = await db.getAll(STORE_ENTRIES)
		}

		// Apply filter predicates
		let matched = entries.filter((e) => matchesFilter(e, filter))

		// Sort by createdAt descending for stable cursor pagination
		matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

		// Apply cursor (skip entries created at or after cursor timestamp:id)
		if (cursor) {
			const [cursorTs, cursorId] = cursor.split('::')
			const idx = matched.findIndex(
				(e) => e.createdAt < cursorTs || (e.createdAt === cursorTs && e.id === cursorId),
			)
			matched = idx >= 0 ? matched.slice(idx) : []
		}

		// Apply limit
		let nextCursor: string | null = null
		if (limit !== undefined && matched.length > limit) {
			matched = matched.slice(0, limit)
			const last = matched[matched.length - 1]
			nextCursor = `${last.createdAt}::${last.id}`
		}

		return { entries: matched, cursor: nextCursor }
	}

	async count(filter?: MemoryFilter): Promise<number> {
		if (!filter || Object.keys(filter).length === 0) {
			return this.ensureDb().count(STORE_ENTRIES)
		}
		const { entries } = await this.query(filter)
		return entries.length
	}

	async deleteMany(ids: string[]): Promise<void> {
		const db = this.ensureDb()
		const tx = db.transaction(STORE_ENTRIES, 'readwrite')
		await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
	}

	async clear(): Promise<void> {
		const db = this.ensureDb()
		const tx = db.transaction([STORE_ENTRIES, STORE_RELATIONS], 'readwrite')
		await Promise.all([tx.objectStore(STORE_ENTRIES).clear(), tx.objectStore(STORE_RELATIONS).clear(), tx.done])
	}

	async getRelations(entryId: string): Promise<MemoryRelation[]> {
		const raw = await this.ensureDb().getAllFromIndex(STORE_RELATIONS, 'by_source', entryId)
		// Strip the internal `sourceId` field before returning the public MemoryRelation shape
		return raw.map(({ sourceId: _sourceId, ...rel }) => rel as MemoryRelation)
	}

	async putRelation(relation: MemoryRelation & { sourceId: string }): Promise<void> {
		const id = `${relation.sourceId}::${relation.targetId}::${relation.type}`
		await this.ensureDb().put(STORE_RELATIONS, { ...relation, id })
	}

	async deleteRelation(sourceId: string, targetId: string): Promise<void> {
		// Remove all relation records matching sourceId + targetId (any type)
		const all = await this.ensureDb().getAllFromIndex(STORE_RELATIONS, 'by_source', sourceId)
		const toDelete = all.filter((r) => r.targetId === targetId)
		const db = this.ensureDb()
		await Promise.all(toDelete.map((r) => db.delete(STORE_RELATIONS, `${r.sourceId}::${r.targetId}::${r.type}`)))
	}

	async close(): Promise<void> {
		this.db?.close()
		this.db = null
	}
}

// ── Filter matching ────────────────────────────────────────────────────────────

function matchesFilter(entry: MemoryEntry, filter: MemoryFilter): boolean {
	if (filter.ids && !filter.ids.includes(entry.id)) return false

	if (filter.type) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type]
		if (!types.includes(entry.type)) return false
	}

	if (filter.lifecycleState) {
		const states = Array.isArray(filter.lifecycleState)
			? filter.lifecycleState
			: [filter.lifecycleState]
		if (!states.includes(entry.lifecycleState ?? 'active')) return false
	}

	if (filter.sessionId && entry.sessionId !== filter.sessionId) return false
	if (filter.userId && entry.userId !== filter.userId) return false
	if (filter.agentId && entry.agentId !== filter.agentId) return false

	if (filter.minSalience !== undefined) {
		if ((entry.salience ?? 0) < filter.minSalience) return false
	}

	if (filter.minImportance !== undefined) {
		if ((entry.importance ?? 0) < filter.minImportance) return false
	}

	if (filter.outcome && filter.outcome.length > 0) {
		if (!entry.outcome || !filter.outcome.includes(entry.outcome)) return false
	}

	if (filter.timeRange) {
		const ts = entry.createdAt
		if (filter.timeRange.start && ts < filter.timeRange.start) return false
		if (filter.timeRange.end && ts > filter.timeRange.end) return false
	}

	if (filter.maxAge !== undefined) {
		const age = Date.now() - new Date(entry.createdAt).getTime()
		if (age > filter.maxAge) return false
	}

	if (filter.tags && filter.tags.length > 0) {
		const entryTags = new Set(entry.tags ?? [])
		const mode = filter.tagMatchMode ?? 'all'
		if (mode === 'all') {
			if (!filter.tags.every((t) => entryTags.has(t))) return false
		} else {
			if (!filter.tags.some((t) => entryTags.has(t))) return false
		}
	}

	return true
}
