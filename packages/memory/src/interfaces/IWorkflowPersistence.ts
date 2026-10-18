/**
 * Minimal workflow result shape for persistence (avoids circular import with agents/).
 */
export interface PersistedWorkflowResult {
	workflowId: string
	finalOutput: string
	agentMemory: Record<string, string>
	executionMs: number
	completedAt: string
	[key: string]: unknown
}

/**
 * IWorkflowPersistence - pluggable workflow state persistence (v2.1).
 * Three implementations: InMemory, IndexedDB, Hybrid.
 *
 * Section 6.10 of designCognitiveBrain.md
 */
export interface IWorkflowPersistence {
	/** Save accumulated MEMORY[key]: value tokens for a session. */
	saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void>

	/** Load accumulated agent memory for a session. Returns {} if none. */
	loadAgentMemory(sessionId: string): Promise<Record<string, string>>

	/** Clear agent memory for a session. */
	clearAgentMemory(sessionId: string): Promise<void>

	/** Persist a completed workflow result. */
	saveWorkflowResult(result: PersistedWorkflowResult): Promise<void>

	/** Load workflow history. Optionally filtered by sessionId. */
	loadWorkflowHistory(sessionId?: string, limit?: number): Promise<PersistedWorkflowResult[]>

	/** Load a single workflow result by ID. Returns null if not found. */
	loadWorkflowResult(workflowId: string): Promise<PersistedWorkflowResult | null>
}
