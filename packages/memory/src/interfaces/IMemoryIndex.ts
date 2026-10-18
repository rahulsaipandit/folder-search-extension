import type { IndexResult, IndexSearchOptions, MemoryEntry } from '../types'

/**
 * Semantic + keyword search index.
 * Implementations: OramaIndex (web/mobile), PgVectorIndex (desktop).
 * The upper layers never know whether the backend is in-process or a database.
 */
export interface IMemoryIndex {
	/** Add or update an entry in the index. */
	index(entry: MemoryEntry): Promise<void>

	/** Remove an entry from the index. */
	remove(id: string): Promise<void>

	/** Hybrid search (vector + BM25 fused with RRF). */
	search(query: string, options?: IndexSearchOptions): Promise<IndexResult[]>

	/** Bulk index - used after initial load or migration. */
	indexMany(entries: MemoryEntry[]): Promise<void>

	/** Initialise the index backend. Idempotent. */
	initialize(): Promise<void>

	/** Release resources. */
	close(): Promise<void>
}
