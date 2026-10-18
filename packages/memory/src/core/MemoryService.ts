import type { IBrainEngine } from '../interfaces/IBrainEngine'
import type { IMemoryIndex } from '../interfaces/IMemoryIndex'
import type { IMemoryService } from '../interfaces/IMemoryService'
import type { IMemoryStore } from '../interfaces/IMemoryStore'
import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type {
	ContextPack,
	EdgeType,
	Entity,
	ListOptions,
	MemoryEntry,
	MemoryEvent,
	MemoryListPage,
	MemoryRelation,
	MemorySearchPage,
	RetentionResult,
	SearchOptions,
	SynthesisQuality,
	ThinkResult,
	TieredLLMConfig,
} from '../types'
import { ContextBuilder } from './context/ContextBuilder'
import { InProcessGraph } from './graph/InProcessGraph'
import { MaintenanceCycle } from './pipeline/MaintenanceCycle'
import { Pipeline } from './pipeline/Pipeline'
import {
	evaluateRetentionPolicy,
	recomputeSalience,
	shouldRequantize,
} from './pipeline/processors/T0SalienceProcessor'
import { SynthesisEngine } from './synthesis/SynthesisEngine'
import { WorkingMemoryManager } from './working/WorkingMemory'

/**
 * MemoryService - the cognitive orchestration hub.
 *
 * Composes:
 *  - IMemoryStore (persistence)
 *  - IMemoryIndex (hybrid search)
 *  - Pipeline (async enrichment)
 *  - InProcessGraph (entity relationships)
 *  - SynthesisEngine (vault compilation)
 *  - WorkingMemory (session context)
 *
 * Agents interact ONLY with this service - never with the subsystems directly.
 */

type EventCallback = (payload: unknown) => void

export interface MemoryServiceConfig {
	store: IMemoryStore
	index: IMemoryIndex
	vault?: IVaultProvider
	llm?: TieredLLMConfig
	synthesisThreshold?: number // entries before auto-synthesize (default 10)
	sessionId?: string
	tokenBudget?: number
	/** Optional pre-constructed graph instance. If omitted, a new InProcessGraph is created. */
	graph?: InProcessGraph
	maintenance?: { budgetMs?: number; runOnStartup?: boolean; disabled?: boolean }
}

/** Metadata key used to persist the graph snapshot in the store. */
const GRAPH_SNAPSHOT_ID = '__graph_snapshot__'

// Lazy LLM type - only available after @page-agent/llms is loaded
type LLMInstance = import('@page-agent/llms').LLM

export class MemoryService implements IMemoryService, IBrainEngine {
	private readonly memStore: IMemoryStore
	private readonly index: IMemoryIndex
	private readonly pipeline: Pipeline
	private readonly graph: InProcessGraph
	private readonly synthesis: SynthesisEngine
	private readonly workingMemory: WorkingMemoryManager
	private readonly defaultSessionId: string
	private readonly listeners = new Map<MemoryEvent, Set<EventCallback>>()
	private readonly synthesisThreshold: number
	private readonly llmConfig: TieredLLMConfig | undefined
	private thinkLLM: LLMInstance | null = null
	private entriesSinceLastSynthesis = 0
	private initialized = false
	private readonly options: MemoryServiceConfig

	constructor(config: MemoryServiceConfig) {
		this.options = config
		this.memStore = config.store
		this.index = config.index
		this.synthesisThreshold = config.synthesisThreshold ?? 10
		this.llmConfig = config.llm

		this.pipeline = new Pipeline(this.memStore, this.index, {
			llm: config.llm,
		})

		this.graph = config.graph ?? new InProcessGraph()

		this.synthesis = new SynthesisEngine({
			llm: config.llm,
			quality: 'T1',
			vault: config.vault,
		})

		this.defaultSessionId = config.sessionId ?? `session-${Date.now()}`
		this.workingMemory = new WorkingMemoryManager({
			tokenBudget: config.tokenBudget,
		})

		// Wire pipeline events to service events
		this.pipeline.on((event) => {
			if (event.type === 'entry.enriched') {
				this.emit('processing.completed', event.entryId)
			} else if (event.type === 'job.failed') {
				this.emit('processing.failed', { id: event.entryId, error: event.error?.message })
			}
		})
	}

	// ── IMemoryService implementation ─────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.initialized) return
		await this.memStore.initialize()
		await this.index.initialize()
		await this.pipeline.initialize()
		await this.synthesis.initialize()

		// ── Graph hydration ────────────────────────────────────────────────────
		// Attempt fast-path: restore from a persisted snapshot written by close().
		const snapshot = await this.memStore.get(GRAPH_SNAPSHOT_ID)
		if (snapshot?.metadata?.graphSnapshot) {
			try {
				const data = snapshot.metadata.graphSnapshot as Parameters<InProcessGraph['deserialize']>[0]
				this.graph.deserialize(data)
			} catch {
				// Snapshot corrupt - fall through to full hydration
				await this.hydrateGraphFromStore()
			}
		} else {
			// No snapshot: walk all stored entries and wire each one into the graph.
			await this.hydrateGraphFromStore()
		}

		this.initialized = true

		if (!this.options?.maintenance?.disabled && this.options?.maintenance?.runOnStartup !== false) {
			setTimeout(() => { this.runMaintenance(this.options?.maintenance?.budgetMs).catch(() => {}) }, 0)
		}
	}

	/** Full graph hydration by scanning all active entries in the store. */
	private async hydrateGraphFromStore(): Promise<void> {
		const { entries } = await this.memStore.query({ lifecycleState: 'active' })
		for (const entry of entries) {
			// Wire the full entry (extracts entity refs and creates mentions edges)
			if (entry.type === 'episodic' || entry.type === 'semantic') {
				this.graph.wireEntry(entry)
			}
			// Upsert any explicitly stored entity IDs
			if (entry.entities && entry.entities.length > 0) {
				for (const entityName of entry.entities) {
					const entityId = slugifyPublic(entityName)
					if (!this.graph.getEntity(entityId)) {
						this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
					}
				}
			}
			// Mirror stored relations into the graph
			if (entry.relations && entry.relations.length > 0) {
				for (const rel of entry.relations) {
					this.graph.createEdge(entry.id, rel.type, rel.targetId, rel.weight ?? 1.0)
				}
			}
		}
	}

	async close(): Promise<void> {
		// Persist a graph snapshot so the next initialize() can skip full hydration.
		try {
			const snapshotData = this.graph.serialize()
			const now = new Date().toISOString()
			const snapshotEntry: MemoryEntry = {
				id: GRAPH_SNAPSHOT_ID,
				type: 'artifact',
				content: 'Graph snapshot - internal use only',
				tags: ['graph-snapshot'],
				createdAt: now,
				updatedAt: now,
				lifecycleState: 'active',
				metadata: { graphSnapshot: snapshotData },
			}
			await this.memStore.put(snapshotEntry)
		} catch {
			// Non-fatal - graph will rebuild from store on next launch
		}
		await this.memStore.close()
		await this.index.close()
	}

	// ── IBrainEngine implementation ───────────────────────────────────────────

	/** IBrainEngine.store - alias for create(). Satisfies the IBrainEngine contract. */
	async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		return this.create(entry)
	}

	/**
	 * IBrainEngine.think - search top-K entries then synthesize an answer with LLM.
	 * Falls back to returning the top search result content when LLM is unavailable.
	 */
	async think(query: string): Promise<ThinkResult> {
		// Search for relevant context
		const searchPage = await this.search(query, { topK: 5 })
		const topEntries = searchPage.items.slice(0, 5)

		if (topEntries.length === 0) {
			return {
				answer: `No relevant memories found for: "${query}"`,
				confidence: 0,
				sources: [],
				synthesisQuality: 'T1',
			}
		}

		const sources = topEntries.map((r) => r.entry.id)

		// Try LLM-based answer
		const llm = await this.getThinkLLM()
		if (llm) {
			const contextText = topEntries
				.map((r) => `[${r.entry.id}] ${r.entry.title ?? ''}: ${r.entry.content.slice(0, 400)}`)
				.join('\n\n')

			const prompt = `Answer the following question using ONLY the provided memory context. Be concise and accurate.\n\nQuestion: ${query}\n\nContext:\n${contextText}\n\nReturn JSON: { "answer": "...", "confidence": 0.0-1.0 }`

			try {
				const abort = new AbortController()
				const result = await llm.invoke(
					[{ role: 'user', content: prompt }],
					{
						think_answer: {
							description: 'Answer based on memory context',
							inputSchema: {
								parse: (v: unknown) => v as { answer: string; confidence: number },
							} as never,
							execute: async (args: { answer: string; confidence: number }) => args,
						},
					},
					abort.signal
				)
				const toolResult = result.toolResult as { answer: string; confidence: number } | null
				if (toolResult?.answer) {
					return {
						answer: toolResult.answer,
						confidence: toolResult.confidence ?? 0.7,
						sources,
						synthesisQuality: 'T1',
					}
				}
			} catch {
				// Fall through to T3 fallback
			}
		}

		// T3 fallback: return the best-scoring entry content directly
		const best = topEntries[0]!
		return {
			answer: best.entry.content.slice(0, 500),
			confidence: best.score * 0.7,
			sources,
			synthesisQuality: 'T1',
		}
	}

	/**
	 * IBrainEngine.synthesize - trigger the synthesis pipeline over given or all active entries.
	 */
	async synthesize(entries?: MemoryEntry[]): Promise<number> {
		if (entries && entries.length > 0) {
			const count = await this.synthesis.compile(entries)
			if (count > 0) this.emit('synthesis.completed', { count })
			return count
		}
		return this.consolidate()
	}

	/**
	 * IBrainEngine.getContextPack - assemble token-budgeted context from working memory +
	 * semantic search + graph neighbors, shaped by ContextBuilder's intent-based reranking.
	 *
	 * Assembly pipeline (Phase 3.2):
	 *   1. Working memory - session-local entries
	 *   2. Semantic search - top-20 index results for the prompt
	 *   3. Graph expansion - neighbors of the top-3 search results
	 *   4. Deduplicate by id
	 *   5. ContextBuilder.buildContextForQuery() - intent detection, subject boost,
	 *      salience sort, token-budget slice → final context string
	 *   6. Wrap the assembled string as a single VaultPage artifact in ContextPack
	 */
	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		// ── Step 1: Working memory ──────────────────────────────────────────────
		const wm = await this.getWorkingMemory(this.defaultSessionId)

		// ── Step 2: Semantic search (broad recall, topK=20) ────────────────────
		const searchPage = await this.search(prompt, { topK: 20 })
		const searchEntries = searchPage.items.map((r) => r.entry)

		// ── Step 3: Graph expansion - neighbors of top-3 results ──────────────
		const graphNeighbors: MemoryEntry[] = []
		const topResults = searchPage.items.slice(0, 3)
		for (const r of topResults) {
			try {
				const neighbors = await this.getRelated(r.entry.id)
				graphNeighbors.push(...neighbors)
			} catch {
				// Graph expansion is best-effort - missing edges are not fatal
			}
		}

		// ── Step 4: Combine + deduplicate by id ────────────────────────────────
		const seen = new Set<string>()
		const candidates: MemoryEntry[] = []
		for (const entry of [...wm, ...searchEntries, ...graphNeighbors]) {
			if (!seen.has(entry.id)) {
				seen.add(entry.id)
				candidates.push(entry)
			}
		}

		// ── Step 5: Intent-aware reranking + token-budget assembly ─────────────
		const contextString = ContextBuilder.buildContextForQuery(candidates, prompt, budgetTokens)

		// ── Step 6: Wrap in ContextPack ────────────────────────────────────────
		const cb = new ContextBuilder()
		const totalTokens = cb.estimateTokens(contextString)

		const artifacts: ContextPack['artifacts'] = contextString.length > 0
			? [
					{
						slug: 'context/assembled',
						title: 'Assembled Memory Context',
						content: contextString,
						frontmatter: { title: 'Assembled Memory Context' },
						updatedAt: new Date().toISOString(),
					},
				]
			: []

		return { artifacts, totalTokens }
	}

	async create(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		const id = generateId()
		const now = new Date().toISOString()

		const full: MemoryEntry = {
			...entry,
			id,
			createdAt: now,
			lifecycleState: 'active',
		}

		// Immediate write - non-blocking enrichment follows
		await this.memStore.put(full)

		// Self-wire graph on episodic writes (T0, synchronous)
		if (full.type === 'episodic' || full.type === 'semantic') {
			this.graph.wireEntry(full)
		}

		// Upsert explicitly provided entity names into the graph
		if (full.entities && full.entities.length > 0) {
			for (const entityName of full.entities) {
				const entityId = slugifyPublic(entityName)
				if (!this.graph.getEntity(entityId)) {
					this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
				}
			}
		}

		// Mirror stored relations into the graph
		if (full.relations && full.relations.length > 0) {
			for (const rel of full.relations) {
				this.graph.createEdge(full.id, rel.type, rel.targetId, rel.weight ?? 1.0)
			}
		}

		// Add to working memory if session-scoped
		const entrySession = full.sessionId ?? this.defaultSessionId
		if (full.type === 'working' || full.sessionId === this.defaultSessionId) {
			await this.workingMemory.add(full, entrySession)
		}

		// Enqueue async enrichment
		this.pipeline.enqueue(full)

		this.emit('entry.created', { id })
		this.emit('processing.started', { id })

		// Check synthesis threshold
		this.entriesSinceLastSynthesis++
		if (this.entriesSinceLastSynthesis >= this.synthesisThreshold) {
			this.entriesSinceLastSynthesis = 0
			// Fire-and-forget - does not block the create call
			this.consolidate().catch(() => {})
		}

		return id
	}

	async get(id: string): Promise<MemoryEntry | null> {
		const entry = await this.memStore.get(id)
		if (entry) {
			// Track retrieval for salience boost
			entry.retrievalCount = (entry.retrievalCount ?? 0) + 1
			await this.memStore.put(entry)
		}
		return entry
	}

	async update(id: string, patch: Partial<MemoryEntry>): Promise<void> {
		const existing = await this.memStore.get(id)
		if (!existing) throw new Error(`Memory entry not found: ${id}`)

		const updated: MemoryEntry = {
			...existing,
			...patch,
			id,
			updatedAt: new Date().toISOString(),
		}

		await this.memStore.put(updated)
		await this.index.index(updated)

		// Refresh graph edges for the updated entry
		if (updated.type === 'episodic' || updated.type === 'semantic') {
			this.graph.wireEntry(updated)
		}
		if (updated.entities && updated.entities.length > 0) {
			for (const entityName of updated.entities) {
				const entityId = slugifyPublic(entityName)
				if (!this.graph.getEntity(entityId)) {
					this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
				}
			}
		}
		if (updated.relations && updated.relations.length > 0) {
			for (const rel of updated.relations) {
				this.graph.createEdge(updated.id, rel.type, rel.targetId, rel.weight ?? 1.0)
			}
		}

		this.emit('entry.updated', { id })
	}

	async delete(id: string): Promise<void> {
		await this.memStore.delete(id)
		await this.index.remove(id)

		// Remove all graph edges that involve this entry.
		// InProcessGraph has no removeEntry() - we iterate the edge list and prune.
		const connectedEdges = this.graph.getEdges(id)
		for (const edge of connectedEdges) {
			// Setting weight below pruning threshold and calling removeWeakEdges would be
			// indirect. Instead we directly mark them as dead-weight and rely on the next
			// retention cycle, OR we call removeWeakEdges with a high threshold to catch them.
			// The cleanest available API is to set the weight to 0 so they get pruned on next
			// runRetentionPolicies(). We achieve this by re-creating the edge at weight 0.
			this.graph.createEdge(edge.from, edge.type, edge.to, -edge.weight)
		}
		// Immediately sweep the just-zeroed edges so they don't linger in the graph.
		this.graph.removeWeakEdges(0.01)

		this.emit('entry.deleted', { id })
	}

	async search(query: string, options?: SearchOptions): Promise<MemorySearchPage> {
		const topK = options?.topK ?? 10
		const results = await this.index.search(query, {
			topK,
			filter: options?.filter,
			intent: options?.intent,
		})

		const items = await Promise.all(
			results.map(async (r) => {
				const entry = await this.memStore.get(r.id)
				return entry ? { entry, score: r.score } : null
			})
		)

		const filtered = items.filter(Boolean) as { entry: MemoryEntry; score: number }[]

		// ── Graph-augmented retrieval ───────────────────────────────────────────
		// For each seed result, expand its depth-1 graph neighbors and append any
		// highly salient neighbors that are not already in the result set (up to 3
		// bonus entries per seed, capped at topK bonus entries total).
		const seenIds = new Set(filtered.map((r) => r.entry.id))
		const bonus: { entry: MemoryEntry; score: number }[] = []
		const maxBonusTotal = topK

		for (const seed of filtered) {
			if (bonus.length >= maxBonusTotal) break
			const neighborIds = this.graph.expandNeighbors(seed.entry.id, 1)
			let bonusForSeed = 0

			for (const nid of neighborIds) {
				if (bonus.length >= maxBonusTotal || bonusForSeed >= 3) break
				if (seenIds.has(nid)) continue

				const neighbor = await this.memStore.get(nid)
				if (!neighbor) continue
				// Only include neighbors with meaningful salience
				if ((neighbor.salience ?? 0) < 0.3) continue

				seenIds.add(nid)
				bonus.push({ entry: neighbor, score: seed.score * 0.5 })
				bonusForSeed++
			}
		}

		const all = [...filtered, ...bonus]
		return { items: all, total: all.length, hasMore: false }
	}

	async list(options?: ListOptions): Promise<MemoryListPage> {
		const { entries } = await this.memStore.query(options?.filter ?? {})
		const total = entries.length

		const limit = options?.limit ?? 50
		const offset = options?.offset ?? 0
		const page = entries.slice(offset, offset + limit)

		return {
			items: page,
			total,
			hasMore: offset + limit < total,
		}
	}

	async getRelated(id: string, relationType?: string): Promise<MemoryEntry[]> {
		let neighborIds: string[]

		if (relationType) {
			// When a relationType filter is requested, walk edges directly so we can filter
			// by type before expanding further, rather than post-filtering a wide BFS result.
			const directEdges = this.graph.getEdges(id, relationType as EdgeType)
			const directIds = directEdges.map((e) => (e.from === id ? e.to : e.from))

			// Depth-2: also collect neighbors-of-neighbors that share the same edge type
			const depth2Ids: string[] = []
			for (const neighborId of directIds) {
				const secondHop = this.graph.getEdges(neighborId, relationType as EdgeType)
				for (const e of secondHop) {
					const candidate = e.from === neighborId ? e.to : e.from
					if (candidate !== id && !directIds.includes(candidate)) {
						depth2Ids.push(candidate)
					}
				}
			}
			neighborIds = [...new Set([...directIds, ...depth2Ids])]
		} else {
			// No type filter - BFS up to depth 2, exclude pure-entity nodes (only memory entries)
			neighborIds = this.graph.expandNeighbors(id, 2)
		}

		// Only return entries that actually exist in the store (filter out entity nodes)
		const entries = await Promise.all(neighborIds.map((nid) => this.memStore.get(nid)))
		return entries.filter(Boolean) as MemoryEntry[]
	}

	async addRelation(fromId: string, relation: MemoryRelation): Promise<void> {
		const entry = await this.memStore.get(fromId)
		if (!entry) throw new Error(`Memory entry not found: ${fromId}`)

		const relations = entry.relations ?? []
		const existing = relations.findIndex(
			(r) => r.targetId === relation.targetId && r.type === relation.type
		)
		if (existing >= 0) {
			relations[existing] = relation
		} else {
			relations.push(relation)
		}

		entry.relations = relations
		entry.updatedAt = new Date().toISOString()
		await this.memStore.put(entry)

		// Mirror in graph
		this.graph.createEdge(fromId, relation.type, relation.targetId, relation.weight ?? 1.0)
	}

	async getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]> {
		if (sessionId) {
			return this.workingMemory.getForSession(sessionId)
		}
		return this.workingMemory.getAll()
	}

	async consolidate(): Promise<number> {
		const { entries } = await this.memStore.query({ lifecycleState: 'active' })
		const count = await this.synthesis.compile(entries)
		if (count > 0) {
			this.emit('synthesis.completed', { count })
		}
		return count
	}

	async checkProspectiveMemory(currentMessage?: string): Promise<MemoryEntry[]> {
		const now = new Date().toISOString()
		const fired: MemoryEntry[] = []
		const firedIds = new Set<string>()

		// ── Pathway 1: Time-based (Einstein dual-pathway model) ──────────────────
		// Scan ALL active entries (not just 'working') for prospective fireAt markers.
		// This catches reverify_fact reminders and user-scheduled memories.
		const { entries: all } = await this.memStore.query({ lifecycleState: 'active' })
		for (const entry of all) {
			if (!entry.metadata?.prospective) continue
			const fireAt = entry.metadata.fireAt as string | undefined
			if (fireAt && fireAt <= now) {
				fired.push(entry)
				firedIds.add(entry.id)
			}
		}

		// ── Pathway 2: Topic-based (McDaniel model) ──────────────────────────────
		// Semantic search for entries explicitly flagged as prospective that match
		// the current message content. Fires even before their scheduled fireAt.
		if (currentMessage && currentMessage.length > 0) {
			const results = await this.index.search(currentMessage, { topK: 5 })
			for (const r of results) {
				if (firedIds.has(r.id)) continue
				const entry = await this.memStore.get(r.id)
				if (entry?.metadata?.prospective && !firedIds.has(entry.id)) {
					// Only fire topic-based if content is highly relevant (score > 0.6)
					if (r.score >= 0.6) {
						fired.push(entry)
						firedIds.add(entry.id)
					}
				}
			}
		}

		// Mark fired entries as no longer pending (clear fireAt so they don't re-fire)
		for (const entry of fired) {
			const wasTime =
				(entry.metadata?.fireAt as string | undefined) !== undefined &&
				(entry.metadata!.fireAt as string) <= now
			if (wasTime) {
				entry.metadata = { ...(entry.metadata ?? {}), fireAt: null, firedAt: now }
				entry.updatedAt = now
				await this.memStore.put(entry)
			}
		}

		return fired
	}

	on(event: MemoryEvent, callback: EventCallback): void {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set())
		this.listeners.get(event)!.add(callback)
	}

	off(event: MemoryEvent, callback: EventCallback): void {
		this.listeners.get(event)?.delete(callback)
	}

	// ── Scheduled maintenance ─────────────────────────────────────────────────

	/**
	 * Run retention policy evaluation over all active entries.
	 * Implements IBrainEngine.runRetentionPolicies().
	 * Returns RetentionResult (matches IBrainEngine contract).
	 */
	async runRetentionPolicies(): Promise<RetentionResult> {
		const { entries } = await this.memStore.query({ lifecycleState: 'active' })
		const totalEntryCount = entries.length
		let entriesDeleted = 0,
			entriesCompressed = 0,
			entriesProcessed = 0
		let requantized = 0,
			reverified = 0,
			deprecated = 0

		for (const entry of entries) {
			entriesProcessed++
			recomputeSalience(entry)
			const policy = evaluateRetentionPolicy(entry)

			if (policy === 'tombstone_episode') {
				// Policy 1: permanent soft-delete
				entry.lifecycleState = 'deleted'
				entry.retentionPolicy = 'tombstone_episode'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				entriesDeleted++
			} else if (policy === 'compact_raw') {
				// Policy 2: compress content, keep entry in index
				entry.lifecycleState = 'compressed'
				entry.content = entry.content.slice(0, 200) + '…'
				entry.compressionLevel = 1
				entry.retentionPolicy = 'compact_raw'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				entriesCompressed++
			} else if (policy === 'requantize_embeddings') {
				// Policy 3: mark embedding as requantized (actual float32→uint8 done by index)
				if (shouldRequantize(entry, totalEntryCount)) {
					entry.metadata = { ...(entry.metadata ?? {}), embeddingDtype: 'uint8' }
					entry.retentionPolicy = 'requantize_embeddings'
					entry.updatedAt = new Date().toISOString()
					await this.memStore.put(entry)
					requantized++
				}
			} else if (policy === 'deprecate_procedure') {
				// Policy 4: mark superseded procedure as deprecated
				entry.lifecycleState = 'deprecated'
				entry.retentionPolicy = 'deprecate_procedure'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				deprecated++
			} else if (policy === 'reverify_fact') {
				// Policy 5: flag low-confidence facts for human/agent verification
				// Add a prospective memory reminder rather than deleting
				entry.retentionPolicy = 'reverify_fact'
				entry.metadata = {
					...(entry.metadata ?? {}),
					prospective: true,
					fireAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), // 7 days
					reverifyReason: `Low confidence (${(entry.confidence ?? 0).toFixed(2)}) and <3 sources`,
				}
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				reverified++
			} else if (policy === 'demote_episode') {
				// Policy 7: halve salience score
				entry.salience = (entry.salience ?? 0) * 0.5
				entry.retentionPolicy = 'demote_episode'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
			}
		}

		// Policy 6: prune_edges - weak graph edges (weight < 0.1)
		const edgesPruned = this.graph.removeWeakEdges(0.1)

		// Emit retention event
		this.emit('processing.completed', {
			type: 'retention',
			entriesProcessed,
			entriesCompressed,
			entriesDeleted,
			edgesPruned,
			requantized,
			reverified,
			deprecated,
		})

		return { entriesProcessed, entriesCompressed, entriesDeleted, edgesPruned }
	}

	/**
	 * Run the full 9-phase MaintenanceCycle.
	 * Errors are swallowed to prevent crashing the app.
	 * Emits 'maintenance.completed' when done.
	 */
	async runMaintenance(budgetMs = 60_000): Promise<void> {
		try {
			const cycle = new MaintenanceCycle({
				store: this.memStore,
				index: this.index,
				graph: this.graph,
				pipeline: this.pipeline,
				synthesisEngine: this.synthesis,
				vault: this.options.vault,
				quality: (this.options.llm ? 'T1' : undefined),
			})
			await cycle.run(budgetMs)
			this.emit('maintenance.completed', { budgetMs })
		} catch {
			// Non-fatal - maintenance failure must not crash the app
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	/** Lazily initialise and cache the T1 LLM used for think(). */
	private async getThinkLLM(): Promise<LLMInstance | null> {
		if (this.thinkLLM) return this.thinkLLM
		const llmCfg = this.llmConfig?.t1 ?? this.llmConfig?.t2
		if (!llmCfg) return null

		try {
			const { LLM } = await import('@page-agent/llms')
			this.thinkLLM = new LLM({
				baseURL: llmCfg.baseURL,
				model: llmCfg.model,
				apiKey: llmCfg.apiKey ?? '',
				temperature: 0.2,
				maxRetries: 1,
			})
			return this.thinkLLM
		} catch {
			return null
		}
	}

	private emit(event: MemoryEvent, payload: unknown): void {
		const cbs = this.listeners.get(event)
		if (!cbs) return
		for (const cb of cbs) {
			try {
				cb(payload)
			} catch {
				// Listener failures must not crash the service
			}
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	// Fallback: timestamp + random
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Mirror of InProcessGraph's internal `slugify` used to produce entity IDs
 * that match those created by wireEntry / buildGraph.
 */
function slugifyPublic(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}
