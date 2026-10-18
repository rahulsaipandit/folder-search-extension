/**
 * @page-agent/memory - Hybrid Cognitive Memory Platform
 *
 * Core exports for the platform-agnostic layer.
 * Platform-specific adapters are exported from subpaths:
 *   @page-agent/memory/adapters/web    - IndexedDB + Orama
 *   @page-agent/memory/adapters/mobile - SQLite + MLC (Phase 1 mobile)
 *   @page-agent/memory/adapters/desktop - PGLite + pgvector (Phase 3)
 *   @page-agent/memory/vault            - IVaultProvider + MCPVaultClient
 *   @page-agent/memory/agents           - Nemilia archetypes + WorkflowExecutor
 *   @page-agent/memory/interfaces       - All TypeScript interfaces
 */

// ── Interfaces ────────────────────────────────────────────────────────────────
export type { IBrainEngine } from './interfaces/IBrainEngine'
export type { IMemoryIndex } from './interfaces/IMemoryIndex'
export type { IMemoryService } from './interfaces/IMemoryService'
export type { IMemoryStore } from './interfaces/IMemoryStore'
export type { IVaultProvider } from './interfaces/IVaultProvider'

// ── Core types ────────────────────────────────────────────────────────────────
export type {
	BackgroundJob,
	ContextPack,
	EdgeType,
	Entity,
	GraphEdge,
	IndexResult,
	IndexSearchMode,
	IndexSearchOptions,
	JobStatus,
	JobType,
	LifecycleState,
	LintResult,
	ListOptions,
	MemoryEntry,
	MemoryEvent,
	MemoryFilter,
	MemoryListPage,
	MemoryRelation,
	MemorySearchPage,
	MemoryType,
	OutcomeType,
	PageFrontmatter,
	QueryIntent,
	QueryResult,
	RetentionPolicy,
	SearchOptions,
	SourceMetadata,
	SynthesisQuality,
	TieredLLMConfig,
	VaultPage,
	VaultStatus,
	WorkingMemoryConfig,
	// ── Activation / Working Memory (Phase 2 migration) ─────────────────────
	EntityKind,
	NodeKind,
	ActivationItem,
	EvictionPolicy,
	WorkingMemoryBudget,
	// DEFAULT_WM_BUDGET exported as value below (not re-exported here as type)
	// ── Procedural Memory (Phase 1 migration) ────────────────────────────────
	ProcedureStatus,
	ProcedureVersionStatus,
	ProcedurePatchAction,
	ProcedureStep,
	ProcedurePatch,
	ProcedureRecord,
	ProcedureVersionRecord,
	EvolutionPreconditionCheck,
	MergeCandidate,
	// ── Meta-Memory ───────────────────────────────────────────────────────────
	MetaMemoryRecord,
	MutationType,
	MutationEvent,
	// ── State Snapshots ───────────────────────────────────────────────────────
	SnapshotType,
	StateSnapshot,
	RecoveryResult,
	// ── Consolidation Jobs ────────────────────────────────────────────────────
	ConsolidationJobType,
	ConsolidationStatus,
	ConsolidationJob,
	// ── Retention Policy Config ───────────────────────────────────────────────
	RetentionPolicyAction,
	RetentionPolicyConfig,
	MaintenanceReport,
	StorageUsage,
	// ── LLM Inference tiers ───────────────────────────────────────────────────
	InferenceTier,
	// ── Skill Optimization (SkillOpt integration) ─────────────────────────────
	ActionExample,
	ActionEditTarget,
	ActionDocEdit,
	ActionOptimizationInput,
	ActionOptimizationResult,
} from './types'

// MemoryCapability and DEFAULT_WM_BUDGET are const objects - exported as values
export { MemoryCapability, DEFAULT_WM_BUDGET, estimateTokens, truncateToTokens } from './types'
export type { MemoryCapability as MemoryCapabilityValue } from './types'

// ── Procedural Memory ────────────────────────────────────────────────────────
export { ProceduralStore } from './core/procedural/ProceduralStore'
export type { IProceduralStore } from './interfaces/IProceduralStore'

// ── Phase 2: Activation Working Memory ───────────────────────────────────────
export { SmritiWorkingMemory } from './core/working/SmritiWorkingMemory'

// ── Phase 2: Meta-Memory Store ────────────────────────────────────────────────
export { InMemoryMetaMemoryStore } from './core/meta/MetaMemoryStore'
export type { IMetaMemoryStore } from './core/meta/MetaMemoryStore'

// ── Phase 2: Mutation Journal ─────────────────────────────────────────────────
export { InMemoryMutationJournal } from './core/journal/MutationJournal'
export type { IMutationJournal } from './core/journal/MutationJournal'

// ── Phase 2: Snapshot Store ───────────────────────────────────────────────────
export { InMemorySnapshotStore } from './core/snapshot/SnapshotStore'
export type { ISnapshotStore } from './core/snapshot/SnapshotStore'

// ── Phase 3: Cache Consistency Manager ───────────────────────────────────────
export { CacheConsistencyManager } from './core/cache/CacheConsistencyManager'
export type { CacheLine, CacheConsistencyConfig } from './core/cache/CacheConsistencyManager'

// ── Phase 3: IndexedDB Procedural Store ───────────────────────────────────────
export { IndexedDBProceduralStore } from './adapters/web/IndexedDBProceduralStore'

// ── Core implementation ───────────────────────────────────────────────────────
export { MemoryService } from './core/MemoryService'
export type { MemoryServiceConfig } from './core/MemoryService'

// ── Pipeline ──────────────────────────────────────────────────────────────────
export { Pipeline } from './core/pipeline/Pipeline'
export type { PipelineEvent, PipelineEventType } from './core/pipeline/Pipeline'
export { MaintenanceCycle } from './core/pipeline/MaintenanceCycle'
export type {
	MaintenanceCycleConfig,
	MaintenanceCyclePhaseResult,
	MaintenanceCycleResult,
	MaintenancePhaseName,
} from './core/pipeline/MaintenanceCycle'
export {
	enrichEntryWithEntities,
	extractEntityRefs,
} from './core/pipeline/processors/T0EntityExtractor'
export {
	applyDemotePolicy,
	computeSalience,
	evaluateRetentionPolicy,
	recomputeSalience,
} from './core/pipeline/processors/T0SalienceProcessor'
export { T1SummarizationProcessor } from './core/pipeline/processors/T1SummarizationProcessor'
export type { SummarizationResult } from './core/pipeline/processors/T1SummarizationProcessor'

// ── Synthesis ─────────────────────────────────────────────────────────────────
export { SynthesisEngine } from './core/synthesis/SynthesisEngine'
export type { ExtractedConcept, SourceState } from './core/synthesis/SynthesisEngine'

// ── Graph ─────────────────────────────────────────────────────────────────────
export { InProcessGraph } from './core/graph/InProcessGraph'
export { CommunityDetector } from './core/graph/CommunityDetector'
export type { Community } from './core/graph/CommunityDetector'
export { ImpactAnalyzer } from './core/graph/ImpactAnalyzer'
export type { ImpactResult } from './core/graph/ImpactAnalyzer'

// ── Working memory ────────────────────────────────────────────────────────────
export { WorkingMemory, WorkingMemoryManager } from './core/working/WorkingMemory'
export type { WorkingMemoryOptions } from './core/working/WorkingMemory'

// ── Vault ─────────────────────────────────────────────────────────────────────
export { MCPVaultClient, NullVaultProvider } from './vault/MCPVaultClient'
export type { MCPVaultConfig } from './vault/MCPVaultClient'
export { ObsidianVaultProvider } from './vault/ObsidianVaultProvider'
export type { ObsidianVaultConfig } from './vault/ObsidianVaultProvider'

// ── Job queue ─────────────────────────────────────────────────────────────────
export { JobQueue } from './jobs/JobQueue'
export type { JobHandler, JobQueueConfig } from './jobs/JobQueue'

// ── Factory (web) ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-deprecated
export { createWebMemoryService, createWebBrainEngine } from './factory'
export type { CreateWebMemoryServiceOptions } from './factory'

// ── Agents ────────────────────────────────────────────────────────────────────
export { AGENT_DEFINITIONS, WorkflowExecutor, IntelligenceEngine } from './agents/index'
export type {
	AgentDefinition,
	AgentExecutionContext,
	AgentId,
	AgentLLMConfig,
	AgentMemoryContext,
	AgentOutput,
	ParsedToolCall,
	WorkflowDefinition,
	WorkflowResult,
} from './agents/index'

// ── Skills ────────────────────────────────────────────────────────────────────
export {
	ActionRegistry,
	createDefaultActionRegistry,
	parseSemVer,
	compareSemVer,
	prepareActionPrompt,
	extractActionBody,
	calculateAction,
	urlEncodeAction,
	urlDecodeAction,
	currentTimeAction,
	epochTimeAction,
	pageMarkdownAction,
	htmlSanitizeAction,
	svgProcessorAction,
	colorLookupAction,
	textRephraserAction,
	clickAction,
	fillAction,
	scrollAction,
	navigateAction,
	extractTextAction,
	queryWikiAction,
	searchPagesAction,
	executiveSummaryAction,
} from './actions/index'
export type { ParsedActionFile, SemVer } from './actions/index'

// ── Persistence ───────────────────────────────────────────────────────────────
export { InMemoryWorkflowPersistence, HybridWorkflowPersistence } from './persistence/index'
// IndexedDBWorkflowPersistence is browser-only; exported from the subpath instead

// ── New v2.1 types ────────────────────────────────────────────────────────────
export type {
	ThinkResult,
	RetentionResult,
	ActionMeta,
	ActionFrontmatter,
	WorkflowStreamEvent,
	WorkflowStreamEventType,
} from './types'

// ── Autonomous Cognition (Phase 5) ────────────────────────────────────────────
export {
	KnowledgeGapDetector,
	ConflictDetector,
	AutonomousAgent,
	RiskAnalyzer,
} from './core/autonomous/index'
export type {
	KnowledgeGap,
	MemoryConflict,
	AutonomousCycleResult,
	AutonomousAgentConfig,
	RiskItem,
	RiskReport,
} from './core/autonomous/index'

// ── Phase 4: Domain record types ─────────────────────────────────────────────
export type {
	VersionedRecord,
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
	InferenceRequest,
	InferenceResult,
	WikiKnowledgeBaseConfig,
	WikiPage,
	WikiRawEntry,
} from './types'

// ── Phase 4: Inference ────────────────────────────────────────────────────────
export type { IInferenceAdapter } from './core/inference/IInferenceAdapter'
export { BaseInferenceAdapter } from './core/inference/BaseInferenceAdapter'

// ── Phase 4: Retrieval engine ─────────────────────────────────────────────────
export { RetrievalEngine } from './core/retrieval/RetrievalEngine'
export type { ISemanticDataSource, IEpisodicDataSource } from './core/retrieval/RetrievalEngine'

// ── Phase 4: IDB stores (web adapters) ───────────────────────────────────────
export { IndexedDBEpisodicStore, EpisodicStore, TurnStore, MutationEventStore } from './adapters/web/IndexedDBEpisodicStore'
export { IndexedDBSemanticStore, EntityStore, FactStore, MetaStore, WikiPageStore, WikiRawStore } from './adapters/web/IndexedDBSemanticStore'
export { IndexedDBGraphStore } from './adapters/web/IndexedDBGraphStore'
export { IndexedDBJobQueue, JobQueueStore, SnapshotStore } from './adapters/web/IndexedDBJobQueue'

// ── Phase 4: Search adapters ──────────────────────────────────────────────────
export { SemanticSearchBridge } from './adapters/web/OramaIndex'
export type { SemanticIndexEntry, SemanticSearchConfig } from './adapters/web/OramaIndex'
export { OffscreenEmbedder, NullEmbedder } from './adapters/web/OffscreenEmbedder'
export type { IEmbedder, EmbedOptions, OffscreenBridgeFn } from './adapters/web/OffscreenEmbedder'
export { VectorIndexSync } from './adapters/web/VectorIndexSync'
export type { IVectorSyncDataSources } from './adapters/web/VectorIndexSync'

// ── Phase 4: Wiki pipeline ────────────────────────────────────────────────────
export { WikiIngestionJob, WikiRetriever, WikiPageProcessor, WikiEdgeWeights } from './core/wiki/index'
export type { IGraphOps, IWikiStore, IWikiRawStore, IWikiPageRepo } from './core/wiki/index'

// ── Utilities ─────────────────────────────────────────────────────────────────
export { nextId } from './utils/nextId'
