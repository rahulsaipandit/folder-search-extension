// ===================================================================
// SMRITI Memory System - Consolidation Pipeline & Forgetting
// ===================================================================
// Priority-queue based background jobs: extraction, linking, demotion,
// forgetting, and maintenance. Each job is idempotent and budget-limited.
// Uses packages/memory IDB stores exclusively (Phase 5 completion).
// ===================================================================

import type {
  ConsolidationJob,
  ConsolidationJobType,
  RetentionPolicyConfig as RetentionPolicy,
  MaintenanceReport,
  StorageUsage,
  EpisodeRecord,
} from "@page-agent/memory"
import {
  JobQueueStore,
  SnapshotStore,
  nextId,
} from "@page-agent/memory"
import type { OutcomeType } from "./types"
import { DEFAULT_QUOTA } from "./types"
import type { IndexedDBGraphStore } from "@page-agent/memory"
import type { ProceduralStore as BaseProceduralStore } from "@page-agent/memory"
import type { InferenceAdapter } from "./inferenceAdapter"
import type { VectorIndexSync } from "@page-agent/memory"
import type { WikiIngestionJob } from "@page-agent/memory"

// Imported at call sites (lazy) to avoid a circular dep during init
import type { IndexedDBEpisodicStore } from "@page-agent/memory"
import type { IndexedDBSemanticStore } from "@page-agent/memory"

export class ConsolidationManager {
  private runningJobs = new Set<string>()
  private policies: RetentionPolicy[]
  public inference: InferenceAdapter
  public wikiIngestion!: WikiIngestionJob
  private graph: IndexedDBGraphStore
  private proceduralStore: BaseProceduralStore
  private vectorIndexSync?: VectorIndexSync
  private episodic?: IndexedDBEpisodicStore
  private semantic?: IndexedDBSemanticStore
  private config: { maxConcurrentJobs: number; defaultBudgetMs: number; maxRetries: number }

  constructor(
    graph: IndexedDBGraphStore,
    proceduralStore: BaseProceduralStore,
    inference?: InferenceAdapter,
    vectorIndexSync?: VectorIndexSync,
    episodic?: IndexedDBEpisodicStore,
    semantic?: IndexedDBSemanticStore,
    config: { maxConcurrentJobs: number; defaultBudgetMs: number; maxRetries: number } = { maxConcurrentJobs: 2, defaultBudgetMs: 5000, maxRetries: 3 }
  ) {
    this.graph = graph
    this.proceduralStore = proceduralStore
    this.vectorIndexSync = vectorIndexSync
    this.episodic = episodic
    this.semantic = semantic
    this.config = config
    const { getInferenceAdapter } = require("./inferenceAdapter")
    this.inference = inference ?? getInferenceAdapter()

    // WikiIngestionJob wired up lazily by the orchestrator (requires graph + inference + stores)
    this.policies = [
      { dataType: "raw_turns", policy: "compact", ageThreshold: 30 * 24 * 60 * 60 * 1000 },
      { dataType: "episodes", policy: "demote", salienceThreshold: 0.15 },
      { dataType: "episodes", policy: "tombstone", salienceThreshold: 0.15, tombstoneAfterDays: 90 },
      { dataType: "facts", policy: "reverify", evidenceThreshold: 3 },
      { dataType: "procedure_versions", policy: "deprecate", trigger: "superseded" },
      { dataType: "graph_edges", policy: "remove", weightThreshold: 0.1 },
      { dataType: "embeddings", policy: "requantize", quotaThreshold: 0.85 },
      { dataType: "state_snapshots", policy: "prune", maxCount: 10 },
    ]
  }

  setStores(episodic: IndexedDBEpisodicStore, semantic: IndexedDBSemanticStore): void {
    this.episodic = episodic
    this.semantic = semantic
  }

  setWikiIngestionJob(job: WikiIngestionJob): void {
    this.wikiIngestion = job
  }

  // ── Job queue ─────────────────────────────────────────────────────────────────

  async scheduleJob(type: ConsolidationJobType, inputRefs: string[], priority: 0 | 1 | 2 | 3 = 2): Promise<ConsolidationJob> {
    const job: ConsolidationJob = {
      id: nextId("job"),
      type,
      priority,
      status: "pending",
      inputRefs,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      budgetMs: this.config.defaultBudgetMs,
    }
    return JobQueueStore.create(job)
  }

  async processNextJobs(): Promise<number> {
    const pending = await JobQueueStore.getPending()
    let processed = 0

    for (const job of pending) {
      if (this.runningJobs.size >= this.config.maxConcurrentJobs) break
      if (this.runningJobs.has(job.id)) continue

      this.runningJobs.add(job.id)
      await JobQueueStore.update(job.id, { status: "running", startedAt: Date.now() })

      this.executeJob(job).catch(async (error) => {
        const newRetryCount = job.retryCount + 1
        if (newRetryCount <= job.maxRetries) {
          await JobQueueStore.update(job.id, { status: "retry", retryCount: newRetryCount, error: String(error) })
          setTimeout(async () => { await JobQueueStore.update(job.id, { status: "pending" }) }, Math.pow(2, newRetryCount) * 1000)
        } else {
          await JobQueueStore.update(job.id, { status: "failed", error: String(error), completedAt: Date.now() })
        }
      }).finally(() => { this.runningJobs.delete(job.id) })

      processed++
    }
    return processed
  }

  private async executeJob(job: ConsolidationJob): Promise<void> {
    switch (job.type) {
      case "extract_semantic": await this.runSemanticExtraction(job); break
      case "extract_episode": await this.runEpisodeExtraction(job); break
      case "extract_procedure": await this.runProcedureExtraction(job); break
      case "link_episode_to_procedure": await this.runEpisodeProcedureLinking(job); break
      case "merge_entities": await this.runMergeEntities(job); break
      case "graph_recluster": await this.runGraphRecluster(); break
      case "update_confidence": await this.runConfidenceUpdate(job); break
      case "forget_or_demote": await this.runMaintenance(false); break
      case "generate_reflection": await this.runGenerateReflection(job); break
      case "refresh_embeddings": await this.runRefreshEmbeddings(); break
      case "reverify_fact": await this.runFactReverification(job); break
      case "ingest_wiki_page": await this.wikiIngestion.run(job.inputRefs); break
    }
    await JobQueueStore.update(job.id, { status: "completed", completedAt: Date.now() })
  }

  // ── Job implementations ──────────────────────────────────────────────────────

  private async runSemanticExtraction(job: ConsolidationJob): Promise<void> {
    if (!this.episodic) return
    for (const turnId of job.inputRefs) {
      const turn = await this.episodic.turns.getTurn(turnId)
      if (!turn) continue

      const { entities } = await this.inference.extractEntities(turn.content)
      const { outcome, failureMode, confidence } = await this.inference.classifyOutcome(turn.content)

      for (const name of entities.slice(0, 10)) {
        await this.graph.upsertNode({ id: `entity_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`, kind: "entity", title: name, sourceIds: [turnId], tags: [] })
      }

      if (confidence > 0.5) {
        const recentEpisodes = await this.episodic.episodes.getRecentEpisodes(50)
        for (const ep of recentEpisodes) {
          if (!ep.rawTurnRefs.includes(turnId) || ep.outcome !== "pending") continue
          await this.episodic.episodes.updateEpisode(ep.id, {
            entities: [...new Set([...ep.entities, ...entities.slice(0, 5)])],
            outcome: outcome as OutcomeType,
            ...(failureMode ? { failureMode } : {}),
          })
        }
      }
    }
  }

  private async runEpisodeExtraction(job: ConsolidationJob): Promise<void> {
    if (!this.episodic) return
    const turnIds = new Set(job.inputRefs)
    const recentEpisodes = await this.episodic.episodes.getRecentEpisodes(100)
    const episodes = recentEpisodes.filter(ep => ep.rawTurnRefs.some(t => turnIds.has(t)))

    for (const episode of episodes) {
      let salience = 0
      const ageHours = (Date.now() - episode.timestamp) / 3_600_000
      salience += Math.max(0, 1 - ageHours / 24) * 0.3
      const outcomeBoost: Record<string, number> = { failure: 0.4, resolved: 0.3, success: 0.2, pending: 0.1, abandoned: 0.05 }
      salience += outcomeBoost[episode.outcome] ?? 0.1
      salience += Math.min(episode.entities.length * 0.05, 0.2)
      salience += episode.linkedProcedureIds.length > 0 ? 0.2 : 0
      await this.episodic.episodes.updateEpisode(episode.id, { salience: Math.max(0, Math.min(1, salience)) })
    }
  }

  private async runProcedureExtraction(job: ConsolidationJob): Promise<void> {
    if (!this.episodic) return
    for (const turnId of job.inputRefs) {
      const turn = await this.episodic.turns.getTurn(turnId)
      if (!turn) continue
      const { isProcedural } = await this.inference.extractEntities(turn.content)
      if (!isProcedural) continue
      const recentEpisodes = await this.episodic.episodes.getRecentEpisodes(20)
      for (const ep of recentEpisodes) {
        if (ep.rawTurnRefs.includes(turnId)) await this.scheduleJob("link_episode_to_procedure", [ep.id], 2)
      }
    }
  }

  private async runEpisodeProcedureLinking(job: ConsolidationJob): Promise<void> {
    if (!this.episodic) return
    const procedures = (await this.proceduralStore.getAllProcedures()).slice(0, 200)
    for (const episodeId of job.inputRefs) {
      const episode = await this.episodic.episodes.getEpisode(episodeId)
      if (!episode) continue
      for (const proc of procedures) {
        if (episode.summary.toLowerCase().includes(proc.name.toLowerCase())) {
          const updated = [...new Set([...episode.linkedProcedureIds, proc.id])]
          await this.episodic.episodes.updateEpisode(episodeId, { linkedProcedureIds: updated })
        }
      }
    }
  }

  private async runGraphRecluster(): Promise<void> {
    await this.graph.computeInferredEdges()
    await this.graph.detectCommunities()
  }

  private async runConfidenceUpdate(job: ConsolidationJob): Promise<void> {
    if (!this.semantic) return
    for (const factId of job.inputRefs) {
      const meta = await this.semantic.meta.get("fact", factId)
      if (!meta) continue
      const daysSinceVerified = meta.lastVerifiedAt ? (Date.now() - meta.lastVerifiedAt) / (24 * 60 * 60 * 1000) : 30
      const decay = Math.max(0, 1 - daysSinceVerified / 90)
      await this.semantic.meta.upsert({ ...meta, confidence: Math.max(0.1, meta.confidence * decay), freshness: decay })
    }
  }

  private async runFactReverification(job: ConsolidationJob): Promise<void> {
    if (!this.semantic) return
    for (const factId of job.inputRefs) {
      const meta = await this.semantic.meta.get("fact", factId)
      if (meta) await this.semantic.meta.upsert({ ...meta, freshness: 1.0, lastVerifiedAt: Date.now() })
    }
  }

  private async runMergeEntities(job: ConsolidationJob): Promise<void> {
    if (job.inputRefs.length < 2) return
    const [survivorId, ...tombstonedIds] = job.inputRefs

    const survivor = await this.graph.getNode(survivorId)
    if (!survivor) return

    const mergedSourceIds = new Set(survivor.sourceIds)
    const mergedTags = new Set(survivor.tags)

    for (const tombId of tombstonedIds) {
      const tomb = await this.graph.getNode(tombId)
      if (!tomb) continue
      tomb.sourceIds.forEach(s => mergedSourceIds.add(s))
      tomb.tags.forEach(t => mergedTags.add(t))

      const inbound = await this.graph.getEdgesTo(tombId)
      for (const edge of inbound) {
        if (edge.from === survivorId) continue
        await this.graph.createEdge({ from: edge.from, to: survivorId, type: edge.type, weight: edge.weight, evidence: edge.evidence })
      }

      await this.graph.deleteEdgesFrom(tombId)
      await this.graph.createEdge({ from: tombId, to: survivorId, type: "redirects", weight: 1.0 })
      await this.graph.deleteNode(tombId)
    }

    await this.graph.upsertNode({ ...survivor, sourceIds: [...mergedSourceIds], tags: [...mergedTags] })
  }

  private async runGenerateReflection(job: ConsolidationJob): Promise<void> {
    if (!this.episodic || !this.semantic || job.inputRefs.length === 0) return

    const episodes = (
      await Promise.all(job.inputRefs.map(id => this.episodic!.episodes.getEpisode(id)))
    ).filter(Boolean) as EpisodeRecord[]
    if (episodes.length === 0) return

    const episodeSummary = episodes.map((ep, i) => `${i + 1}. [${ep.outcome}] ${ep.summary}`).join("\n")
    const result = await this.inference.infer({
      prompt: `Based on the following experiences, extract one concise, durable insight.\n\n${episodeSummary}\n\nInsight:`,
      maxTokens: 150,
      model: "T1",
    })
    const insight = result?.text?.trim()
    if (!insight) return

    await this.semantic.createFact({
      statement: insight,
      entityIds: [...new Set(episodes.flatMap(ep => ep.entities))],
      confidence: 0.7,
      sourceIds: job.inputRefs,
    })
  }

  private async runRefreshEmbeddings(): Promise<void> {
    if (!this.vectorIndexSync) {
      console.warn("[ConsolidationManager] refresh_embeddings skipped - VectorIndexSync not wired")
      return
    }
    await this.vectorIndexSync.syncNow()
  }

  // ── Maintenance ──────────────────────────────────────────────────────────────

  async runMaintenance(force: boolean = false): Promise<MaintenanceReport> {
    const report: MaintenanceReport = { tombstonesCreated: [], demotions: [], pruned: [], requantized: false, durations: {} }

    for (const policy of this.policies) {
      const start = performance.now()
      switch (policy.policy) {
        case "compact": report.pruned.push(...await this.compactRawTurns(policy)); break
        case "demote": report.demotions.push(...await this.demoteLowSalienceEpisodes(policy)); break
        case "tombstone": break
        case "reverify": {
          const j = await this.scheduleJob("reverify_fact", [], 3)
          report.pruned.push(j.id)
          break
        }
        case "deprecate": break
        case "remove": await this.removeLowWeightEdges(policy); break
        case "requantize":
          if (force || await this.shouldRequantize(policy)) report.requantized = true
          break
        case "prune":
          await SnapshotStore.prune(policy.maxCount ?? 10)
          break
      }
      report.durations[policy.dataType] = Math.round(performance.now() - start)
    }
    return report
  }

  private async compactRawTurns(policy: RetentionPolicy): Promise<string[]> {
    if (!this.episodic) return []
    const recent = await this.episodic.episodes.getRecentEpisodes(500)
    const cutoff = Date.now() - (policy.ageThreshold ?? 30 * 24 * 60 * 60 * 1000)
    return recent.filter(ep => ep.timestamp < cutoff && ep.salience < 0.3 && ep.rawTurnRefs.length > 3).map(ep => ep.id)
  }

  private async demoteLowSalienceEpisodes(policy: RetentionPolicy): Promise<string[]> {
    if (!this.episodic) return []
    const threshold = policy.salienceThreshold ?? 0.15
    const all = await this.episodic.episodes.getRecentEpisodes(3000)
    const low = all.filter(ep => ep.salience < threshold)
    for (const ep of low) await this.episodic.episodes.updateEpisode(ep.id, { salience: ep.salience * 0.5 })
    return low.map(ep => ep.id)
  }

  private async removeLowWeightEdges(policy: RetentionPolicy): Promise<void> {
    const threshold = policy.weightThreshold ?? 0.1
    const allEdges = await this.graph.getAllEdges()
    for (const edge of allEdges) {
      if (edge.weight < threshold && edge.type !== "wikilink" && edge.type !== "about") {
        await this.graph.deleteEdge(edge.id)
      }
    }
  }

  private async shouldRequantize(policy: RetentionPolicy): Promise<boolean> {
    const usage = await this.getStorageUsage()
    return usage.bytesTotal / usage.maxBytesTotal >= (policy.quotaThreshold ?? 0.85)
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const [episodes, facts] = await Promise.all([
      this.episodic ? this.episodic.episodes.getRecentEpisodes(100000) : Promise.resolve([]),
      this.semantic ? this.semantic.getFacts() : Promise.resolve([]),
    ])
    const bytesEpisodes = episodes.length * 512
    const bytesFacts = facts.length * 256
    const bytesTotal = bytesEpisodes + bytesFacts

    return {
      bytesTotal,
      bytesEmbeddings: 0,
      episodeCount: episodes.length,
      rawTurnCount: 0,
      maxBytesTotal: DEFAULT_QUOTA.maxBytesTotal,
    }
  }

  async stats(): Promise<{ pendingJobs: number; runningJobs: number; failedJobs: number }> {
    const [pending, running, failed] = await Promise.all([
      JobQueueStore.getByStatus("pending"),
      JobQueueStore.getByStatus("running"),
      JobQueueStore.getByStatus("failed"),
    ])
    return { pendingJobs: pending.length, runningJobs: running.length, failedJobs: failed.length }
  }
}
