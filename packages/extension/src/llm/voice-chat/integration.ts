import { loadSettings } from '@/shared/settings'
import { createLLMConfigFromProvider } from '@/llm/providers/adapter'

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

export type VoiceStatus =
	| 'ready'
	| 'initializing'
	| 'listening'
	| 'processing'
	| 'thinking'
	| 'downloading'
	| 'speaking'
	| 'error'

export interface StatusUpdate {
	status: VoiceStatus
	message: string
	isListening?: boolean
}

export interface ChatMessage {
	role: 'user' | 'assistant'
	content: string
	thinking?: string
}

export interface IntegrationOptions {
	wakeWords?: string[]
	silenceTimeoutMs?: number
	language?: string
	onStatusChange?: (status: StatusUpdate) => void
	onError?: (error: Error) => void
	onMessage?: (message: ChatMessage) => void
}

export class LLMProviderNotConfiguredError extends Error {
	constructor() {
		super('Voice chat requires a real LLM. Please configure OpenAI, Anthropic, or a Browser LLM in Settings.')
		this.name = 'LLMProviderNotConfiguredError'
	}
}

function parseThinkTags(raw: string): { thinking: string; answer: string } {
	let thinking = ''
	const answer = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
		thinking += (thinking ? '\n\n' : '') + (inner as string).trim()
		return ''
	}).trim()
	return { thinking, answer }
}

export class VoiceChatIntegration {
	private options: Required<IntegrationOptions>
	private currentStatus: StatusUpdate = { status: 'ready', message: 'Ready' }
	private recognition: any = null
	private isListening = false
	private activeMode = false
	private silenceTimeout: ReturnType<typeof setTimeout> | null = null
	private conversationHistory: { role: string; content: string }[] = []
	private llmEngine: any = null

	constructor(options: IntegrationOptions = {}) {
		this.options = {
			wakeWords: options.wakeWords ?? ['hey ai'],
			silenceTimeoutMs: options.silenceTimeoutMs ?? 5000,
			language: options.language ?? 'en-US',
			onStatusChange: options.onStatusChange ?? (() => {}),
			onError: options.onError ?? (() => {}),
			onMessage: options.onMessage ?? (() => {}),
		}
	}

	// ── Initialisation ────────────────────────────────────────────────────────

	async initialize(): Promise<boolean> {
		try {
			this.updateStatus('initializing', 'Initializing...')

			const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
			if (!SR) throw new Error('Speech recognition not supported in this browser')

			this.recognition = new SR()
			this.recognition!.continuous = true
			this.recognition!.interimResults = true
			this.recognition!.lang = this.options.language

			this.recognition!.onstart = () => {
				this.isListening = true
				this.updateStatus('listening', 'Listening...')
			}
    this.recognition!.onresult = (e: any) => this.handleSpeechResult(e)
    this.recognition!.onerror  = (e: any) => this.handleSpeechError(e)
			this.recognition!.onend = () => {
				this.isListening = false
				this.activeMode  = false
				if (this.silenceTimeout) { clearTimeout(this.silenceTimeout); this.silenceTimeout = null }
				if (this.currentStatus.status === 'listening') this.updateStatus('ready', 'Ready')
			}

			// Sync wake words and language from settings
			const settings = await loadSettings()
			if (settings.wakeWords)   this.options.wakeWords = settings.wakeWords.split(' ').filter(Boolean)
			if (settings.voiceLanguage) {
				this.options.language = settings.voiceLanguage
				this.recognition!.lang = settings.voiceLanguage
			}

			this.updateStatus('ready', 'Ready')
			return true
		} catch (error) {
			this.handleError(error as Error)
			return false
		}
	}

	// ── Listening ─────────────────────────────────────────────────────────────

	startListening(activeMode = true): void {
		if (!this.recognition || this.isListening) return
		this.activeMode = activeMode
		try { this.recognition.start() } catch (e) { /* already started */ }
	}

	stopListening(): void {
		this.activeMode = false
		if (this.silenceTimeout) { clearTimeout(this.silenceTimeout); this.silenceTimeout = null }
		if (this.recognition && this.isListening) this.recognition.stop()
	}

  private handleSpeechResult(event: any): void {
		let finalTranscript = ''
		let interimTranscript = ''
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const t = event.results[i][0].transcript
			if (event.results[i].isFinal) finalTranscript += t
			else interimTranscript += t
		}

		if (interimTranscript && !finalTranscript) {
			this.updateStatus('listening', `"${interimTranscript.trim()}"…`)
		}

		if (this.silenceTimeout) clearTimeout(this.silenceTimeout)
		this.silenceTimeout = setTimeout(() => this.stopListening(), this.options.silenceTimeoutMs)

		if (finalTranscript.trim()) this.processTranscript(finalTranscript.trim())
	}

  private handleSpeechError(event: any): void {
		if (event.error === 'no-speech' || event.error === 'aborted') return
		this.handleError(new Error(`Speech error: ${event.error}`))
	}

	private processTranscript(transcript: string): void {
		if (this.activeMode) {
			this.stopListening()
			this.handleVoiceQuery(transcript)
			return
		}
		const lower = transcript.toLowerCase()
		if (this.options.wakeWords.some(w => lower.includes(w.toLowerCase()))) {
			this.handleVoiceQuery(transcript)
		}
	}

	// ── Voice query path ──────────────────────────────────────────────────────

	private async handleVoiceQuery(query: string): Promise<void> {
		this.options.onMessage({ role: 'user', content: query })
		try {
			this.updateStatus('processing', 'Thinking…')
			const { answer, thinking } = await this.sendTextMessage(query)
			this.options.onMessage({ role: 'assistant', content: answer, thinking })
			this.updateStatus('speaking', 'Responding…')
			await this.speakResponse(answer)
		} catch (error) {
			this.handleError(error as Error)
		}
	}

	// ── LLM call (Option B: settings → createLLMConfigFromProvider → call) ───

	async sendTextMessage(message: string, images: { dataUrl: string; mimeType: string }[] = []): Promise<{ answer: string; thinking: string }> {
		const settings = await loadSettings()

		if (settings.apiProvider === 'demo') {
			throw new LLMProviderNotConfiguredError()
		}

		const config = createLLMConfigFromProvider(settings)

		const historyText = message || (images.length ? '[Attached image(s)]' : '')
		this.conversationHistory.push({ role: 'user', content: historyText })

		let result: { answer: string; thinking: string }
		try {
			switch (config.provider) {
				case 'anthropic': result = await this.callAnthropic(config, message, images); break
				case 'local':     result = await this.callLocalEndpoint(config, message, images); break
				case 'browser':   result = await this.callBrowserLLM(config, message, images); break
				default:          result = await this.callOpenAI(config, message, images)
			}
		} catch (error) {
			this.conversationHistory.pop()
			throw error
		}

		this.conversationHistory.push({ role: 'assistant', content: result.answer })
		if (this.conversationHistory.length > 40) {
			this.conversationHistory = this.conversationHistory.slice(-40)
		}
		return result
	}

	// ── Provider implementations ──────────────────────────────────────────────

	private async callAnthropic(config: any, userMessage: string, images: any[]): Promise<{ answer: string; thinking: string }> {
		const priorHistory = this.conversationHistory.slice(0, -1)
		const lastContent = images.length > 0
			? [
				...images.map((img: any) => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.dataUrl.split(',')[1] } })),
				{ type: 'text', text: userMessage || 'Please describe these images.' },
			]
			: userMessage

		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': config.apiKey,
				'anthropic-version': '2023-06-01',
				'anthropic-dangerous-direct-browser-access': 'true',
			},
			body: JSON.stringify({
				model: config.model,
				system: 'You are a concise and helpful AI assistant.',
				messages: [...priorHistory, { role: 'user', content: lastContent }],
				max_tokens: 1024,
			}),
		})

		if (!res.ok) {
			const body = await res.json().catch(() => ({}))
			throw new Error((body as any)?.error?.message || `Anthropic API error (${res.status})`)
		}

		const data = await res.json()
		const thinking = ((data.content ?? []) as any[])
			.filter((b: any) => b.type === 'thinking')
			.map((b: any) => b.thinking?.trim())
			.filter(Boolean)
			.join('\n\n')
		const answer = ((data.content ?? []) as any[]).find((b: any) => b.type === 'text')?.text?.trim() ?? ''
		return { answer, thinking }
	}

	private async callOpenAI(config: any, userMessage: string, images: any[]): Promise<{ answer: string; thinking: string }> {
		const priorHistory = this.conversationHistory.slice(0, -1)
		const lastMsg = images.length > 0
			? { role: 'user', content: [...images.map((img: any) => ({ type: 'image_url', image_url: { url: img.dataUrl } })), { type: 'text', text: userMessage || 'Please describe these images.' }] }
			: { role: 'user', content: userMessage }

		const model = images.length > 0 ? 'gpt-4o' : config.model

		const res = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
			body: JSON.stringify({
				model,
				messages: [{ role: 'system', content: 'You are a concise and helpful AI assistant.' }, ...priorHistory, lastMsg],
				temperature: 0.7,
				max_tokens: 1024,
			}),
		})

		if (!res.ok) {
			const body = await res.json().catch(() => ({}))
			throw new Error((body as any)?.error?.message || `OpenAI API error (${res.status})`)
		}

		const data = await res.json()
		return parseThinkTags(data.choices?.[0]?.message?.content?.trim() ?? '')
	}

	private async callLocalEndpoint(config: any, userMessage: string, images: any[]): Promise<{ answer: string; thinking: string }> {
		let url = (config.baseURL as string).replace(/\/+$/, '')
		if (!url.endsWith('/chat/completions')) {
			url = url.endsWith('/v1') ? `${url}/chat/completions` : `${url}/v1/chat/completions`
		}

		const priorHistory = this.conversationHistory.slice(0, -1)
		const lastMsg = images.length > 0
			? { role: 'user', content: [...images.map((img: any) => ({ type: 'image_url', image_url: { url: img.dataUrl } })), { type: 'text', text: userMessage || 'Describe these images.' }] }
			: { role: 'user', content: userMessage }

		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages: [{ role: 'system', content: 'You are a concise and helpful AI assistant.' }, ...priorHistory, lastMsg],
				temperature: 0.7,
				max_tokens: 1024,
				stream: false,
			}),
		})

		if (!res.ok) {
			const body = await res.json().catch(() => ({}))
			throw new Error((body as any)?.error?.message || `Local LLM error (${res.status})`)
		}

		const data = await res.json()
		return parseThinkTags(data.choices?.[0]?.message?.content?.trim() ?? '')
	}

	private async callBrowserLLM(config: any, userMessage: string, images: any[]): Promise<{ answer: string; thinking: string }> {
		if (!config.currentLocalModel) {
			throw new Error('No browser model selected. Open Settings → Local LLM to download one first.')
		}

		// Phase 2a: WebLLM engine loaded via offscreen bridge
		// For now, fall through to a placeholder until offscreen infra is wired
		if (!this.llmEngine) {
			// No /* @vite-ignore */ here: that comment tells Vite to leave the bare
			// specifier unresolved, which then fails at runtime in the browser
			// ("Failed to resolve module specifier '@mlc-ai/web-llm'"). Let Vite
			// statically bundle this import instead (see BrowserLLMClient.ts).
			const { CreateMLCEngine } = await import('@mlc-ai/web-llm').catch(() => {
				throw new Error('WebLLM not available. Download a model from Settings → Local LLM first.')
			})
			this.updateStatus('downloading', 'Loading model…')
			this.llmEngine = await CreateMLCEngine(config.currentLocalModel, {
				initProgressCallback: (p: any) => {
					this.updateStatus('downloading', p.text || `Loading… ${Math.round((p.progress ?? 0) * 100)}%`)
				},
    chatOpts: { context_window_size: config.currentLocalModelContextWindow ?? 8192 }
			} as any)
		}

		this.updateStatus('processing', 'Thinking…')
		const priorHistory = this.conversationHistory.slice(0, -1)
		const lastMsg = images.length > 0
			? { role: 'user', content: [...images.map((img: any) => ({ type: 'image_url', image_url: { url: img.dataUrl } })), { type: 'text', text: userMessage || 'Describe these images.' }] }
			: { role: 'user', content: userMessage }

		const reply = await this.llmEngine.chat.completions.create({
			messages: [{ role: 'system', content: 'You are a concise and helpful AI assistant.' }, ...priorHistory, lastMsg],
			temperature: 0.7,
			max_tokens: 1024,
		})

		return parseThinkTags(reply.choices?.[0]?.message?.content?.trim() ?? '')
	}

	// ── TTS ───────────────────────────────────────────────────────────────────

	speakResponse(text: string): Promise<void> {
		return new Promise(resolve => {
			if (!('speechSynthesis' in window)) { resolve(); return }
			speechSynthesis.cancel()
			const utterance = new SpeechSynthesisUtterance(text)
			utterance.onend   = () => { this.updateStatus('ready', 'Ready'); resolve() }
			utterance.onerror = () => { this.updateStatus('ready', 'Ready'); resolve() }
			speechSynthesis.speak(utterance)
		})
	}

	// ── Status & lifecycle ────────────────────────────────────────────────────

	getCurrentStatus(): StatusUpdate {
		return { ...this.currentStatus, isListening: this.isListening }
	}

	updateStatus(status: VoiceStatus, message: string): void {
		this.currentStatus = { status, message }
		this.options.onStatusChange(this.currentStatus)
	}

	private handleError(error: Error): void {
		this.updateStatus('error', error.message)
		this.options.onError(error)
	}

	clearHistory(): void {
		this.conversationHistory = []
	}

	dispose(): void {
		if (this.silenceTimeout) clearTimeout(this.silenceTimeout)
		if ('speechSynthesis' in window) speechSynthesis.cancel()
		if (this.recognition) {
			try { this.recognition.abort() } catch (_) {}
			this.recognition = null
		}
		if (this.llmEngine) {
			this.llmEngine.unload?.().catch?.(() => {})
			this.llmEngine = null
		}
	}
}
