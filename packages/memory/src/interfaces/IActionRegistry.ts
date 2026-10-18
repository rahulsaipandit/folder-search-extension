import type { ActionMeta } from '../types'

/**
 * ActionContext - passed to every skill execution.
 */
export interface ActionContext {
	brainEngine?: import('./IBrainEngine').IBrainEngine
	goalManager?: import('../core/goals/GoalManager').GoalManager
	sessionId?: string
	tabId?: number
	abortSignal?: AbortSignal
	metadata?: Record<string, unknown>
}

/**
 * ActionDefinition - typed, versioned, deterministic-first skill contract.
 * Design lineage: agents-sample/skills + Open Agents SKILL.md discovery.
 *
 * Section 6.9 of designCognitiveBrain.md
 */
export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
	id: string               // e.g. 'org.page-agent.math.calculate'
	name: string
	description: string
	version: string          // semver: '1.0.0'
	category: string         // 'compute' | 'time' | 'page' | 'media' | 'text' | 'browser' | 'vault' | 'search'
	capabilities: string[]   // required capabilities
	inputSchema: {
		parse(input: unknown): TInput
		safeParse(input: unknown): { success: true; data: TInput } | { success: false; error: unknown }
	}
	outputSchema: {
		parse(output: unknown): TOutput
		safeParse(output: unknown): { success: true; data: TOutput } | { success: false; error: unknown }
	}
	execute(input: TInput, ctx: ActionContext): Promise<TOutput>
	fallbackToLLM: boolean   // true = IBrainEngine.think() invoked if execute() fails
	timeoutMs: number        // 5000 deterministic, 30000 LLM-assisted
	userInvocable?: boolean  // Can be called by user directly
}

/**
 * IActionRegistry - typed, versioned skill execution registry.
 * Section 6.9 of designCognitiveBrain.md
 */
export interface IActionRegistry {
	/** Register an action definition. Throws on ID+version conflict. */
	register(skill: ActionDefinition): void

	/** Get action by ID. Optionally filter by semver version constraint. */
	get(id: string, version?: string): ActionDefinition | undefined

	/** List all registered action metadata. */
	list(): ActionMeta[]

	/** List actions grouped by category. */
	listByCategory(): Record<string, ActionMeta[]>

	/** Invoke an action with validated args. Handles timeout + fallbackToLLM. */
	invoke(id: string, args: unknown, ctx: ActionContext): Promise<unknown>

	/** Scan a directory for action files and register them. Returns count loaded. */
	loadFromDirectory(dir: string): Promise<number>

	/** Generate always-present action summary for agent system prompts. */
	buildActionSummary(): string
}
