import type { IWorkflowPersistence, PersistedWorkflowResult } from '../interfaces/IWorkflowPersistence'
import { InMemoryWorkflowPersistence } from './InMemoryWorkflowPersistence'

/**
 * HybridWorkflowPersistence - default for all platforms.
 *
 * Writes to in-memory cache synchronously (~0ms).
 * Flushes to IndexedDB asynchronously via requestIdleCallback or setTimeout(0).
 * Reads attempt in-memory first, fall back to IndexedDB (cold start / page resume).
 *
 * Mirrors "writes succeed immediately, enrichment is async" principle from MemoryService.
 * Desktop users can swap to Postgres-backed persistence without changing agent code.
 */
export class HybridWorkflowPersistence implements IWorkflowPersistence {
	private readonly memCache: InMemoryWorkflowPersistence
	private readonly options: { enableIndexedDB?: boolean }
	private idb: IWorkflowPersistence | null = null

	constructor(options: { enableIndexedDB?: boolean } = {}) {
		this.options = options
		this.memCache = new InMemoryWorkflowPersistence()
		if (options.enableIndexedDB !== false) {
			this.initIDB()
		}
	}

	private initIDB(): void {
		// Lazy-load IndexedDB adapter (browser only)
		if (typeof indexedDB === 'undefined') return

		import('./IndexedDBWorkflowPersistence').then(({ IndexedDBWorkflowPersistence }) => {
			this.idb = new IndexedDBWorkflowPersistence()
		}).catch(() => {
			// IndexedDB not available - in-memory only
		})
	}

	private scheduleFlush(fn: () => void): void {
		if (typeof requestIdleCallback !== 'undefined') {
			requestIdleCallback(fn, { timeout: 2_000 })
		} else {
			setTimeout(fn, 0)
		}
	}

	async saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void> {
		// Synchronous in-memory write
		await this.memCache.saveAgentMemory(sessionId, memory)

		// Async flush to IndexedDB
		if (this.idb) {
			this.scheduleFlush(() => {
				this.idb!.saveAgentMemory(sessionId, memory).catch(() => {})
			})
		}
	}

	async loadAgentMemory(sessionId: string): Promise<Record<string, string>> {
		// Fast path: in-memory
		const inMemory = await this.memCache.loadAgentMemory(sessionId)
		if (Object.keys(inMemory).length > 0) return inMemory

		// Cold start / page resume: try IndexedDB
		if (this.idb) {
			try {
				return await this.idb.loadAgentMemory(sessionId)
			} catch {
				return {}
			}
		}

		return {}
	}

	async clearAgentMemory(sessionId: string): Promise<void> {
		await this.memCache.clearAgentMemory(sessionId)
		if (this.idb) {
			this.scheduleFlush(() => {
				this.idb!.clearAgentMemory(sessionId).catch(() => {})
			})
		}
	}

	async saveWorkflowResult(result: PersistedWorkflowResult): Promise<void> {
		await this.memCache.saveWorkflowResult(result)
		if (this.idb) {
			this.scheduleFlush(() => {
				this.idb!.saveWorkflowResult(result).catch(() => {})
			})
		}
	}

	async loadWorkflowHistory(
		sessionId?: string,
		limit = 20
	): Promise<PersistedWorkflowResult[]> {
		const inMemory = await this.memCache.loadWorkflowHistory(sessionId, limit)
		if (inMemory.length > 0) return inMemory

		if (this.idb) {
			try {
				return await this.idb.loadWorkflowHistory(sessionId, limit)
			} catch {
				return []
			}
		}
		return []
	}

	async loadWorkflowResult(workflowId: string): Promise<PersistedWorkflowResult | null> {
		const inMemory = await this.memCache.loadWorkflowResult(workflowId)
		if (inMemory) return inMemory

		if (this.idb) {
			try {
				return await this.idb.loadWorkflowResult(workflowId)
			} catch {
				return null
			}
		}
		return null
	}
}
