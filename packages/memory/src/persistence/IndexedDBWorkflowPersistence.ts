import { openDB, type IDBPDatabase } from 'idb'
import type { IWorkflowPersistence, PersistedWorkflowResult } from '../interfaces/IWorkflowPersistence'

const DB_NAME = 'page-agent-workflow'
const DB_VERSION = 1
const STORE_MEMORY = 'agent_memory'
const STORE_RESULTS = 'workflow_results'

/**
 * IndexedDBWorkflowPersistence - durable cross-reload storage for web/extension.
 */
export class IndexedDBWorkflowPersistence implements IWorkflowPersistence {
	private db: IDBPDatabase | null = null
	private initPromise: Promise<void> | null = null

	private async getDB(): Promise<IDBPDatabase> {
		if (this.db) return this.db
		if (!this.initPromise) {
			this.initPromise = this.openDB()
		}
		await this.initPromise
		return this.db!
	}

	private async openDB(): Promise<void> {
		this.db = await openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_MEMORY)) {
					db.createObjectStore(STORE_MEMORY)
				}
				if (!db.objectStoreNames.contains(STORE_RESULTS)) {
					const store = db.createObjectStore(STORE_RESULTS, { keyPath: 'workflowId' })
					store.createIndex('completedAt', 'completedAt')
					store.createIndex('sessionId', 'sessionId')
				}
			},
		})
	}

	async saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void> {
		const db = await this.getDB()
		await db.put(STORE_MEMORY, memory, sessionId)
	}

	async loadAgentMemory(sessionId: string): Promise<Record<string, string>> {
		try {
			const db = await this.getDB()
			const result = await db.get(STORE_MEMORY, sessionId)
			return (result as Record<string, string> | undefined) ?? {}
		} catch {
			return {}
		}
	}

	async clearAgentMemory(sessionId: string): Promise<void> {
		try {
			const db = await this.getDB()
			await db.delete(STORE_MEMORY, sessionId)
		} catch {
			// Ignore
		}
	}

	async saveWorkflowResult(result: PersistedWorkflowResult): Promise<void> {
		const db = await this.getDB()
		await db.put(STORE_RESULTS, result)
	}

	async loadWorkflowHistory(
		sessionId?: string,
		limit = 20
	): Promise<PersistedWorkflowResult[]> {
		try {
			const db = await this.getDB()

			if (sessionId) {
				const results = await db.getAllFromIndex(STORE_RESULTS, 'sessionId', sessionId)
				return results
					.sort((a, b) => new Date(b.completedAt as string).getTime() - new Date(a.completedAt as string).getTime())
					.slice(0, limit) as PersistedWorkflowResult[]
			}

			const all = await db.getAll(STORE_RESULTS)
			return all
				.sort((a, b) => new Date(b.completedAt as string).getTime() - new Date(a.completedAt as string).getTime())
				.slice(0, limit) as PersistedWorkflowResult[]
		} catch {
			return []
		}
	}

	async loadWorkflowResult(workflowId: string): Promise<PersistedWorkflowResult | null> {
		try {
			const db = await this.getDB()
			const result = await db.get(STORE_RESULTS, workflowId)
			return (result as PersistedWorkflowResult | undefined) ?? null
		} catch {
			return null
		}
	}
}
