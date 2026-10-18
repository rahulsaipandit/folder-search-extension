import type { IMemoryService } from '../interfaces/IMemoryService'
import type { IActionRegistry } from '../interfaces/IActionRegistry'
import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type { IWorkflowPersistence } from '../interfaces/IWorkflowPersistence'
import type { ContextPack, MemorySearchPage, MemoryEntry } from '../types'

/**
 * Nemilia-pattern agent types.
 * Directly from the design document (Section 5.1.1).
 */

// ── Agent identifiers ────────────────────────────────────────────────────────

export type AgentId =
	| 'SCOUT'
	| 'LENS'
	| 'QUILL'
	| 'FORGE'
	| 'WEAVE'
	| 'NEXUS'
	| 'VISION'
	| 'TOOLS'
	/** Skill document editor — proposes SkillDocEdit[] from FORGE critiques. */
	| 'TRAIN'

// ── Agent definition ─────────────────────────────────────────────────────────

export interface AgentDefinition {
	id: AgentId
	name: string
	role: string
	temperature: number
	systemPrompt: string
}

// ── Workflow definition ───────────────────────────────────────────────────────

export interface WorkflowDefinition {
	id: string
	name: string
	agentIds: AgentId[]
	prompt: string // Template with {{variables}}
	dag: boolean // Enable parallel execution
	dagStages: Partial<Record<AgentId, number>> // Stage grouping for parallelism
	feedbackLoops: Partial<Record<string, boolean>> // 'agA:agB' bidirectional revision
	conditions: Partial<
		Record<
			AgentId,
			{
				sourceAgent: AgentId
				threshold: number
			}
		>
	>
	hitlOverrides: Partial<Record<AgentId, boolean>> // Human-in-the-loop gates
	validate: boolean // Auto-score outputs (0-10), retry if below valThreshold
	memory: boolean // Persist MEMORY[key]: value across agents
	orchestrator: {
		planTemp: number
		synthTemp: number
		valThreshold: number // Minimum score before retry
	}
}

// ── Execution context ─────────────────────────────────────────────────────────

export interface AgentMemoryContext {
	workingMemory: MemoryEntry[]
	vaultContext: ContextPack
	localRecall: MemorySearchPage
	memoryStore: Pick<IMemoryService, 'create' | 'addRelation' | 'checkProspectiveMemory'>
	vaultProvider: Pick<IVaultProvider, 'readPage' | 'searchPages' | 'queryWiki'>
	/** Optional skill registry - injected by WorkflowExecutor when available (v2.1) */
	actions?: IActionRegistry
	/** Optional workflow persistence - injected by WorkflowExecutor when available (v2.1) */
	persistence?: IWorkflowPersistence
}

export interface AgentExecutionContext {
	task: string
	priorSummary: string
	memCtx: AgentMemoryContext
	searchCtx: string
	agentMemory: Record<string, string> // MEMORY[key]: value extracted across agents
}

export interface AgentOutput {
	agentId: AgentId
	content: string
	score?: number // 0-10 validation score
	memoryTokens: Record<string, string> // MEMORY[key] extractions
	toolCalls: ParsedToolCall[]
	error?: string
}

// ── Tool call parsing ─────────────────────────────────────────────────────────

export interface ParsedToolCall {
	tool: string
	server: string
	args: Record<string, unknown>
}

// ── LLM config for agents ─────────────────────────────────────────────────────

export interface AgentLLMConfig {
	baseURL: string
	model: string
	apiKey?: string
}
