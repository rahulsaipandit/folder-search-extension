/**
 * Core types for LLM integration
 */
import type * as z from 'zod/v4'

/**
 * Message format - OpenAI standard (industry standard)
 */
export interface Message {
	role: 'system' | 'user' | 'assistant' | 'tool'
	content?: string | null
	tool_calls?: {
		id: string
		type: 'function'
		function: {
			name: string
			arguments: string // JSON string
		}
	}[]
	tool_call_id?: string
	name?: string
}

/**
 * Tool definition - uses Zod schema (LLM-agnostic)
 * Supports generics for type-safe parameters and return values
 */
export interface Tool<TParams = any, TResult = any> {
	// name: string
	description?: string
	inputSchema: z.ZodType<TParams>
	execute: (args: TParams) => Promise<TResult>
}

/**
 * Invoke options for LLM call
 */
export interface InvokeOptions {
	/**
	 * Force LLM to call a specific tool by name.
	 * If provided: tool_choice = { type: 'function', function: { name: toolChoiceName } }
	 * If not provided: tool_choice = 'required' (must call some tool, but model chooses which)
	 */
	toolChoiceName?: string
	/**
	 * Response normalization function.
	 * Called before parsing the response.
	 * Used to fix various response format errors from the model.
	 */
	normalizeResponse?: (response: any) => any
}

/**
 * LLM Client interface
 * Note: Does not use generics because each tool in the tools array has different types
 */
export interface LLMClient {
	invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult>

	/**
	 * Plain chat completion - no tools, no tool_choice.
	 * Use this for free-form text generation (e.g. resume customisation, cover letters)
	 * where structured tool output is not needed.
	 *
	 * Sending tools:[] with tool_choice:"required" is invalid per the OpenAI spec and
	 * causes HTTP 400 on LM Studio and most local servers - so a dedicated text path
	 * is required rather than passing an empty tools dict to invoke().
	 */
	invokeText(messages: Message[], abortSignal?: AbortSignal): Promise<string>

	/**
	 * Release any resources held by this client.
	 * Required for browser (WebLLM) clients that hold a loaded model engine in GPU memory.
	 * Safe to call on all providers - a no-op if the provider has nothing to release.
	 */
	dispose?(): void
}

/**
 * Invoke result (strict typing, supports generics)
 */
export interface InvokeResult<TResult = unknown> {
	toolCall: {
		// id?: string // OpenAI's tool_call_id
		name: string
		args: any
	}
	toolResult: TResult // Supports generics, but defaults to unknown
	usage: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
		cachedTokens?: number // Prompt cache hits
		reasoningTokens?: number // OpenAI o1 series reasoning tokens
	}
	rawResponse?: unknown // Raw response for debugging
	rawRequest?: unknown // Raw request for debugging
}

/**
 * LLM configuration - supports multiple providers (openai/anthropic/local/browser)
 */
export interface LLMConfig {
	// Provider type - dispatches which LLMClient implementation is constructed (see index.ts)
	provider?: 'openai' | 'anthropic' | 'local' | 'browser'

	// Common fields (populated based on provider)
	baseURL: string
	model: string
	apiKey?: string

	/**
	 * @deprecated No longer a standard parameter; many models reject it outright.
	 * Use `transformRequestBody` to set it only for models you've verified.
	 */
	temperature?: number

	maxRetries?: number

	/**
	 * Transform the final request body before sending it to the provider.
	 * Use this to implement provider-specific request tweaks such as caching hints or custom flags.
	 *
	 * Return a new object, or mutate the input object and return undefined.
	 */
	transformRequestBody?: (
		requestBody: Record<string, unknown>
	) => Record<string, unknown> | undefined

	/**
	 * remove the tool_choice field from the request.
	 * @note fix "Invalid tool_choice type: 'object'" for some LLMs.
	 */

	// Provider-specific fields
	openaiApiKey?: string
	openaiModel?: string
	anthropicApiKey?: string
	anthropicModel?: string
	localEndpointUrl?: string
	currentLocalModel?: string | null
	currentLocalModelContextWindow?: number
	// When true, sends tool_choice as string ("auto") instead of object form.
	// Required for LM Studio and some other local OpenAI-compatible servers that reject { type: "function", function: { name: "..." } }.
	disableNamedToolChoice?: boolean

	/**
	 * Custom fetch function for LLM API requests.
	 * Use this to customize headers, credentials, proxy, etc.
	 * The response should follow OpenAI API format.
	 */
	customFetch?: typeof globalThis.fetch

	/**
	 * provider: 'browser' only. Called while the WebLLM model is being downloaded/compiled
	 * (i.e. it was not already cached from a previous load). Not called at all when the
	 * model is already cached - a cache hit resolves immediately with no download step.
	 * Use this to show download progress in the UI; the browser LLM has no other way to
	 * signal that a long-running download - not a hang - is in progress.
	 */
	onBrowserModelProgress?: (progress: { text: string; progress: number }) => void
}

export type ResolvedLLMConfig = Required<Omit<LLMConfig, 'temperature'>> & { temperature?: number }
