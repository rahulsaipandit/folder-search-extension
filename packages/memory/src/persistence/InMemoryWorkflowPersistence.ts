import type { IWorkflowPersistence, PersistedWorkflowResult } from '../interfaces/IWorkflowPersistence'

/**
 * InMemoryWorkflowPersistence - ephemeral, session-only storage.
 * Zero latency, no IndexedDB, no durability.
 */
export class InMemoryWorkflowPersistence implements IWorkflowPersistence {
	private readonly agentMemoryMap = new Map<string, Record<string, string>>()
	private readonly workflowResults = new Map<string, PersistedWorkflowResult>()
	private readonly workflowHistory: PersistedWorkflowResult[] = []

	async saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void> {
		this.agentMemoryMap.set(sessionId, { ...memory })
	}

	async loadAgentMemory(sessionId: string): Promise<Record<string, string>> {
		return { ...(this.agentMemoryMap.get(sessionId) ?? {}) }
	}

	async clearAgentMemory(sessionId: string): Promise<void> {
		this.agentMemoryMap.delete(sessionId)
	}

	async saveWorkflowResult(result: PersistedWorkflowResult): Promise<void> {
		this.workflowResults.set(result.workflowId, result)
		this.workflowHistory.unshift(result)
		// Keep last 100 results
		if (this.workflowHistory.length > 100) this.workflowHistory.length = 100
	}

	async loadWorkflowHistory(
		sessionId?: string,
		limit = 20
	): Promise<PersistedWorkflowResult[]> {
		let history = [...this.workflowHistory]
		if (sessionId) {
			history = history.filter((r) => r.sessionId === sessionId)
		}
		return history.slice(0, limit)
	}

	async loadWorkflowResult(workflowId: string): Promise<PersistedWorkflowResult | null> {
		return this.workflowResults.get(workflowId) ?? null
	}
}
