import type {
	ContextPack,
	MemoryEntry,
	MemoryEvent,
	MemoryRelation,
	MemorySearchPage,
	RetentionResult,
	SearchOptions,
	ThinkResult,
} from '../types'

/**
 * IBrainEngine - Universal memory interface (v2.1).
 * Implemented on all platforms (web, mobile, desktop).
 * Does NOT know about agents, workflows, or skill execution.
 *
 * Design: Section 6.2 of designCognitiveBrain.md
 */
export interface IBrainEngine {
	/** Store a new memory entry. Returns assigned ID. Write succeeds immediately;
	 *  pipeline enrichment happens async. */
	store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string>

	/** Hybrid semantic + keyword search. */
	search(query: string, options?: SearchOptions): Promise<MemorySearchPage>

	/** T1/T2 synthesis answer - assembles context and invokes LLM for a direct answer. */
	think(query: string): Promise<ThinkResult>

	/** Trigger synthesis pipeline. Returns number of vault artifacts produced. */
	synthesize(entries?: MemoryEntry[]): Promise<number>

	/** Assemble a token-budgeted context pack for an agent prompt. */
	getContextPack(prompt: string, budgetTokens?: number): Promise<ContextPack>

	/** Retrieve current working memory for a session. */
	getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]>

	/** Get structurally related entries via the knowledge graph. */
	getRelated(id: string, relationType?: string): Promise<MemoryEntry[]>

	/** Add a typed relation between two entries. */
	addRelation(fromId: string, relation: MemoryRelation): Promise<void>

	/** Run retention policies - compress, archive, prune low-salience entries. */
	runRetentionPolicies(): Promise<RetentionResult>

	/** Subscribe to memory lifecycle events. */
	on(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Unsubscribe. */
	off(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Initialise all subsystems. Must be called before first use. */
	initialize(): Promise<void>

	/** Graceful shutdown. */
	close(): Promise<void>
}
