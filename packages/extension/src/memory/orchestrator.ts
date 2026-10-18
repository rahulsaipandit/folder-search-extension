// ===================================================================
// SMRITI Memory System - Cognitive Orchestrator
// ===================================================================
// Thin IBrainEngine facade that wires together packages/memory components.
// All storage, retrieval, and search go through @page-agent/memory.
// ===================================================================

import { ConsolidationManager } from "./consolidation"
import {
  SmritiWorkingMemory as WorkingMemory,
  IndexedDBEpisodicStore,
  IndexedDBSemanticStore,
  IndexedDBGraphStore,
  IndexedDBJobQueue,
  IndexedDBProceduralStore,
  ProceduralStore as BaseProceduralStore,
  RetrievalEngine,
  SemanticSearchBridge,
  VectorIndexSync,
  CacheConsistencyManager,
  WikiIngestionJob,
  nextId,
  SnapshotStore,
} from "@page-agent/memory"
import { InferenceAdapter, getInferenceAdapter } from "./inferenceAdapter"
import type {
  ProcedureRecord,
  ProcedureVersionRecord,
  ConsolidationJobType,
  StateSnapshot,
  ActivationItem,
  WorkingMemoryBudget,
  RetrievalPlan,
  ScoredCandidate,
  QueryIntent,
} from "@page-agent/memory"
import type {
  TurnRecord,
  OutcomeType,
  SystemState,
} from "./types"
import type {
  IBrainEngine,
  MemoryEntry,
  MemoryEvent,
  MemoryRelation,
  MemorySearchPage,
  SearchOptions,
  ContextPack,
  ThinkResult,
  RetentionResult,
} from "@page-agent/memory"

export interface SmritiMemoryConfig {
  workingMemoryBudget?: Partial<WorkingMemoryBudget>
  enableCachePolling?: boolean
  enableAutoConsolidation?: boolean
  consolidationIntervalMs?: number
  enableSemanticSearch?: boolean
  vectorIndexSyncIntervalMs?: number
}

export class SmritiOrchestrator extends EventTarget implements IBrainEngine {
  public workingMemory: WorkingMemory
  public episodic: IndexedDBEpisodicStore
  public semantic: IndexedDBSemanticStore
  public graph: IndexedDBGraphStore
  public jobs: IndexedDBJobQueue
  public procedural: BaseProceduralStore
  public retrieval: RetrievalEngine
  public consolidation: ConsolidationManager
  public cache: CacheConsistencyManager
  public semanticSearch: SemanticSearchBridge
  public vectorIndexSync: VectorIndexSync
  public inference: InferenceAdapter

  private config: Required<SmritiMemoryConfig>
  private consolidationTimer: ReturnType<typeof setInterval> | null = null
  private currentSessionId: string = ""
  private turnCount = 0
  private taskEpisodeMap = new Map<string, string>()

  constructor(config: SmritiMemoryConfig = {}) {
    super()
    this.config = {
      workingMemoryBudget: {},
      enableCachePolling: true,
      enableAutoConsolidation: true,
      consolidationIntervalMs: 30_000,
      enableSemanticSearch: true,
      vectorIndexSyncIntervalMs: 5 * 60 * 1000,
      ...config,
    }

    // Stores (packages/memory IDB adapters)
    this.episodic = new IndexedDBEpisodicStore()
    this.semantic = new IndexedDBSemanticStore()
    this.graph = new IndexedDBGraphStore()
    this.jobs = new IndexedDBJobQueue()

    // Procedural store (packages/memory - already migrated in Phase 3)
    const proceduralBackend = new IndexedDBProceduralStore()
    this.procedural = new BaseProceduralStore(proceduralBackend)

    // Inference
    this.inference = getInferenceAdapter()

    // Retrieval + semantic search
    this.semanticSearch = new SemanticSearchBridge()
    this.retrieval = new RetrievalEngine(this.semantic, this.episodic, proceduralBackend)
    this.vectorIndexSync = new VectorIndexSync(this.semanticSearch, {
      getFacts: () => this.semantic.getFacts(),
      getEntities: () => this.semantic.getEntities(),
      getEpisodesBySalience: (t) => this.episodic.getEpisodesBySalience(t),
      getProcedures: () => proceduralBackend.getAllProcedures(),
      getLatestProcedureVersion: async (id) => {
        const versions = await proceduralBackend.getVersionHistory(id)
        return versions.sort((a, b) => b.version - a.version)[0] ?? undefined
      },
    })

    // Working memory
    this.workingMemory = new WorkingMemory(this.config.workingMemoryBudget)

    // Cache consistency (polls mutation events from episodic store)
    this.cache = new CacheConsistencyManager({
      pollFn: (since) => this.episodic.mutationEvents.pollSince(since),
    })

    // Consolidation
    this.consolidation = new ConsolidationManager(this.graph, this.procedural, this.inference, this.vectorIndexSync)
    this.consolidation.setStores(this.episodic, this.semantic)

    const defaultWikiConfig = {
      domainName: "General Knowledge",
      purposeStatement: "Build a comprehensive knowledge base",
      vocabularyHints: [],
      edgeWeightTuning: { wikilinkWeight: 3.0, sharedSourceWeight: 4.0, adamicAdarWeight: 1.5, temporalWeight: 1.0 },
      rawRetentionDays: 30,
      autoIngestVisitedTabs: false,
      blockedUrlPatterns: [],
    }
    this.consolidation.setWikiIngestionJob(new WikiIngestionJob(this.graph, this.inference, this.semantic.wikiPages, this.semantic.wikiRaw, defaultWikiConfig))

    if (this.config.enableCachePolling) this.cache.startPolling()
    if (this.config.enableAutoConsolidation) this.startAutoConsolidation()
    if (this.config.enableSemanticSearch) this.vectorIndexSync.startPeriodicSync(this.config.vectorIndexSyncIntervalMs)

    this.currentSessionId = nextId("sess")
  }

  // ── Public SDK API ───────────────────────────────────────────────────────────

  async ingestTurn(turn: Omit<TurnRecord, "id" | "timestamp">, taskId?: string): Promise<string> {
    this.turnCount++

    const fullTurn: TurnRecord = { ...turn, id: nextId("turn"), timestamp: Date.now(), sessionId: this.currentSessionId }
    await this.episodic.turns.createTurn(fullTurn)

    const episode = {
      id: nextId("ep"),
      version: 1,
      lastMutatedBy: "orchestrator",
      lastMutatedAt: Date.now(),
      sessionId: this.currentSessionId,
      timestamp: fullTurn.timestamp,
      actor: fullTurn.actor,
      summary: fullTurn.content.slice(0, 200),
      rawTurnRefs: [fullTurn.id],
      entities: [],
      outcome: "pending" as const,
      salience: 0.1,
      linkedProcedureIds: [],
      linkedFactIds: [],
    }
    await this.episodic.episodes.createEpisode(episode)

    if (taskId) this.taskEpisodeMap.set(taskId, episode.id)

    const plan = await this.retrieval.retrieve(fullTurn.content)
    const allCandidates = [...plan.candidateSets.semantic, ...plan.candidateSets.episodic, ...plan.candidateSets.procedural]
    this.workingMemory.populateFromCandidates(plan, allCandidates)

    this._schedulePostTurnExtraction(fullTurn.id)
    if (this.turnCount % 3 === 0) await this._checkpointState()
    if (this.turnCount % 10 === 0 && this.config.enableSemanticSearch) this.vectorIndexSync.syncNow().catch(() => {})

    return episode.id
  }

  async recall(query: string, mode?: QueryIntent): Promise<RetrievalPlan> {
    return this.retrieval.retrieve(query, mode)
  }

  async getContext(task: string): Promise<{ workingMemory: ActivationItem[]; formatted: string }> {
    const plan = await this.retrieval.retrieve(task)
    const allCandidates = [...plan.candidateSets.semantic, ...plan.candidateSets.episodic, ...plan.candidateSets.procedural]
    this.workingMemory.populateFromCandidates(plan, allCandidates)
    return { workingMemory: this.workingMemory.getAll(), formatted: this.workingMemory.formatForPrompt() }
  }

  async reportOutcome(taskId: string, outcome: OutcomeType, details?: { failureMode?: string; resolution?: string }): Promise<void> {
    let episodeId = this.taskEpisodeMap.get(taskId)
    if (!episodeId) {
      const recent = await this.episodic.episodes.getRecentEpisodes(20)
      const match = recent.find(e => e.sessionId === this.currentSessionId)
      if (!match) return
      episodeId = match.id
    }

    await this.episodic.episodes.updateEpisode(episodeId, {
      outcome,
      failureMode: details?.failureMode,
      resolution: details?.resolution,
      salience: outcome === "failure" ? 0.8 : outcome === "success" ? 0.6 : 0.3,
    })

    if (outcome === "failure" || outcome === "resolved" || outcome === "success-with-correction") {
      await this.consolidation.scheduleJob("link_episode_to_procedure", [episodeId], 1)
    }
    this.taskEpisodeMap.delete(taskId)
  }

  async getProcedure(taskName: string): Promise<{ procedure: ProcedureRecord; version: ProcedureVersionRecord } | null> {
    const procedure = await this.procedural.getProcedureByName(taskName)
    if (!procedure) return null
    const versionId = procedure.stableVersionId ?? procedure.latestVersionId
    const version = await this.procedural.getVersion(versionId)
    if (!version) return null
    return { procedure, version }
  }

  async getProcedureHistory(procedureId: string): Promise<ProcedureVersionRecord[]> {
    const backend = new IndexedDBProceduralStore()
    return backend.getVersionHistory(procedureId)
  }

  async consolidate(options?: { budgetMs?: number }): Promise<void> {
    await this.consolidation.processNextJobs()
    if (options?.budgetMs) {
      const start = Date.now()
      while (Date.now() - start < options.budgetMs) {
        const processed = await this.consolidation.processNextJobs()
        if (processed === 0) break
      }
    }
  }

  async syncVectorIndex() { return this.vectorIndexSync.syncNow() }

  async stats() {
    const [episodicAll, proceduralAll, graphStats, consolidationStats] = await Promise.all([
      this.episodic.episodes.getRecentEpisodes(10000),
      this.procedural.getAllProcedures(),
      this.graph.stats(),
      this.consolidation.stats(),
    ])
    const factsAll = await this.semantic.getFacts()
    const entitiesAll = await this.semantic.getEntities()

    return {
      workingMemory: this.workingMemory.stats(),
      semantic: { entityCount: entitiesAll.length, factCount: factsAll.length },
      episodic: { total: episodicAll.length, failures: episodicAll.filter(e => e.outcome === "failure").length, highSalience: episodicAll.filter(e => e.salience >= 0.5).length },
      procedural: {
        total: proceduralAll.length,
        experimental: proceduralAll.filter(p => p.status === "experimental").length,
        active: proceduralAll.filter(p => p.status === "active").length,
        stable: proceduralAll.filter(p => p.status === "stable").length,
        deprecated: proceduralAll.filter(p => p.status === "deprecated").length,
      },
      graph: graphStats,
      consolidation: consolidationStats,
      cache: this.cache.stats(),
      semanticSearch: this.semanticSearch.stats(),
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  startAutoConsolidation(): void {
    if (this.consolidationTimer) return
    this.consolidationTimer = setInterval(async () => { await this.consolidation.processNextJobs() }, this.config.consolidationIntervalMs)
  }

  stopAutoConsolidation(): void {
    if (this.consolidationTimer) { clearInterval(this.consolidationTimer); this.consolidationTimer = null }
  }

  async shutdown(): Promise<void> {
    this.stopAutoConsolidation()
    this.cache.stopPolling()
    this.vectorIndexSync.stopPeriodicSync()
    await this._checkpointState()
    await this.consolidation.runMaintenance(true)
  }

  // ── IBrainEngine shims ───────────────────────────────────────────────────────

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
    return this.ingestTurn({ sessionId: (entry.sessionId as string | undefined) ?? this.currentSessionId, actor: 'user', content: entry.content, metadata: { type: entry.type, tags: entry.tags, ...entry.metadata } })
  }

  async search(query: string, options?: SearchOptions): Promise<MemorySearchPage> {
    const plan = await this.retrieval.retrieve(query, options?.intent)
    const all: ScoredCandidate[] = [...plan.candidateSets.semantic, ...plan.candidateSets.episodic, ...plan.candidateSets.procedural]
    const topK = options?.topK ?? 10
    all.sort((a, b) => b.score - a.score)
    const items = all.slice(0, topK).map(c => ({
      entry: { id: c.id, type: (c.kind ?? 'episodic') as MemoryEntry['type'], content: c.content ?? c.summary ?? '', createdAt: new Date().toISOString(), salience: c.score } as MemoryEntry,
      score: c.score,
    }))
    return { items, total: all.length, hasMore: all.length > topK }
  }

  async think(query: string): Promise<ThinkResult> {
    await this.inference.initialize()
    const ctx = await this.getContext(query)
    const result = await this.inference.infer({ model: 'T1', prompt: `Context:\n${ctx.formatted}\n\nQuestion: ${query}\n\nAnswer:`, maxTokens: 500 })
    return { answer: result.text.trim(), confidence: 0.7, sources: [], synthesisQuality: 'T1' }
  }

  async synthesize(): Promise<number> { return this.consolidation.processNextJobs() }

  async getContextPack(prompt: string, _budgetTokens?: number): Promise<ContextPack> {
    await this.getContext(prompt)
    return { artifacts: [], totalTokens: 0 }
  }

  async getWorkingMemory(_sessionId?: string): Promise<MemoryEntry[]> {
    return this.workingMemory.getAll().map(item => ({
      id: item.nodeId, type: (item.nodeKind ?? 'episodic') as MemoryEntry['type'],
      content: item.content ?? '', createdAt: new Date().toISOString(), salience: item.score,
      tags: item.reason ? [item.reason] : [],
    }))
  }

  async getRelated(id: string, relationType?: string): Promise<MemoryEntry[]> {
    const edges = await this.graph.getEdgesFrom(id)
    const filtered = relationType ? edges.filter(e => e.type === relationType) : edges
    return filtered.map(e => ({ id: e.to, type: 'entity' as MemoryEntry['type'], content: e.to, createdAt: new Date().toISOString() }))
  }

  async addRelation(fromId: string, relation: MemoryRelation): Promise<void> {
    await this.graph.createEdge({ from: fromId, to: relation.targetId, type: relation.type as any, weight: relation.weight })
  }

  async runRetentionPolicies(): Promise<RetentionResult> {
    const report = await this.consolidation.runMaintenance()
    return { entriesProcessed: report.demotions.length + report.tombstonesCreated.length + report.pruned.length, entriesCompressed: 0, entriesDeleted: report.tombstonesCreated.length, edgesPruned: report.pruned.length }
  }

  private _ibListeners = new Map<Function, EventListener>()

  on(event: MemoryEvent, callback: (payload: unknown) => void): void {
    const handler: EventListener = (e) => callback((e as CustomEvent).detail ?? null)
    this._ibListeners.set(callback, handler)
    this.addEventListener(event, handler)
  }

  off(event: MemoryEvent, callback: (payload: unknown) => void): void {
    const handler = this._ibListeners.get(callback)
    if (handler) { this.removeEventListener(event, handler); this._ibListeners.delete(callback) }
  }

  async initialize(): Promise<void> { await this.inference.initialize() }
  async close(): Promise<void> { return this.shutdown() }

  // ── Wiki integration ─────────────────────────────────────────────────────────

  async ingestWikiPages(rawIds: string[]): Promise<void> {
    await this.consolidation.scheduleJob("ingest_wiki_page", rawIds, 2)
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _schedulePostTurnExtraction(turnId: string): void {
    const jobTypes: ConsolidationJobType[] = ["extract_semantic", "extract_episode", "extract_procedure"]
    Promise.all(jobTypes.map(type => this.consolidation.scheduleJob(type, [turnId], 1))).catch(
      err => console.error("[SmritiOrchestrator] Failed to schedule post-turn jobs:", err)
    )
  }

  private async _checkpointState(): Promise<void> {
    const snapshot: StateSnapshot = {
      id: nextId("snap"),
      turnId: `turn_${this.turnCount}`,
      snapshotType: "turn",
      timestamp: Date.now(),
      workerId: "orchestrator",
      storeName: "working_memory_snapshots",
      workingMemory: this.workingMemory.getState(),
      graphCacheEntries: [],
      pendingConsolidationJobs: [],
      pendingExtractionJobs: [],
      activeSessionId: this.currentSessionId,
      lastTurnTimestamp: Date.now(),
    }
    await SnapshotStore.save(snapshot)
    await SnapshotStore.prune(10)
  }
}
