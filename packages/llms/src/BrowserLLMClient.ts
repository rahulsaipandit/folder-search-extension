/**
 * Browser (WebLLM) client implementation.
 *
 * Runs inference entirely in-page via `@mlc-ai/web-llm` (WebGPU/WASM) - no network
 * request is ever made. `@mlc-ai/web-llm` is an optional dependency: it is only
 * imported when a caller actually selects `provider: 'browser'`, so consumers that
 * never use the browser provider don't need it installed.
 */
import { InvokeError, InvokeErrorTypes } from './errors'
import type {
	InvokeOptions,
	InvokeResult,
	LLMClient,
	Message,
	ResolvedLLMConfig,
	Tool,
} from './types'
import { zodToOpenAITool } from './utils'

/**
 * Loading a WebLLM model means downloading and compiling a multi-hundred-MB WASM/GPU
 * payload, so engines are cached and refcounted by model id across all BrowserLLMClient
 * instances - scoped LLM instances (see useScopedLLM) are created/disposed frequently
 * (e.g. on every settings change) and must not pay that cost more than once per model.
 */
interface EngineCacheEntry {
	enginePromise: Promise<any>
	refCount: number
}
const engineCache = new Map<string, EngineCacheEntry>()

export class BrowserLLMClient implements LLMClient {
	config: ResolvedLLMConfig
	private modelId: string
	private acquired = false
	private disposed = false

	constructor(config: ResolvedLLMConfig) {
		this.config = config
		this.modelId = config.currentLocalModel || config.model

		if (!this.modelId) {
			throw new InvokeError(
				InvokeErrorTypes.CONFIG_ERROR,
				'No browser model selected. Choose a model in Settings before using the browser LLM provider.'
			)
		}
	}

	private async loadEngine(): Promise<any> {
		console.log(
			'[BrowserLLMClient] loadEngine() - no cached engine in this page context, importing web-llm',
			this.modelId
		)
		// No /* @vite-ignore */ here: that comment tells bundlers to leave the specifier
		// unresolved, which fails at runtime for a bare package name in a browser. Let
		// Vite statically analyze and bundle this import instead (see rollupOptions.external
		// in vite.config.js, which keeps it external for the standalone library build).
		const webllm = await import('@mlc-ai/web-llm').catch((error) => {
			throw new InvokeError(
				InvokeErrorTypes.CONFIG_ERROR,
				'"@mlc-ai/web-llm" is not installed in this build. It is required to use the "browser" LLM provider.',
				error
			)
		})

		console.log('[BrowserLLMClient] web-llm imported, calling CreateMLCEngine', this.modelId)
		const engine = await webllm.CreateMLCEngine(
			this.modelId,
			{
				// Only fires on an actual cache miss (download/compile) - a cached model
				// resolves without ever calling this. See LLMConfig.onBrowserModelProgress.
				initProgressCallback: (p: { text?: string; progress?: number }) => {
					console.log('[BrowserLLMClient] engine load progress', p)
					this.config.onBrowserModelProgress({ text: p.text ?? '', progress: p.progress ?? 0 })
				},
			},
			this.config.currentLocalModelContextWindow
				? { context_window_size: this.config.currentLocalModelContextWindow }
				: undefined
		)
		console.log('[BrowserLLMClient] CreateMLCEngine resolved - engine ready', this.modelId)
		return engine
	}

	private getEngine(): Promise<any> {
		let entry = engineCache.get(this.modelId)
		if (!entry) {
			console.log('[BrowserLLMClient] getEngine() - cache miss for', this.modelId)
			entry = { enginePromise: this.loadEngine(), refCount: 0 }
			engineCache.set(this.modelId, entry)
			// Don't leave a rejected engine cached - the next attempt should retry from scratch.
			entry.enginePromise.catch(() => engineCache.delete(this.modelId))
		} else {
			console.log('[BrowserLLMClient] getEngine() - reusing cached engine for', this.modelId)
		}

		// Only count this client instance toward the model's refcount once, no matter
		// how many times invoke()/invokeText() call getEngine().
		if (!this.acquired) {
			this.acquired = true
			entry.refCount++
		}

		return entry.enginePromise
	}

	async invokeText(messages: Message[], abortSignal?: AbortSignal): Promise<string> {
		// A real DOMException so `.name === 'AbortError'` matches withRetry's abort
		// check (index.ts) the same way OpenAIClient's AbortError does - a plain
		// `new Error('AbortError')` has `.name === 'Error'` and was silently retried.
		if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')

		console.log('[BrowserLLMClient] invokeText() - awaiting engine…', {
			modelId: this.modelId,
			messageCount: messages.length,
		})
		const engine = await this.getEngine()
		console.log('[BrowserLLMClient] invokeText() - engine ready, calling chat.completions.create()')

		let reply: any
		try {
			reply = await engine.chat.completions.create({
				messages,
				temperature: this.config.temperature,
			})
			console.log('[BrowserLLMClient] invokeText() - chat.completions.create() resolved', {
				usage: reply?.usage,
				contentLength: reply?.choices?.[0]?.message?.content?.length,
			})
		} catch (error) {
			console.log('[BrowserLLMClient] invokeText() - chat.completions.create() threw', error)
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				`Browser LLM inference failed: ${(error as Error).message}`,
				error
			)
		}

		const content = reply.choices?.[0]?.message?.content
		if (content == null) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				'No content in browser LLM response',
				undefined,
				reply
			)
		}

		return content
	}

	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')

		const openaiTools = Object.entries(tools).map(([name, t]) => zodToOpenAITool(name, t))
		if (openaiTools.length === 0) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				'invoke() called with no tools - use invokeText() for plain chat completions'
			)
		}

		let toolChoice: unknown = 'required'
		if (options?.toolChoiceName && !this.config.disableNamedToolChoice) {
			toolChoice = { type: 'function', function: { name: options.toolChoiceName } }
		}

		const engine = await this.getEngine()

		let reply: any
		try {
			reply = await engine.chat.completions.create({
				messages,
				temperature: this.config.temperature,
				tools: openaiTools,
				tool_choice: toolChoice,
			})
		} catch (error) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				`Browser LLM inference failed: ${(error as Error).message}`,
				error
			)
		}

		const normalizedReply = options?.normalizeResponse ? options.normalizeResponse(reply) : reply
		const choice = normalizedReply.choices?.[0]

		const toolCallName = choice?.message?.tool_calls?.[0]?.function?.name
		if (!toolCallName) {
			throw new InvokeError(
				InvokeErrorTypes.NO_TOOL_CALL,
				'No tool call found in response',
				undefined,
				reply
			)
		}

		const tool = tools[toolCallName]
		if (!tool) {
			throw new InvokeError(
				InvokeErrorTypes.UNKNOWN,
				`Tool "${toolCallName}" not found in tools`,
				undefined,
				reply
			)
		}

		const argString = choice.message?.tool_calls?.[0]?.function?.arguments
		if (!argString) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'No tool call arguments found',
				undefined,
				reply
			)
		}

		let parsedArgs: unknown
		try {
			parsedArgs = JSON.parse(argString)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'Failed to parse tool arguments as JSON',
				error,
				reply
			)
		}

		const validation = tool.inputSchema.safeParse(parsedArgs)
		if (!validation.success) {
			throw new InvokeError(
				InvokeErrorTypes.INVALID_TOOL_ARGS,
				'Tool arguments validation failed',
				validation.error,
				reply
			)
		}
		const toolInput = validation.data

		let toolResult: unknown
		try {
			toolResult = await tool.execute(toolInput)
		} catch (e) {
			// Propagate AbortError unwrapped, matching OpenAIClient.ts - otherwise a
			// tool that legitimately aborted (e.g. it observed the same abortSignal)
			// gets wrapped as a retryable TOOL_EXECUTION_ERROR and withRetry retries
			// a call the caller already cancelled.
			if ((e as any)?.name === 'AbortError') throw e
			throw new InvokeError(
				InvokeErrorTypes.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(e as Error).message}`,
				e,
				reply
			)
		}

		return {
			toolCall: { name: toolCallName, args: toolInput },
			toolResult,
			usage: {
				promptTokens: reply.usage?.prompt_tokens ?? 0,
				completionTokens: reply.usage?.completion_tokens ?? 0,
				totalTokens: reply.usage?.total_tokens ?? 0,
			},
			rawResponse: reply,
		}
	}

	/**
	 * Unloads the model engine from GPU/WASM memory once the last BrowserLLMClient
	 * referencing this model id disposes - see the refcounting note on `engineCache`.
	 */
	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		if (!this.acquired) return

		const entry = engineCache.get(this.modelId)
		if (!entry) return

		entry.refCount--
		if (entry.refCount <= 0) {
			engineCache.delete(this.modelId)
			entry.enginePromise.then((engine) => engine.unload?.()).catch(() => {})
		}
	}
}
