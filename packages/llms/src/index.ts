import { BrowserLLMClient } from './BrowserLLMClient'
import { OpenAIClient } from './OpenAIClient'
import { LLM_MAX_RETRIES } from './constants'
import { InvokeError, InvokeErrorTypes } from './errors'
import type {
	InvokeOptions,
	InvokeResult,
	LLMClient,
	LLMConfig,
	Message,
	ResolvedLLMConfig,
	Tool,
} from './types'

export { InvokeError, InvokeErrorTypes }
export type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool }

/**
 * Default maximum context tokens to preserve after pruning.
 * Agent history beyond this limit will be summarized/trimmed.
 */
const MAX_CONTEXT_TOKENS = 12_000

/**
 * Target context tokens to prune down to.
 * We prune to slightly below max to avoid hitting the limit exactly.
 */
const TARGET_CONTEXT_TOKENS = 10_000

export function parseLLMConfig(config: LLMConfig): ResolvedLLMConfig {
	// Runtime validation as defensive programming (types already guarantee these)
	if (!config.baseURL || !config.model) {
		throw new Error(
			'[PageAgent] LLM configuration required. Please provide: baseURL, model. ' +
				'See: https://alibaba.github.io/page-agent/docs/features/models'
		)
	}

	if (config.temperature !== undefined) {
		console.warn(
			'[PageAgent] LLMConfig.temperature is deprecated and will be removed in a future version. ' +
				'Use transformRequestBody to set it only for models you have verified accept it.'
		)
	}

	const apiProvider = config.provider

	// Local/browser providers only support string tool_choice values - always force true.
	const isLocalProvider = apiProvider === 'local' || apiProvider === 'browser'

	const parsed: ResolvedLLMConfig = {
		...config,
		provider: apiProvider ?? 'openai', // default to openai when provider is unset
		baseURL: config.baseURL,
		model: config.model,
		apiKey: config.apiKey || '',
		// Provider-specific optional fields - default to empty string so ResolvedLLMConfig is satisfied
		openaiApiKey: config.openaiApiKey ?? '',
		openaiModel: config.openaiModel ?? '',
		anthropicApiKey: config.anthropicApiKey ?? '',
		anthropicModel: config.anthropicModel ?? '',
		localEndpointUrl: config.localEndpointUrl ?? '',
		currentLocalModel: config.currentLocalModel ?? null,
		currentLocalModelContextWindow: config.currentLocalModelContextWindow ?? 0,
		// Leave undefined unless the caller explicitly set it - OpenAIClient/
		// BrowserLLMClient/modelPatch only include `temperature` in the request
		// body when it's not undefined, since many newer models reject it
		// entirely. Defaulting it here (as a prior version of this file did)
		// silently defeated that "omit unless set" contract for every caller.
		temperature: config.temperature,
		maxRetries: config.maxRetries ?? LLM_MAX_RETRIES,
		transformRequestBody: config.transformRequestBody ?? ((requestBody) => requestBody),
		onBrowserModelProgress: config.onBrowserModelProgress ?? (() => {}),
		disableNamedToolChoice: isLocalProvider ? true : (config.disableNamedToolChoice ?? false),
		customFetch: (config.customFetch ?? fetch).bind(globalThis), // fetch will be illegal unless bound
	}

	return parsed
}

export class LLM extends EventTarget {
	config: ResolvedLLMConfig
	client: LLMClient

	constructor(config: LLMConfig) {
		super()
		this.config = parseLLMConfig(config)

		// "browser" runs inference in-page via WebLLM - it must never be handed to
		// OpenAIClient, which would try to fetch() the "browser://" placeholder baseURL.
		this.client =
			this.config.provider === 'browser'
				? new BrowserLLMClient(this.config)
				: new OpenAIClient(this.config as any)
	}

	/**
	 * Release any resources held by the underlying client.
	 *
	 * This is a no-op for remote providers (OpenAI, Anthropic, local HTTP endpoints).
	 * For the browser (WebLLM) provider it unloads the model engine from GPU/WASM memory -
	 * always call this when the scoped work is done to avoid memory leaks.
	 *
	 * Safe to call multiple times (idempotent via optional chaining on the client).
	 */
	dispose(): void {
		this.client.dispose?.()
	}

	/**
	 * Plain chat completion - no tools, no tool_choice.
	 *
	 * Use this for free-form text generation (resume customisation, cover letters, etc.)
	 * where structured tool output is not needed. Sending tools:[] with
	 * tool_choice:"required" is invalid and causes HTTP 400 on LM Studio and many
	 * local OpenAI-compatible servers - hence the dedicated text path.
	 *
	 * Returns the assistant's text content directly as a string.
	 * Applies context pruning. Retries are disabled (maxRetries=0) because the
	 * caller supplies an AbortSignal - once it fires it is permanently aborted,
	 * so retry attempts would fail instantly with AbortError rather than making
	 * a fresh request. The caller is responsible for presenting a "try again"
	 * option if needed.
	 */
	async invokeText(messages: Message[], abortSignal: AbortSignal): Promise<string> {
		const prunedMessages = pruneContext(messages)

		return await withRetry(
			async () => {
				if (abortSignal.aborted) throw new Error('AbortError')
				return this.client.invokeText!(prunedMessages, abortSignal)
			},
			{
				// No retries: a fired AbortSignal is permanently aborted, making
				// retries immediately fail. Increase the caller's timeout instead.
				maxRetries: 0,
				onRetry: () => {},
				onError: (error: Error) => {
					this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
				},
			}
		)
	}

	/**
	 * - call llm api *once*
	 * - invoke tool call *once*
	 * - return the result of the tool
	 *
	 * Context pruning is applied to messages before invocation to ensure
	 * the message history stays within the target token budget.
	 */
	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		// Apply context pruning before calling the LLM
		const prunedMessages = pruneContext(messages)

		return await withRetry(
			async () => {
				// in case user aborted before invoking
				if (abortSignal.aborted) throw new Error('AbortError')

				const result = await this.client.invoke(prunedMessages, tools, abortSignal, options)

				return result
			},
			// retry settings
			{
				maxRetries: this.config.maxRetries,
				onRetry: (attempt: number, lastError: Error) => {
					this.dispatchEvent(
						new CustomEvent('retry', {
							detail: { attempt, maxAttempts: this.config.maxRetries, lastError },
						})
					)
				},
				onError: (error: Error) => {
					this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
				},
			}
		)
	}
}

/**
 * Prune conversation context to stay within the token budget.
 *
 * Strategy: Estimate token count from message content, and if we exceed
 * the budget, drop older messages while preserving the system prompt,
 * the user's original request, and the most recent assistant/user messages.
 *
 * Pruning operates on atomic "message groups" - an assistant message with
 * tool_calls and its corresponding tool-role responses are always kept or
 * dropped together to avoid broken tool_call/tool_result pairs that cause
 * API errors.
 *
 * This prevents context overflow in long-running agents without losing
 * the critical context needed for coherent task execution.
 */
export function pruneContext(messages: Message[]): Message[] {
	if (messages.length <= 2) return messages

	// ~3.5 characters per token (conservative estimate for most models)
	const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5)

	const msgTokens = (msg: Message) => estimateTokens(msg.content || '') + 4 // +4 for role/metadata overhead

	let totalTokens = 0
	for (const msg of messages) {
		totalTokens += msgTokens(msg)
	}

	// If under budget, no pruning needed
	if (totalTokens <= MAX_CONTEXT_TOKENS) return messages

	// Assume messages[0] is the system prompt and messages[1] is the user request -
	// the PageAgentCore always constructs messages this way. Guard against unexpected shapes.
	const [systemMsg, userMsg, ...historyMessages] = messages
	if (!systemMsg || !userMsg) return messages

	// Group history into atomic units: an assistant message with tool_calls and all
	// its following tool-role responses must be pruned together to avoid broken pairs.
	const historyGroups = groupMessagesByToolCallPairs(historyMessages)

	// Always keep the 2 most-recent groups as "recent context"
	const recentGroups = historyGroups.slice(-2)
	const recentMessages = recentGroups.flat()
	const middleGroups = historyGroups.slice(0, -2)

	// Calculate baseline token cost (system + user + recent)
	const baselineTokens =
		msgTokens(systemMsg) +
		msgTokens(userMsg) +
		recentMessages.reduce((acc, msg) => acc + msgTokens(msg), 0) +
		4 // structural overhead

	// If even the baseline exceeds budget, keep only system + user + last message group
	if (baselineTokens > MAX_CONTEXT_TOKENS) {
		const lastGroup = historyGroups.at(-1) ?? []
		const minimalMessages = [systemMsg, userMsg, ...lastGroup]
		console.warn(
			`[LLM] Context aggressively pruned: ${messages.length} → ${minimalMessages.length} messages`
		)
		return minimalMessages
	}

	// Accumulate middle groups from most-recent to oldest until the budget is exhausted
	const budgetForMiddle = TARGET_CONTEXT_TOKENS - baselineTokens
	let middleTokens = 0
	const keptMiddleGroups: Message[][] = []

	for (const group of [...middleGroups].reverse()) {
		const groupTokens = group.reduce((acc, msg) => acc + msgTokens(msg), 0)
		if (middleTokens + groupTokens <= budgetForMiddle) {
			keptMiddleGroups.unshift(group)
			middleTokens += groupTokens
		}
	}

	const keptMiddle = keptMiddleGroups.flat()
	const result = [systemMsg, userMsg, ...keptMiddle, ...recentMessages]

	if (result.length < messages.length) {
		console.warn(
			`[LLM] Context pruned: ${messages.length} → ${result.length} messages ` +
				`(estimated ${totalTokens} → estimated ${baselineTokens + middleTokens} tokens)`
		)
	}

	return result
}

/**
 * Group a flat message list into atomic units for pruning.
 * An assistant message with tool_calls and all following tool-role messages
 * form one group that must stay together (the API rejects broken pairs).
 * All other messages form single-element groups.
 */
function groupMessagesByToolCallPairs(messages: Message[]): Message[][] {
	const groups: Message[][] = []
	let i = 0
	while (i < messages.length) {
		const msg = messages[i]
		if (msg.role === 'assistant' && msg.tool_calls?.length) {
			const group: Message[] = [msg]
			i++
			while (i < messages.length && messages[i].role === 'tool') {
				group.push(messages[i])
				i++
			}
			groups.push(group)
		} else {
			groups.push([msg])
			i++
		}
	}
	return groups
}

async function withRetry<T>(
	fn: () => Promise<T>,
	settings: {
		maxRetries: number
		onRetry: (attempt: number, lastError: Error) => void
		onError: (error: Error) => void
	}
): Promise<T> {
	let attempt = 0
	let lastError: Error | null = null
	while (attempt <= settings.maxRetries) {
		if (attempt > 0) {
			settings.onRetry(attempt, lastError!)
			// Exponential backoff: 200ms, 400ms, 800ms, ...
			await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt - 1)))
		}

		try {
			return await fn()
		} catch (error: unknown) {
			// Do not retry if aborted by user. AbortError propagates unwrapped from the
			// client (see OpenAIClient.ts / BrowserLLMClient.ts) - it is never wrapped in
			// InvokeError, so check the error itself, not a `rawError` property.
			if ((error as any)?.name === 'AbortError') throw error

			console.error(error)
			settings.onError(error as Error)

			// do not retry if error is not retryable (InvokeError)
			if (error instanceof InvokeError && !error.retryable) throw error

			lastError = error as Error
			attempt++
		}
	}

	throw lastError!
}
