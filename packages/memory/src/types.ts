/**
 * Core types for the Hybrid Cognitive Memory Platform.
 * All platform-agnostic types live here - no storage or LLM imports.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Activation / Working Memory  (Phase 2 migration from extension)
// ─────────────────────────────────────────────────────────────────────────────

export type EntityKind =
	| 'entity' | 'fact' | 'topic' | 'page'
	| 'episode' | 'procedure' | 'procedureVersion'
	| 'outcome' | 'cue'

export type NodeKind = EntityKind

export interface ActivationItem {
	nodeId: string
	nodeKind: NodeKind
	score: number
	reason: 'query_match' | 'graph_neighbor' | 'recent' | 'pinned' | 'task_context'
	expiresAt?: number
	content?: string
	isPinned?: boolean
}

export type EvictionPolicy = 'fifo' | 'lru' | 'lowest_score'

// Fix #6: Extended to cover all MemoryTypes introduced in the GA migration (goal, entity, prospective). 
// Without per-type caps for these types, a burst of goal or entity entries fills the entire maxItems budget and starves episodic and semantic entries. 
// Optional fields allow callers to omit types they don't use.
export interface WorkingMemoryBudget {
	maxItems: number
	maxTokensPerItem: number
	maxTotalTokens: number
	maxSemanticItems: number
	maxEpisodicItems: number
	maxProceduralItems: number
	maxGoalItems?: number        // cap for type='goal' entries
	maxEntityItems?: number      // cap for type='entity' entries
	maxProspectiveItems?: number // cap for type='prospective' entries
	evictionPolicy: EvictionPolicy
}

// Fix #6: GA's WorkingMemoryManager uses DEFAULT_PER_TYPE = 6 uniform caps across
// all types. The old CB budget (3/2/1 split summing to 6) was designed before
// 'goal', 'entity', and 'prospective' types existed. maxItems = 30 allows
// 5 per type × 6 types without artificially starving any category.
export const DEFAULT_WM_BUDGET: WorkingMemoryBudget = {
	maxItems: 30,
	maxTokensPerItem: 512,
	maxTotalTokens: 4096,
	maxSemanticItems: 6,
	maxEpisodicItems: 6,
	maxProceduralItems: 6,
	maxGoalItems: 6,
	maxEntityItems: 6,
	maxProspectiveItems: 6,
	evictionPolicy: 'lowest_score',
}

// ─────────────────────────────────────────────────────────────────────────────
// Token utilities (shared by WorkingMemory and pipeline processors)
// ─────────────────────────────────────────────────────────────────────────────

// Fix #5: Use GA's formula (÷3.5 × 1.1) instead of the common ÷4 ASCII rule-of-thumb.
// ÷3.5 accounts for multilingual/emoji content that tokenizes denser than ASCII.
// ×1.1 adds a 10% safety margin so budget checks never run over.
// WorkingMemoryManager and ContextBuilder both use this — a looser formula here
// would silently undercount tokens and allow working memory to exceed its budget.
export function estimateTokens(text: string): number {
	return Math.ceil((text.length / 3.5) * 1.1)
}

// truncateToTokens must use the same char-per-token ratio as estimateTokens.
// ÷3.5 matches estimateTokens so a truncated string never exceeds its token budget.
export function truncateToTokens(text: string | undefined, maxTokens: number): string {
	if (!text) return ''
	const maxChars = Math.floor(maxTokens * 3.5)
	return text.length > maxChars ? text.slice(0, maxChars) + '...' : text
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Entry
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryType =
	| 'episodic' // Raw event: conversation, task, browser event, code session
	| 'semantic' // L1 summary of a high-importance episode
	| 'insight' // L2 deep insight from semantic memories
	| 'procedure' // How to do something (steps, workflow) - renamed from 'procedural'
	| 'goal' // User objective managed by GoalManager
	| 'entity' // Named entity (person, project, system)
	| 'working' // Session-scoped context, never persisted long-term
	| 'artifact' // Vault-sourced canonical knowledge artifact
	| 'prospective' // Future-oriented trigger: fire when a time or topic condition is met

export type LifecycleState =
	| 'active' // Normal retrieval, indexed
	| 'compressed' // Content compressed, still retrievable
	| 'archived' // Low salience, rarely retrieved
	| 'synthesized' // Represented in vault artifact
	| 'deprecated' // Superseded by newer synthesis
	| 'deleted' // Soft-deleted, tombstoned

// Fix #2: Added 'success-with-correction' from EpisodeOutcome (Phase 4 extension port).
// EpisodeRecord.outcome previously used a separate EpisodeOutcome type that included
// this value. When episodes are promoted into MemoryEntry objects the outcome field
// is copied across — if the types differ a lossy coercion is required at the promotion
// site. Unifying here means the promotion is type-safe with no information loss.
export type OutcomeType =
	| 'success'
	| 'success-with-correction' // episode completed but required a mid-course correction
	| 'failure'
	| 'pending'
	| 'resolved'
	| 'abandoned'

/**
 * Trigger condition for prospective memory entries.
 * Stored in metadata.trigger.
 * - time:  fires when fireAt <= now (checked on session start)
 * - topic: fires when an incoming message is semantically similar to topicCue
 */
export interface ProspectiveTrigger {
	type: 'time' | 'topic'
	fireAt?: string       // ISO timestamp - required when type = 'time'
	topicCue?: string     // cue phrase - required when type = 'topic'; also stored in content for indexing
	minSimilarity?: number // similarity threshold for topic triggers (default 0.7)
}

export type RetentionPolicy =
	| 'compact_raw' // age > 30 days AND salience < 0.3 → compress
	| 'demote_episode' // salience < 0.15 → halve salience
	| 'tombstone_episode' // age > 90 days AND salience < 0.15 → soft-delete
	| 'reverify_fact' // confidence < 3 sources → mark for verification
	| 'deprecate_procedure' // superseded by newer version
	| 'prune_edges' // graph edge weight < 0.1 → remove
	| 'requantize_embeddings' // storage > 85% quota → compress float32→uint8

export type SynthesisQuality = 'T1' | 'T2'

export interface MemoryRelation {
	targetId: string
	type: EdgeType
	weight?: number // 0–1, used for graph pruning
	metadata?: Record<string, unknown>
}

export interface MemoryEntry {
	id: string
	type: MemoryType
	content: string
	title?: string
	createdAt: string // ISO-8601
	updatedAt?: string // ISO-8601

	// Salience signals
	importance?: number // 1–5, static LLM score (T1 pipeline gate)
	confidence?: number // 0–1
	salience?: number // 0–1, dynamic (recomputed hourly)
	outcome?: OutcomeType

	// Provenance
	sourceIds?: string[] // Back-links to source entries
	relations?: MemoryRelation[]
	entities?: string[] // Named entity IDs referenced
	tags?: string[]
	linkedProcedureIds?: string[]

	// Retrieval statistics
	retrievalCount?: number

	// Lifecycle
	retentionPolicy?: RetentionPolicy
	compressionLevel?: number // 0 = full, 1 = compressed, 2 = heavy compressed
	lifecycleState?: LifecycleState

	// Synthesis
	synthesisQuality?: SynthesisQuality
	synthesizedAt?: string

	// Context
	userId?: string
	agentId?: string
	sessionId?: string
	metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Search & Filter
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryFilter {
	type?: MemoryType | MemoryType[]
	tags?: string[]
	/** 'all' = AND (default), 'any' = OR - controls multi-tag matching semantics */
	tagMatchMode?: 'all' | 'any'
	lifecycleState?: LifecycleState | LifecycleState[]
	sessionId?: string
	userId?: string
	agentId?: string
	minSalience?: number
	minImportance?: number
	outcome?: OutcomeType[]
	timeRange?: { start?: string; end?: string }
	maxAge?: number // milliseconds
	ids?: string[]
}

export interface SearchOptions {
	topK?: number
	filter?: MemoryFilter
	intent?: QueryIntent
	includeArchived?: boolean
}

export interface MemorySearchPage {
	items: { entry: MemoryEntry; score: number }[]
	total: number
	hasMore: boolean
}

export interface ListOptions {
	filter?: MemoryFilter
	limit?: number
	offset?: number
	orderBy?: 'createdAt' | 'salience' | 'updatedAt'
	order?: 'asc' | 'desc'
}

export interface MemoryListPage {
	items: MemoryEntry[]
	total: number
	hasMore: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query intent taxonomy - unified from GA's ContextBuilder (6 semantic intents)
 * and CB's original retrieval intents (4 signal-weight presets).
 *
 * GA intents drive regex-based intent detection and per-signal content boosts.
 * CB intents act as weight-distribution presets that GA intents now map into.
 * 'general' is the fallback when no pattern fires.
 *
 * SubjectBoost: a proper noun extracted from the query gets +0.2 added to the
 * final score of any entry whose title or content mentions that noun.
 */
export type QueryIntent =
	// CB original signal-weight presets
	| 'factual'       // High similarity + reliability; low recency
	| 'experiential'  // High recency + salience; low reliability
	| 'procedure'     // How-to / steps / method queries; boosts type='procedure' entries (GA name; CB had 'procedural')
	| 'mixed'         // Balanced weights; fallback preset
	// GA semantic intents (ContextBuilder port)
	| 'residence'     // Where someone lives / address / location
	| 'employment'    // Where someone works / job / company / role
	| 'temporal'      // When something happened / dates / timeline
	| 'preference'    // Likes, dislikes, favorites, opinions
	| 'identity'      // Who someone is / background / profile (entity type boost)
	| 'general'       // Fallback when no pattern fires

export type IndexSearchMode = 'keyword' | 'semantic' | 'hybrid'

export interface IndexSearchOptions {
	topK?: number
	filter?: MemoryFilter
	intent?: QueryIntent
	/** Search mode. Defaults to 'hybrid' when an embeddingFn is available, else 'keyword'. */
	mode?: IndexSearchMode
}

export interface IndexResult {
	id: string
	score: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Graph
// ─────────────────────────────────────────────────────────────────────────────

export type EdgeType =
	| 'attended' // person attended event
	| 'works_at' // person works at organization
	| 'invested_in' // entity invested in project/company
	| 'founded' // person founded organization
	| 'advises' // person advises entity
	| 'mentions' // document mentions entity
	| 'depends_on' // system depends on system
	| 'owns' // person/team owns artifact
	| 'contradicts' // knowledge contradicts other knowledge
	| 'derived_from' // synthesized artifact derived from source
	| 'summarizes' // L1/L2 memory summarizes another
	| 'references' // generic reference
	| 'related_to' // generic bidirectional relation (GA wiki graph edges)
	| 'parent' // hierarchical parent (procedure versioning)
	| 'child' // hierarchical child (procedure versioning)

export interface Entity {
	id: string
	name: string
	type: 'person' | 'organization' | 'project' | 'system' | 'concept' | 'location' | 'other'
	aliases?: string[]
	metadata?: Record<string, unknown>
}

export interface GraphEdge {
	from: string
	type: EdgeType
	to: string
	weight: number
	createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline & Jobs
// ─────────────────────────────────────────────────────────────────────────────

export type JobType =
	| 'extract_entities' // T0: entity extraction from new episodes
	| 'compute_salience' // T0: recompute salience scores
	| 'extract_semantic' // T1: summarize episode → semantic memory
	| 'link_to_procedure' // T1: match episode to existing procedure
	| 'synthesis_compile' // T1/T2: compile changed sources into vault artifacts
	| 'graph_recluster' // T0: recompute inferred edges
	| 'update_confidence' // T0: temporal decay of fact confidence
	| 'upgrade_synthesis' // T2 desktop only: upgrade T1 artifacts to T2
	| 'ingest_source' // T2 desktop only: ingest new external source
	| 'vault_sync' // MCP: push/pull vault artifacts

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface BackgroundJob {
	id: string
	type: JobType
	priority: number
	status: JobStatus
	inputRefs: string[]
	budgetMs: number
	retryCount: number
	scheduledAt: string
	startedAt?: string
	completedAt?: string
	error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryEvent =
	| 'entry.created'
	| 'entry.updated'
	| 'entry.deleted'
	| 'processing.started'
	| 'processing.completed'
	| 'processing.failed'
	| 'synthesis.triggered'
	| 'synthesis.completed'
	| 'maintenance.completed'
	| 'vault.pushed'
	| 'vault.pulled'

// ─────────────────────────────────────────────────────────────────────────────
// Vault
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultPage {
	slug: string
	title: string
	content: string
	frontmatter: PageFrontmatter
	updatedAt: string
}

export interface PageFrontmatter {
	title: string
	// OKF v0.1 fields (v2.3) — makes vault artifacts compatible with Open Knowledge Format
	type?: string           // concept type: 'synthesis' | 'insight' | 'procedure' | 'entity' | ...
	resource?: string       // canonical source URL; omit for synthesized-only artifacts
	timestamp?: string      // ISO-8601 alias for synthesizedAt — OKF's last-update field
	// Synthesis metadata
	sources?: string[]
	synthesisQuality?: SynthesisQuality
	synthesizedBy?: string
	synthesizedAt?: string
	lastUpgradedAt?: string | null
	confidence?: number
	provenanceState?: 'extracted' | 'merged' | 'inferred' | 'ambiguous'
	contradictedBy?: string[]
	tags?: string[]
	aliases?: string[]
	[key: string]: unknown
}

export interface SourceMetadata {
	slug: string
	title?: string
	type?: string
	tags?: string[]
}

export interface CompileOptions {
	forceRecompile?: boolean
	quality?: SynthesisQuality
}

export interface CompileResult {
	pagesCompiled: number
	pagesSkipped: number
	errors: string[]
}

export interface QueryResult {
	answer: string
	sources: string[]
	confidence: number
}

export interface ContextPack {
	artifacts: VaultPage[]
	totalTokens: number
}

export interface LintResult {
	issues: { slug: string; message: string; severity: 'error' | 'warning' }[]
}

export interface VaultStatus {
	pageCount: number
	lastSyncAt?: string
	provider: string
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Inference Tiers
// ─────────────────────────────────────────────────────────────────────────────

export type InferenceTier = 'T0' | 'T1' | 'T2' | 'T3'

export interface TieredLLMConfig {
	t1?: {
		baseURL: string
		model: string
		apiKey?: string
	}
	t2?: {
		baseURL: string
		model: string
		apiKey?: string
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Working Memory
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkingMemoryConfig {
	tokenBudget?: number // default 4096
	sessionId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Capabilities
// ─────────────────────────────────────────────────────────────────────────────

export const MemoryCapability = {
	VECTOR_SEARCH: 'VECTOR_SEARCH',
	GRAPH_REASONING: 'GRAPH_REASONING',
	TEMPORAL_MEMORY: 'TEMPORAL_MEMORY',
	SUMMARIZATION: 'SUMMARIZATION',
	ENTITY_LINKING: 'ENTITY_LINKING',
	MEMORY_COMPRESSION: 'MEMORY_COMPRESSION',
	RERANKING: 'RERANKING',
	CROSS_DEVICE_SYNC: 'CROSS_DEVICE_SYNC',
} as const

export type MemoryCapability = (typeof MemoryCapability)[keyof typeof MemoryCapability]

// ─────────────────────────────────────────────────────────────────────────────
// IBrainEngine result types (v2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ThinkResult {
	answer: string
	confidence: number        // 0–1
	sources: string[]         // entry IDs used
	synthesisQuality: SynthesisQuality
}

export interface RetentionResult {
	entriesProcessed: number
	entriesCompressed: number
	entriesDeleted: number
	edgesPruned: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill System types (v2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionMeta {
	id: string
	name: string
	description: string
	version: string
	category: string
	fallbackToLLM: boolean
	timeoutMs: number
	userInvocable: boolean
}

export interface ActionFrontmatter {
	name: string
	description: string
	version: string
	'allowed-tools'?: string
	'disable-model-invocation'?: boolean
	'user-invocable'?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Streaming (v2.1)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowStreamEventType =
	| 'agent.started'
	| 'agent.token'
	| 'agent.tool_call'
	| 'agent.tool_result'
	| 'agent.completed'
	| 'workflow.completed'
	| 'workflow.error'

export interface WorkflowStreamEvent {
	type: WorkflowStreamEventType
	agentId?: string
	stageNumber?: number
	token?: string
	toolCall?: { actionId: string; args: unknown }
	toolResult?: unknown
	output?: unknown           // AgentOutput - typed in agents module
	result?: unknown           // WorkflowResult - typed in agents module
	error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioned Procedural Memory
// Ported from packages/extension/src/memory/types.ts - Phase 1 migration.
// ─────────────────────────────────────────────────────────────────────────────

// Fix #1: Added 'candidate' as the initial SMRITI promotion state.
// ProcedureLearningProcessor creates procedures with status='candidate' — meaning
// "derived from a single episode, zero execution history, not yet validated".
// Without this member the assignment is a TS error at the processor. 'candidate'
// is meaningfully distinct from 'experimental': experimental implies at least one
// attempted execution; candidate has never been tried.
export type ProcedureStatus =
	| 'candidate'    // created from a single episode; no executions yet
	| 'experimental' // attempted at least once, not yet consistently successful
	| 'active'       // validated, in regular use
	| 'stable'       // multiple consecutive successes
	| 'deprecated'   // superseded by a newer version
	| 'archived'     // soft-deleted, kept for audit

export type ProcedureVersionStatus = 'experimental' | 'active' | 'stable' | 'deprecated'

export interface ProcedureStep {
	id: string
	name: string
	description: string
	order: number
	preconditions?: string[]
	validationChecks?: string[]
	expectedOutcome?: string
	entities?: string[]
	isCritical?: boolean
}

// Fix #4: Replaced the flat string union with a discriminated union matching
// core/types/ProcedureRecord.ts. The processors (ProcedureEvolutionProcessor,
// ProcedureLearningProcessor) imported from that file because the string union here
// lacked the typed payloads needed for exhaustive switch/case handling. The
// discriminated union is strictly richer: each action variant carries only the fields
// it actually needs, which prevents accidental misuse (e.g. passing a targetStepId
// to a 'deprecate' action). After this change, core/types/ProcedureRecord.ts becomes
// a re-export shim so processor imports continue to compile without modification.
export interface InsertStepAction {
	type: 'insert_step'
	step: ProcedureStep
	afterStepId?: string   // insert after this step; if omitted, append
}

export interface ReplaceStepAction {
	type: 'replace_step'
	stepId: string
	replacement: ProcedureStep
}

export interface RemoveStepAction {
	type: 'remove_step'
	stepId: string
}

export interface ReorderStepsAction {
	type: 'reorder_steps'
	orderedStepIds: string[]   // new complete ordering by step ID
}

export interface AddPreconditionAction {
	type: 'add_precondition'
	stepId: string
	precondition: string
}

export interface RemovePreconditionAction {
	type: 'remove_precondition'
	stepId: string
	precondition: string
}

export interface AddValidationAction {
	type: 'add_validation'
	stepId: string
	validation: string
}

export interface RemoveValidationAction {
	type: 'remove_validation'
	stepId: string
	validation: string
}

export interface SplitProcedureAction {
	type: 'split_procedure'
	splitAfterStepId: string    // steps up to and including this ID stay in parent
	newProcedureTitle: string
	newProcedureDomain: string
}

export interface MergeProcedureAction {
	type: 'merge_procedure'
	sourceProcedureId: string   // merge steps from this procedure into current
	insertAfterStepId?: string  // where to splice; if omitted, append
}

export interface DeprecateAction {
	type: 'deprecate'
	reason: string
}

export type ProcedurePatchAction =
	| InsertStepAction
	| ReplaceStepAction
	| RemoveStepAction
	| ReorderStepsAction
	| AddPreconditionAction
	| RemovePreconditionAction
	| AddValidationAction
	| RemoveValidationAction
	| SplitProcedureAction
	| MergeProcedureAction
	| DeprecateAction

export interface ProcedurePatch {
	actions: ProcedurePatchAction[] // array: a single episode may generate multiple patch ops
	confidence: number              // 0–1; patch is rejected if < 0.7
	rationale: string               // LLM explanation for the batch of actions
}

// Outcome of a single validation check in ProcedureEvolutionProcessor.
export interface ValidationCheckResult {
	passed: boolean
	checkName: string
	reason?: string
}

// Runtime metadata stored in MemoryEntry.metadata.procedure for type='procedure' entries.
// Separated from ProcedureRecord (the extension's versioned store row) because the
// Expo app stores procedures as MemoryEntries, not as rows in a separate procedures table.
export interface ProcedureMetadata {
	steps: ProcedureStep[]
	domain: string                  // e.g. 'professional', 'learning', 'health', 'personal'
	linkedGoalIds: string[]
	latestVersionId: string         // ID of the current latest-version MemoryEntry
	reliabilityScore: number        // 0–1, starts 0.5
	successCount: number
	failureCount: number
	consecutiveSuccesses: number
	// Promotion ladder (enforced by ProcedureLearningProcessor / ProcedureEvolutionProcessor):
	//   candidate    → experimental  after 1 success
	//   experimental → active        after 2+ successes
	//   active       → stable        after 3 consecutive successes
	//   stable                       after 5 consecutive successes (terminal promotion)
	status: ProcedureStatus
}

export interface ProcedureRecord {
	id: string
	version: number
	lastMutatedBy: string
	lastMutatedAt: number
	name: string
	domain: string
	latestVersionId: string
	stableVersionId?: string
	status: ProcedureStatus
	createdAt: number
	updatedAt: number
	tags: string[]
	linkedEntities: string[]
	reliabilityScore: number
	successCount: number
	failureCount: number
	consecutiveSuccesses: number
}

export interface ProcedureVersionRecord {
	id: string
	version: number
	lastMutatedBy: string
	lastMutatedAt: number
	procedureId: string
	parentVersionId?: string
	steps: ProcedureStep[]
	rationale: string
	createdFromEpisodeIds: string[]
	createdAt: number
	successCount: number
	failureCount: number
	status: ProcedureVersionStatus
}

export interface EvolutionPreconditionCheck {
	procedureId: string
	currentVersionId: string
	episodeId: string
	patch: ProcedurePatch
	checks: {
		patchIsBackwardCompatible: boolean
		patchDoesNotDuplicateExistingSteps: boolean
		patchReferencesOnlyExistingEntities: boolean
		patchHasTestableOutcome: boolean
		patchStepCountWithinBounds: boolean
		patchDoesNotCreateCircularDependency: boolean
	}
	overallPass: boolean
	failureReasons: string[]
	confidenceThreshold: number
	warnings: string[]
}

export interface MergeCandidate {
	sourceProcedureId: string
	targetProcedureId: string
	sourceVersionId: string
	targetVersionId: string
	similarity: number
	stepOverlap: number
	entityOverlap: number
	rationale: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta-Memory (per-subject confidence tracking)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaMemoryRecord {
	subjectId: string
	subjectType: 'entity' | 'fact' | 'procedure' | 'topic'
	confidence: number       // 0–1, decays over time
	freshness: number        // 0–1, 1 = verified recently
	evidenceCount: number    // number of supporting observations
	contradictionCount: number
	stability: number        // 0–1, how rarely this changes
	lastVerifiedAt?: number  // epoch ms
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Event Journal (write-ahead log for cross-worker consistency)
// ─────────────────────────────────────────────────────────────────────────────

export type MutationType = 'create' | 'update' | 'delete' | 'tombstone'

export interface MutationEvent {
	id: string
	timestamp: number
	workerId: string
	storeName: string
	recordIds: string[]
	mutationType: MutationType
	summary: string
	dependencies?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// State Snapshots (checkpointing + recovery)
// ─────────────────────────────────────────────────────────────────────────────

export type SnapshotType = 'turn' | 'consolidation' | 'periodic'

export interface StateSnapshot {
	id: string
	turnId: string
	snapshotType: SnapshotType
	timestamp: number
	workerId: string
	storeName: string
	workingMemory: {
		items: unknown[]      // ActivationItem[] - avoid circular import; cast at use site
		budget: unknown       // WorkingMemoryBudget
	}
	graphCacheEntries: Array<{
		nodeId: string
		nodeKind: string
		serialized: string
		version: number
	}>
	pendingConsolidationJobs: string[]
	pendingExtractionJobs: string[]
	activeSessionId: string
	lastTurnTimestamp: number
	activeTaskContext?: {
		taskId: string
		taskType: string
		pinnedItems: string[]
	}
}

export interface RecoveryResult {
	recovered: boolean
	reason?: string
	lostItems: string[]
	recoveredItems: string[]
	resumedJobs?: string[]
	activeSessionId?: string
	activeTaskContext?: StateSnapshot['activeTaskContext']
	timeToRecover: number
	coldStart?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidation Jobs (richer than BackgroundJob - includes priority + retry state)
// ─────────────────────────────────────────────────────────────────────────────

export type ConsolidationJobType =
	| 'extract_semantic'
	| 'extract_episode'
	| 'extract_procedure'
	| 'link_episode_to_procedure'
	| 'merge_entities'
	| 'graph_recluster'
	| 'update_confidence'
	| 'forget_or_demote'
	| 'generate_reflection'
	| 'refresh_embeddings'
	| 'reverify_fact'
	| 'ingest_wiki_page'

export type ConsolidationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retry'

export interface ConsolidationJob {
	id: string
	type: ConsolidationJobType
	priority: 0 | 1 | 2 | 3
	status: ConsolidationStatus
	inputRefs: string[]
	outputRefs?: string[]
	createdAt: number
	startedAt?: number
	completedAt?: number
	retryCount: number
	maxRetries: number
	error?: string
	budgetMs: number
	checkpointData?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention Policy (configuration interface - distinct from the string-union
// RetentionPolicy which is used as a MemoryEntry field)
// ─────────────────────────────────────────────────────────────────────────────

export type RetentionPolicyAction =
	| 'compact'
	| 'demote'
	| 'tombstone'
	| 'reverify'
	| 'deprecate'
	| 'remove'
	| 'requantize'
	| 'prune'

export interface RetentionPolicyConfig {
	dataType: string
	policy: RetentionPolicyAction
	ageThreshold?: number       // ms
	salienceThreshold?: number  // 0–1
	weightThreshold?: number    // 0–1
	evidenceThreshold?: number
	quotaThreshold?: number     // 0–1 of storage quota
	tombstoneAfterDays?: number
	maxCount?: number
	trigger?: string
}

export interface MaintenanceReport {
	tombstonesCreated: string[]
	demotions: string[]
	pruned: string[]
	requantized: boolean
	durations: Record<string, number>
}

export interface StorageUsage {
	bytesTotal: number
	bytesEmbeddings: number
	episodeCount: number
	rawTurnCount: number
	maxBytesTotal: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain Record Types - Phase 4 migration from packages/extension/src/memory
// ─────────────────────────────────────────────────────────────────────────────

export interface VersionedRecord {
	id: string
	version: number
	lastMutatedBy: string
	lastMutatedAt: number
}

// Fix #2 (continued): EpisodeOutcome is removed — OutcomeType now covers all its
// values. EpisodeRecord.outcome below uses OutcomeType directly. This eliminates
// the divergence where EpisodeOutcome had 'success-with-correction' but OutcomeType
// did not, which would have required a lossy cast at every episode→MemoryEntry
// promotion site.

export interface EntityRecord extends VersionedRecord {
	name: string
	entityType: 'person' | 'org' | 'project' | 'tool' | 'concept' | 'other'
	aliases: string[]
	description?: string
	tags: string[]
	createdAt: number
	updatedAt: number
}

export interface FactRecord extends VersionedRecord {
	statement: string
	entityIds: string[]
	confidence: number
	evidenceCount: number
	sourceIds: string[]
	contradictionIds: string[]
	createdAt: number
	updatedAt: number
}

export interface TurnRecord {
	id: string
	sessionId: string
	timestamp: number
	actor: 'user' | 'agent' | 'system'
	content: string
	metadata?: Record<string, unknown>
}

export interface EpisodeRecord extends VersionedRecord {
	sessionId: string
	timestamp: number
	actor: 'user' | 'agent' | 'system'
	summary: string
	rawTurnRefs: string[]
	entities: string[]
	taskType?: string
	environment?: string
	outcome: OutcomeType // Fix #2: was EpisodeOutcome (now removed); OutcomeType is the unified type
	failureMode?: string
	resolution?: string
	salience: number
	emotionalWeight?: number
	embeddingId?: string
	linkedProcedureIds: string[]
	linkedFactIds: string[]
	supersededByProcedureVersionId?: string
}

// Fix #7: Normalized all SCREAMING_SNAKE_CASE members to snake_case to match
// EdgeType's convention. The uppercase variants came from the extension's internal
// SmritiGraph constants where they were string values, not union members. Now that
// they live as a shared type literal, consistency matters: mixed casing forces every
// switch/match to handle both conventions. If IndexedDBGraphStore persisted any of
// these values in uppercase, a one-time read-side alias or migration is needed before
// deploying — check IndexedDBGraphStore.ts for hardcoded string comparisons.
export type GraphEdgeType =
	| EdgeType
	| 'wikilink'
	| 'shared_source'
	| 'entity_of'
	| 'about'
	| 'common_neighbor'
	| 'type_affinity'
	| 'evolved_from_episode'
	| 'contradicts'
	| 'supports'
	| 'similar_to'           // was SIMILAR_TO
	| 'supersedes'           // was SUPERSEDES
	| 'triggered_by'         // was TRIGGERED_BY
	| 'part_of'              // was PART_OF
	| 'used_by'              // was USED_BY
	| 'derived_from_episode' // was DERIVED_FROM_EPISODE (deduped with evolved_from_episode variant)
	| 'evolved_into'         // was EVOLVED_INTO
	| 'adamic_adar'
	| 'index_reference'
	| 'section_reference'
	| 'redirects'

export interface GraphNodeRecord extends VersionedRecord {
	kind: NodeKind
	title: string
	content?: string
	sourceIds: string[]
	tags: string[]
	createdAt: number
	updatedAt: number
	embeddingId?: string
	metadata?: Record<string, unknown>
}

export interface StoredGraphEdge extends VersionedRecord {
	from: string
	to: string
	type: GraphEdgeType
	weight: number
	evidence: string[]
	createdAt: number
	updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval Types - Phase 4
// ─────────────────────────────────────────────────────────────────────────────

// Alias for QueryIntent - more descriptive at call sites that deal with retrieval.
export type RetrievalIntent = QueryIntent

export interface ScoredCandidate {
	id: string
	kind: NodeKind
	score: number
	content?: string
	summary?: string
	metadata?: Record<string, unknown>
}

export interface RetrievalPlan {
	query: string
	intent: RetrievalIntent
	candidateSets: {
		semantic: ScoredCandidate[]
		episodic: ScoredCandidate[]
		procedural: ScoredCandidate[]
	}
	scoringWeights: {
		similarity: number
		recency: number
		salience: number
		reliability: number
		novelty: number
		supersession: number
	}
	fusionStrategy: 'weighted_linear' | 'rrf'
	diversityWindow: number
	maxResults: {
		semantic: number
		episodic: number
		procedural: number
	}
}

// Fix #8: IVectorSyncDataSources exported here rather than inline in VectorIndexSync.ts.
// VectorIndexSync is a package-level class; any store or orchestrator that needs to
// supply data to it must satisfy this contract. Defining it inline in the implementation
// file forces callers to import from the implementation, violating the types-as-contract
// pattern this file establishes. Placing it here alongside the records it references
// (FactRecord, EntityRecord, EpisodeRecord, ProcedureRecord) makes the contract
// discoverable and keeps VectorIndexSync.ts free of types it doesn't own.
export interface IVectorSyncDataSources {
	facts: { listAll(): Promise<FactRecord[]> }
	entities: { listAll(): Promise<EntityRecord[]> }
	episodes: { listAll(): Promise<EpisodeRecord[]> }
	procedures: { listAll(): Promise<ProcedureRecord[]> }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference Types - Phase 4
// ─────────────────────────────────────────────────────────────────────────────

// Historical note: this file was previously located at
// packages/cognitiveBrain/memory/src/types.ts before the monorepo rename.
// Fix #3 (post-migration cleanup): ModelTier was added in the Phase 4 extension
// port as a duplicate of InferenceTier. The temporary alias has been removed;
// InferenceRequest and InferenceResult now use InferenceTier directly.

export interface InferenceRequest {
	model: InferenceTier
	prompt: string
	schema?: Record<string, unknown>
	maxTokens?: number
	temperature?: number
}

export interface InferenceResult {
	text: string
	tokensUsed: number
	latencyMs: number
	model: InferenceTier
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiki Types - Phase 4 (ported from extension)
// ─────────────────────────────────────────────────────────────────────────────

export interface WikiKnowledgeBaseConfig {
	domainName: string
	purposeStatement: string
	vocabularyHints: string[]
	edgeWeightTuning: {
		wikilinkWeight: number
		sharedSourceWeight: number
		adamicAdarWeight: number
		temporalWeight: number
	}
	rawRetentionDays: number
	autoIngestVisitedTabs: boolean
	blockedUrlPatterns: string[]
}

export interface WikiPage {
	id: string
	slug: string
	title: string
	body: string
	wikilinks: string[]
	sourceRawIds: string[]
	createdAt: number
	updatedAt: number
	version: number
	embeddingId?: string
	smritiNodeId?: string
}

export interface WikiRawEntry {
	id: string
	sourceType: 'tab_capture' | 'paste' | 'upload' | 'api_feed'
	url?: string
	title?: string
	content: string
	capturedAt: number
	processedAt?: number
	processedIntoPageIds: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Optimization — ActionOpt integration (trajectory-driven action editing)
//
// Design: packages/extension/docs/SkillOptDesign.md
//
// The trainable surface of an ActionDefinition is its `instructionDoc` field â€”
// a natural-language hint injected into the agent system prompt when the skill
// is active. FORGE critiques failure trajectories; TRAIN proposes bounded text
// edits to the instructionDoc; an EditValidator gates acceptance when the new
// doc outscores the old one on a validation batch.
// ─────────────────────────────────────────────────────────────────────────────

/** A few-shot usage example attached to an action for both documentation and training. */
export interface ActionExample {
	/** Raw input the agent would supply (JSON-serialisable). */
	input: string
	/** Expected skill output for this input. */
	expectedOutput: string
	/** Optional annotation explaining why this example is representative. */
	notes?: string
}

/** Which field on an ActionDefinition a proposed edit targets. */
export type ActionEditTarget = 'instructionDoc' | 'triggers' | 'description'

/**
 * A single bounded edit proposed by the TRAIN archetype.
 * Modelled after SkillOpt's text-space edit operations but scoped
 * to the natural-language fields of an ActionDefinition (never `execute()`).
 */
export interface ActionDocEdit {
	type: 'replace' | 'append' | 'delete'
	/** Which ActionDefinition field the edit targets. */
	target: ActionEditTarget
	/** The text to replace or delete (empty string for append). */
	before: string
	/** The replacement or appended text (empty string for delete). */
	after: string
	/** TRAIN's justification referencing a specific trajectory or FORGE finding. */
	rationale: string
}

/**
 * Input to WorkflowExecutor.optimizeAction().
 * Carries failure trajectories and the action's current trainable state.
 */
export interface ActionOptimizationInput {
	actionId: string
	/** Current instructionDoc, or undefined if none exists yet. */
	currentInstructionDoc?: string
	trajectories: Array<{
		sessionId: string
		/** Heuristic 0–10 score assigned by TrajectoryCollector. */
		score: number
		actionId: string
		/** Human-readable summary of the session for FORGE context. */
		sessionSummary?: string
	}>
}

/** Result returned by WorkflowExecutor.optimizeAction(). */
export interface ActionOptimizationResult {
	actionId: string
	/** Proposed edits from TRAIN. Empty when TRAIN outputs NO_EDIT. */
	edits: ActionDocEdit[]
	/** Aggregate confidence score (0–10) from FORGE's critique pass. */
	forgeScore?: number
	/** Full raw output from the final agent for audit purposes. */
	rawOutput: string
}
