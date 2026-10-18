import type { IBrainEngine } from '../../interfaces/IBrainEngine'
import type {
	ContextPack,
	MemoryEntry,
	MemoryEvent,
	MemoryRelation,
	MemorySearchPage,
	RetentionResult,
	SearchOptions,
	ThinkResult,
} from '../../types'

/**
 * DesktopBrainEngine - IBrainEngine implementation for desktop (Phase 3).
 *
 * Current implementation: delegates to a web MemoryService instance.
 * Phase 3 upgrade path:
 *   - Replace IndexedDBStore with PGLiteStore (local Postgres via PGLite)
 *   - Replace OramaIndex with PgVectorIndex (pgvector + BM25 + RRF)
 *   - Replace InProcessGraph with Neo4jGraph (typed-edge knowledge graph)
 *   - Enable T2 LLM synthesis (desktop has access to larger models)
 *
 * Usage:
 *   const engine = await DesktopBrainEngine.create({ llm: { t1: {...}, t2: {...} } })
 *   const server = new MCPBrainServer(engine)
 *   await server.start()
 */
export class DesktopBrainEngine implements IBrainEngine {
	private delegate: IBrainEngine | null = null
	private initialized = false
	private readonly config: DesktopBrainEngineConfig

	constructor(config: DesktopBrainEngineConfig) {
		this.config = config
	}

	/**
	 * Factory - preferred construction path.
	 * Lazily loads web adapters to avoid bundling IndexedDB in pure Node contexts.
	 */
	static async create(config: DesktopBrainEngineConfig): Promise<DesktopBrainEngine> {
		const engine = new DesktopBrainEngine(config)
		await engine.initialize()
		return engine
	}

	async initialize(): Promise<void> {
		if (this.initialized) return

		try {
			// Load web adapters as fallback - works in Electron renderer + Node with fake-indexeddb
			const [{ IndexedDBStore }, { OramaIndex }] = await Promise.all([
				import('../web/IndexedDBStore'),
				import('../web/OramaIndex'),
			])

			const { MemoryService } = await import('../../core/MemoryService')

			const store = new IndexedDBStore(this.config.dbName ?? 'page-agent-desktop')
			const index = new OramaIndex()

			this.delegate = new MemoryService({
				store,
				index,
				llm: this.config.llm,
				vault: this.config.vault,
				synthesisThreshold: this.config.synthesisThreshold,
				sessionId: this.config.sessionId,
				tokenBudget: this.config.tokenBudget,
			})

			await this.delegate.initialize()
		} catch (err) {
			// If web adapters unavailable (pure Node without fake-indexeddb), use a no-op delegate
			console.warn('[DesktopBrainEngine] Web adapters unavailable, using NoOp delegate:', err)
			this.delegate = new NoOpBrainEngine() as IBrainEngine
		}

		// At this point delegate is guaranteed non-null
		if (!this.delegate) {
			this.delegate = new NoOpBrainEngine() as IBrainEngine
		}

		this.initialized = true
	}

	async close(): Promise<void> {
		await this.delegate?.close()
	}

	// ── IBrainEngine delegation ───────────────────────────────────────────────

	async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		return this.requireDelegate().store(entry)
	}

	async search(query: string, options?: SearchOptions): Promise<MemorySearchPage> {
		return this.requireDelegate().search(query, options)
	}

	async think(query: string): Promise<ThinkResult> {
		return this.requireDelegate().think(query)
	}

	async synthesize(entries?: MemoryEntry[]): Promise<number> {
		return this.requireDelegate().synthesize(entries)
	}

	async getContextPack(prompt: string, budgetTokens?: number): Promise<ContextPack> {
		return this.requireDelegate().getContextPack(prompt, budgetTokens)
	}

	async getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]> {
		return this.requireDelegate().getWorkingMemory(sessionId)
	}

	async getRelated(id: string, relationType?: string): Promise<MemoryEntry[]> {
		return this.requireDelegate().getRelated(id, relationType)
	}

	async addRelation(fromId: string, relation: MemoryRelation): Promise<void> {
		return this.requireDelegate().addRelation(fromId, relation)
	}

	async runRetentionPolicies(): Promise<RetentionResult> {
		return this.requireDelegate().runRetentionPolicies()
	}

	on(event: MemoryEvent, callback: (payload: unknown) => void): void {
		this.requireDelegate().on(event, callback)
	}

	off(event: MemoryEvent, callback: (payload: unknown) => void): void {
		this.requireDelegate().off(event, callback)
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private requireDelegate(): IBrainEngine {
		if (!this.delegate) {
			throw new Error('[DesktopBrainEngine] Not initialized - call initialize() first')
		}
		return this.delegate
	}
}

export interface DesktopBrainEngineConfig {
	dbName?: string
	llm?: import('../../types').TieredLLMConfig
	vault?: import('../../interfaces/IVaultProvider').IVaultProvider
	synthesisThreshold?: number
	sessionId?: string
	tokenBudget?: number
}

/**
 * NoOpBrainEngine - used when storage backends are unavailable.
 * Returns empty results rather than crashing. Errors are surfaced, not hidden.
 */
class NoOpBrainEngine implements IBrainEngine {
	private readonly listeners = new Map<MemoryEvent, Set<(payload: unknown) => void>>()

	async store(_entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		console.warn('[NoOpBrainEngine] store() called - no storage backend available')
		return `noop-${Date.now()}`
	}

	async search(_query: string, _options?: SearchOptions): Promise<MemorySearchPage> {
		return { items: [], total: 0, hasMore: false }
	}

	async think(query: string): Promise<ThinkResult> {
		return {
			answer: `[NoStorage] Cannot answer "${query}" - no storage backend available.`,
			confidence: 0,
			sources: [],
			synthesisQuality: 'T1',
		}
	}

	async synthesize(_entries?: MemoryEntry[]): Promise<number> {
		return 0
	}

	async getContextPack(_prompt: string, _budgetTokens?: number): Promise<ContextPack> {
		return { artifacts: [], totalTokens: 0 }
	}

	async getWorkingMemory(_sessionId?: string): Promise<MemoryEntry[]> {
		return []
	}

	async getRelated(_id: string, _relationType?: string): Promise<MemoryEntry[]> {
		return []
	}

	async addRelation(_fromId: string, _relation: MemoryRelation): Promise<void> {}

	async runRetentionPolicies(): Promise<RetentionResult> {
		return { entriesProcessed: 0, entriesCompressed: 0, entriesDeleted: 0, edgesPruned: 0 }
	}

	on(event: MemoryEvent, callback: (payload: unknown) => void): void {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set())
		this.listeners.get(event)!.add(callback)
	}

	off(event: MemoryEvent, callback: (payload: unknown) => void): void {
		this.listeners.get(event)?.delete(callback)
	}

	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
}
