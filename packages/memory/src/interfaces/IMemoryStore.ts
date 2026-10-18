import type { MemoryEntry, MemoryFilter, MemoryRelation } from '../types'

/**
 * Low-level key-value store for MemoryEntry persistence.
 * Implementations: IndexedDBStore (web), SQLiteStore (mobile), PGLiteStore (desktop).
 * The upper layers never know which backend is active.
 */
export interface IMemoryStore {
	/** Retrieve a single entry by ID. Returns null if not found. */
	get(id: string): Promise<MemoryEntry | null>

	/** Persist (insert or overwrite) an entry. */
	put(entry: MemoryEntry): Promise<void>

	/** Soft-delete: marks lifecycleState = 'deleted'. Hard-delete if purge = true. */
	delete(id: string, purge?: boolean): Promise<void>

	/**
	 * Query entries matching the filter.
	 * When limit and/or cursor are provided, returns a page object with cursor-based pagination.
	 * When called without limit/cursor, returns all matches wrapped in the same page shape.
	 */
	query(
		filter: MemoryFilter,
		limit?: number,
		cursor?: string,
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }>

	/** Bulk write - used by synthesis pipeline for batch inserts. */
	putMany(entries: MemoryEntry[]): Promise<void>

	/** Bulk delete by IDs. Hard-deletes all specified entries. */
	deleteMany(ids: string[]): Promise<void>

	/** Count total entries (optionally filtered). */
	count(filter?: MemoryFilter): Promise<number>

	// -- Relations --------------------------------------------------------------

	/** Retrieve all relations stored on an entry. */
	getRelations(entryId: string): Promise<MemoryRelation[]>

	/** Persist a relation on an entry (upsert by sourceId + targetId + type). */
	putRelation(relation: MemoryRelation & { sourceId: string }): Promise<void>

	/** Remove a specific relation by source and target IDs. */
	deleteRelation(sourceId: string, targetId: string): Promise<void>

	// -- Lifecycle --------------------------------------------------------------

	/** Initialise the store (create tables/stores/indexes). Idempotent. */
	initialize(): Promise<void>

	/** Release resources (close connections). */
	close(): Promise<void>

	/** Wipe all stored entries and relations. Used for testing and full reset. */
	clear(): Promise<void>
}
