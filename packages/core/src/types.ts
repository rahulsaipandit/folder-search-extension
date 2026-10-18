import type { LLMConfig } from '@page-agent/llms'

// @note circular dependency but okay
import type { PageAgentCore } from './PageAgentCore'
import type { PageAgentTool } from './tools'

/** Supported UI languages */
export type SupportedLanguage = 'en-US' | 'zh-CN'

export interface AgentConfig extends LLMConfig {
	language?: SupportedLanguage

	/**
	 * Maximum number of steps the agent can take per task.
	 * @default 40
	 */
	maxSteps?: number

	/**
	 * Maximum total cost in USD before automatic halt.
	 * @default undefined (no limit)
	 */
	maxCost?: number

	/**
	 * Custom tools to extend PageAgent capabilities
	 * @experimental
	 * @note You can also override or remove internal tools by using the same name.
	 * @see PageAgentTool
	 *
	 * @example
	 * // override internal tool
	 * import { z } from 'zod/v4'
	 * import { tool } from 'page-agent'
	 * const customTools = {
	 * ask_user: tool({
	 * 	description:
	 * 		'Ask the user or parent model a question and wait for their answer. Use this if you need more information or clarification.',
	 * 	inputSchema: z.object({
	 * 		question: z.string(),
	 * 	}),
	 * 	execute: async function (this: PageAgent, input) {
	 * 		const answer = await do_some_thing(input.question)
	 * 		return "✅ Received user answer: " + answer
	 * 	},
	 * })
	 * }
	 *
	 * @example
	 * // remove internal tool
	 * const customTools = {
	 * 	ask_user: null // never ask user questions
	 * }
	 */
	customTools?: Record<string, PageAgentTool | null>

	/**
	 * Instructions to guide the agent's behavior
	 */
	instructions?: {
		/**
		 * Global system-level instructions, applied to all tasks
		 */
		system?: string

		/**
		 * Dynamic page-level instructions callback
		 * Called before each step to get instructions for the current page
		 * @param url - Current page URL (window.location.href)
		 * @returns Instructions string, or undefined/null to skip
		 */
		getPageInstructions?: (url: string) => string | undefined | null
	}

	/**
	 * Lifecycle hooks for task execution.
	 * @experimental API may change in future versions.
	 *
	 * All hooks receive the agent instance as first parameter.
	 */

	/**
	 * Called before each step execution.
	 * @experimental
	 * @param agent - The PageAgentCore instance
	 * @param stepCount - Current step number (0-indexed)
	 */
	onBeforeStep?: (agent: PageAgentCore, stepCount: number) => Promise<void> | void

	/**
	 * Called after each step execution.
	 * @experimental
	 * @param agent - The PageAgentCore instance
	 * @param history - Current history of events
	 */
	onAfterStep?: (agent: PageAgentCore, history: HistoricalEvent[]) => Promise<void> | void

	/**
	 * Called before task execution starts.
	 * @experimental
	 * @param agent - The PageAgentCore instance
	 */
	onBeforeTask?: (agent: PageAgentCore) => Promise<void> | void

	/**
	 * Called after task execution completes (success or failure).
	 * @experimental
	 * @param agent - The PageAgentCore instance
	 * @param result - The execution result
	 */
	onAfterTask?: (agent: PageAgentCore, result: ExecutionResult) => Promise<void> | void

	/**
	 * Called when the agent is disposed.
	 * @experimental
	 * @note This hook can block the disposal process if it's async.
	 * @param agent - The PageAgentCore instance
	 * @param reason - Optional reason for disposal
	 */
	onDispose?: (agent: PageAgentCore, reason?: string) => void

	// page behavior hooks

	/**
	 * @experimental
	 * Enable the experimental script execution tool that allows executing generated JavaScript code on the page.
	 * @note Can cause unpredictable side effects.
	 * @note May bypass some safe guards and data-masking mechanisms.
	 */
	experimentalScriptExecutionTool?: boolean

	/**
	 * Enable the form-autofill tools (detect_form_fields, fill_form_field, submit_form).
	 * These are bounded, indexed DOM operations (same primitives as click_element_by_index /
	 * input_text) - not arbitrary code execution - so they are gated separately from
	 * experimentalScriptExecutionTool rather than requiring it.
	 * @default true
	 */
	enableFormTools?: boolean

	/**
	 * @experimental
	 * Fetch /llms.txt from current site origin and include as context.
	 * Only fetched once per origin per task.
	 * @default false
	 */
	experimentalLlmsTxt?: boolean

	/**
	 * Transform page content before sending to LLM.
	 * Called after DOM extraction and simplification, before LLM invocation.
	 * Use cases: inspect extraction results, modify page info, mask sensitive data.
	 *
	 * @param content - Simplified page content that will be sent to LLM
	 * @returns Transformed content
	 *
	 * @example
	 * // Mask phone numbers
	 * transformPageContent: async (content) => {
	 *   return content.replace(/1[3-9]\d{9}/g, '***********')
	 * }
	 */
	transformPageContent?: (content: string) => Promise<string> | string

	/**
	 * Completely override the default system prompt.
	 * @experimental Use with caution - incorrect prompts may break agent behavior.
	 */
	customSystemPrompt?: string

	/**
	 * Delay between steps in seconds.
	 * @default 0.4
	 */
	stepDelay?: number
}

/**
 * Agent reflection state - the reflection-before-action model
 *
 * Every tool call must first reflect on:
 * - evaluation_previous_goal: How well did the previous action achieve its goal?
 * - memory: Key information to remember for future steps
 * - next_goal: What should be accomplished in the next action?
 */
export interface AgentReflection {
	evaluation_previous_goal: string
	memory: string
	next_goal: string
}

/**
 * MacroTool input structure
 *
 * This is the core abstraction that enforces the "reflection-before-action" mental model.
 * Before executing any action, the LLM must output its reasoning state.
 */
export interface MacroToolInput extends Partial<AgentReflection> {
	action: Record<string, any>
}

/**
 * MacroTool output structure
 */
export interface MacroToolResult {
	input: MacroToolInput
	output: string
}

/**
 * Classification of errors for retry / halt decision making.
 * - transient: Temporary issues like rate limits, timeouts. Safe to retry.
 * - external: Issues with external APIs or services. May retry with backoff.
 * - poison: Non-recoverable errors (bad input, logic errors). Must halt immediately.
 */
export type ErrorClassification = 'transient' | 'external' | 'poison'

/**
 * Cost tracking for budget management
 */
export interface CostTracking {
	promptTokens: number
	completionTokens: number
	totalTokens: number
	/** Estimated cost in USD based on model pricing and token usage */
	estimatedCostUsd: number
}

/**
 * Circuit breaker state for cost/spend protection
 */
export interface CircuitBreakerState {
	/** Whether the circuit breaker has been triggered */
	triggered: boolean
	/** Reason for triggering, if applicable */
	reason?: string
	/** Timestamp when it was triggered */
	triggeredAt?: number
}

/**
 * A single agent step with reflection and action
 */
export interface AgentStepEvent {
	type: 'step'
	stepIndex: number
	reflection: Partial<AgentReflection>
	action: {
		name: string
		input: any
		output: string
	}
	usage: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
		cachedTokens?: number
		reasoningTokens?: number
	}
	/** Raw LLM response for debugging */
	rawResponse?: unknown
	/** Raw LLM request for debugging */
	rawRequest?: unknown
}

/**
 * Persistent observation event (stays in memory)
 */
export interface ObservationEvent {
	type: 'observation'
	content: string
}

/**
 * User takeover event
 */
export interface UserTakeoverEvent {
	type: 'user_takeover'
}

/**
 * Retry event - LLM call is being retried
 */
export interface RetryEvent {
	type: 'retry'
	message: string
	attempt: number
	maxAttempts: number
	/** Classification of the error that triggered the retry */
	errorClassification?: ErrorClassification
}

/**
 * Error event - fatal error from LLM or execution
 */
export interface AgentErrorEvent {
	type: 'error'
	message: string
	rawResponse?: unknown
	/** Classification of the error for retry/halt decisions */
	classification?: ErrorClassification
}

/**
 * Circuit breaker event - triggered when cost/step limits are exceeded
 */
export interface CircuitBreakerEvent {
	type: 'circuit_breaker'
	reason: string
	/** Current cost at time of trigger */
	cost: number
	/** Allowed budget limit */
	limit: number
}

/**
 * Union type for all history events
 */
export type HistoricalEvent =
	| AgentStepEvent
	| ObservationEvent
	| UserTakeoverEvent
	| RetryEvent
	| AgentErrorEvent
	| CircuitBreakerEvent

/**
 * Agent lifecycle status.
 * Note: 'blocked' is set by the extension layer (site access policy denial), not by
 * PageAgentCore itself - the core only ever transitions between the other 4 states.
 */
export type AgentStatus = 'idle' | 'running' | 'completed' | 'error' | 'stopped' | 'blocked'

/**
 * Agent activity - transient state for immediate UI feedback.
 *
 * Unlike historical events (which are persisted), activities are ephemeral
 * and represent "what the agent is doing right now". UI components should
 * listen to 'activity' events to show real-time feedback.
 *
 * Note: There is no 'idle' activity - absence of activity events means idle.
 */
export type AgentActivity =
	| { type: 'thinking' }
	| { type: 'executing'; tool: string; input: unknown }
	| { type: 'executed'; tool: string; input: unknown; output: string; duration: number }
	| { type: 'retrying'; attempt: number; maxAttempts: number }
	| { type: 'error'; message: string }

export interface ExecutionResult {
	success: boolean
	data: string
	history: HistoricalEvent[]
	/** Cost tracking information, if available */
	cost?: CostTracking
}

/**
 * Classify an error to determine retry behavior.
 * @returns ErrorClassification for the given error
 */
export function classifyError(error: unknown): ErrorClassification {
	const message = String(error).toLowerCase()

	// Transient errors - safe to retry with backoff
	if (
		message.includes('rate limit') ||
		message.includes('rate_limit') ||
		message.includes('too many requests') ||
		message.includes('timeout') ||
		message.includes('timed out') ||
		message.includes('temporarily unavailable') ||
		hasStatusCode(message, '429') ||
		hasStatusCode(message, '503') ||
		message.includes('network error') ||
		message.includes('econnrefused') ||
		message.includes('econnreset') ||
		message.includes('etimedout')
	) {
		return 'transient'
	}

	// 500/502 are provider-overload responses - safe to retry with backoff (same as 429/503).
	if (
		message.includes('server error') ||
		message.includes('internal server error') ||
		message.includes('bad gateway') ||
		message.includes('upstream') ||
		hasStatusCode(message, '500') ||
		hasStatusCode(message, '502')
	) {
		return 'transient'
	}

	// 403 = expired/invalid API key - retrying will never succeed.
	if (message.includes('forbidden') || hasStatusCode(message, '403')) {
		return 'poison'
	}

	// Remaining external service errors (non-retryable provider errors).
	if (message.includes('api error')) {
		return 'external'
	}

	// ZodError: schema violation - bad LLM output or tampered input; halt immediately.
	// Checked by name to be compatible with both zod v3 and v4.
	if (error !== null && typeof error === 'object' && (error as any).name === 'ZodError') {
		return 'poison'
	}

	// Poison errors - non-recoverable, halt immediately
	return 'poison'
}

/**
 * Match a bare HTTP status code that is not embedded in a URL path or a larger number.
 * Prevents false positives like "/403/resource" or "error1500".
 */
function hasStatusCode(message: string, code: string): boolean {
	return new RegExp(`(?<![/\\d])${code}(?!\\d)`).test(message)
}

/**
 * Calculate estimated cost in USD based on token usage and model.
 * Pricing tiers sourced from public model pricing pages (approximate).
 */
export function estimateCost(
	usage: { promptTokens: number; completionTokens: number },
	model?: string
): number {
	const m = (model || '').toLowerCase()
	const cost = (inputPer1M: number, outputPer1M: number) =>
		(usage.promptTokens / 1_000_000) * inputPer1M +
		(usage.completionTokens / 1_000_000) * outputPer1M

	// Claude Opus tier - claude-3-opus, claude-opus-4, etc. (~$15/$75 per million)
	if (m.includes('claude-3-opus') || m.includes('claude-opus')) {
		return cost(15, 75)
	}

	// Claude Sonnet tier - claude-3-sonnet, claude-3.5-sonnet, claude-sonnet-4, etc. (~$3/$15 per million)
	if (
		m.includes('claude-3.5-sonnet') ||
		m.includes('claude-3-sonnet') ||
		m.includes('claude-sonnet')
	) {
		return cost(3, 15)
	}

	// Claude Haiku tier - claude-3-haiku, claude-3.5-haiku, claude-haiku-4, etc. (~$0.25/$1.25 per million)
	if (
		m.includes('claude-3.5-haiku') ||
		m.includes('claude-3-haiku') ||
		m.includes('claude-haiku')
	) {
		return cost(0.25, 1.25)
	}

	// GPT-4o-mini class (~$0.15/$0.60 per million) - must check before gpt-4o
	if (m.includes('gpt-4o-mini')) {
		return cost(0.15, 0.6)
	}

	// GPT-4o class (~$2.5/$10 per million)
	if (m.includes('gpt-4o')) {
		return cost(2.5, 10)
	}

	// GPT-4 class (~$10/$30 per million)
	if (m.includes('gpt-4')) {
		return cost(10, 30)
	}

	// GPT-3.5 class (~$0.5/$1.5 per million)
	if (m.includes('gpt-3.5') || m.includes('gpt-35')) {
		return cost(0.5, 1.5)
	}

	// Default fallback - conservative Claude Haiku pricing
	return cost(0.25, 1.25)
}
