import type {
	ListOptions,
	MemoryEntry,
	MemoryEvent,
	MemoryListPage,
	MemoryRelation,
	MemorySearchPage,
	SearchOptions,
} from '../types'

/**
 * High-level cognitive memory service.
 * The agent runtime and workflow executor interact ONLY with this interface.
 * Implementations compose IMemoryStore + IMemoryIndex + pipeline.
 */
export interface IMemoryService {
	/** Store a new memory entry. Returns the assigned ID. Write succeeds immediately;
	 *  pipeline enrichment (embedding, entity extraction, salience) happens async. */
	create(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string>

	/** Retrieve a single entry. */
	get(id: string): Promise<MemoryEntry | null>

	/** Update fields of an existing entry. */
	update(id: string, patch: Partial<MemoryEntry>): Promise<void>

	/** Soft-delete an entry. */
	delete(id: string): Promise<void>

	/** Semantic + keyword hybrid search. */
	search(query: string, options?: SearchOptions): Promise<MemorySearchPage>

	/** Paginated list with filtering. */
	list(options?: ListOptions): Promise<MemoryListPage>

	/** Get structurally related entries via the knowledge graph. */
	getRelated(id: string, relationType?: string): Promise<MemoryEntry[]>

	/** Add a typed relation between two entries. */
	addRelation(fromId: string, relation: MemoryRelation): Promise<void>

	/** Retrieve current working memory for a session. */
	getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]>

	/** Manually trigger the synthesis pipeline.
	 *  Returns the number of new vault artifacts produced. */
	consolidate(): Promise<number>

	/** Check prospective memory - fire any time- or topic-triggered reminders.
	 *  Pass the current message for topic-based matching. */
	checkProspectiveMemory(currentMessage?: string): Promise<MemoryEntry[]>

	/** Subscribe to memory lifecycle events. */
	on(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Unsubscribe. */
	off(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Initialise all subsystems. Must be called before first use. */
	initialize(): Promise<void>

	/** Graceful shutdown. */
	close(): Promise<void>
}
