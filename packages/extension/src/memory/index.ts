// ===================================================================
// SMRITI Memory System - Public API
// ===================================================================
// Phase 5 complete: all storage goes through @page-agent/memory.
// The extension exposes only the orchestrator + consolidation manager.
// ===================================================================

// ─── Orchestrator (main entry point) ──────────────────────────────
export { SmritiOrchestrator } from "./orchestrator"
export type { SmritiMemoryConfig } from "./orchestrator"

// ─── Extension-local classes ──────────────────────────────────────
export { ConsolidationManager } from "./consolidation"
export { InferenceAdapter, getInferenceAdapter } from "./inferenceAdapter"

// ─── Types from @page-agent/memory (canonical source) ────────────
export type {
  EntityKind,
  NodeKind,
  ActivationItem,
  EvictionPolicy,
  WorkingMemoryBudget,
  ProcedureRecord,
  ProcedureVersionRecord,
  ProcedureStep,
  ProcedureStatus,
  ProcedureVersionStatus,
  ProcedurePatch,
  ProcedurePatchAction,
  EvolutionPreconditionCheck,
  MergeCandidate,
  MetaMemoryRecord,
  MutationEvent,
  MutationType,
  ConsolidationJob,
  ConsolidationJobType,
  ConsolidationStatus as JobStatus,
  RetentionPolicyConfig,
  RetentionPolicyAction,
  MaintenanceReport,
  StorageUsage,
  // Phase 4 types
  VersionedRecord,
  OutcomeType,
  EntityRecord,
  FactRecord,
  TurnRecord,
  EpisodeRecord,
  GraphEdgeType,
  GraphNodeRecord,
  StoredGraphEdge,
  RetrievalIntent,
  ScoredCandidate,
  RetrievalPlan,
  InferenceTier,
  InferenceRequest,
  InferenceResult,
  WikiKnowledgeBaseConfig,
  WikiPage,
  WikiRawEntry,
  // Phase 4 adapters/classes
  IndexedDBEpisodicStore,
  IndexedDBSemanticStore,
  IndexedDBGraphStore,
  IndexedDBJobQueue,
  IEmbedder,
  OffscreenBridgeFn,
  IVectorSyncDataSources,
  IGraphOps,
  IWikiStore,
  IWikiRawStore,
} from "@page-agent/memory"

// ─── Extension-local types ────────────────────────────────────────
export type {
  StorageQuota,
  GraphCacheEntry,
  StateSnapshot,
  SnapshotType,
  RecoveryResult,
  SystemState,
} from "./types"

export { DEFAULT_QUOTA } from "./types"
export {
  DEFAULT_WM_BUDGET,
  SmritiWorkingMemory as WorkingMemory,
  CacheConsistencyManager,
  ProceduralStore,
  IndexedDBProceduralStore,
} from "@page-agent/memory"
