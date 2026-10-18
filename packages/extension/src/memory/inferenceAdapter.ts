/**
 * LLM Inference Adapter - Chrome extension implementation.
 *
 * Extends BaseInferenceAdapter from @page-agent/memory with Chrome-specific
 * LLM wiring: API-based (OpenAI/Anthropic/Local) and Browser LLM (WebLLM).
 * T0 methods (extractEntities, classifyOutcome, extractWikiPage fallback)
 * are inherited from BaseInferenceAdapter.
 */

import { BaseInferenceAdapter } from "@page-agent/memory"
import type { InferenceRequest, InferenceResult } from "@page-agent/memory"
import { createLLMConfigFromProvider } from "@/llm/providers/adapter"
import { loadSettings } from "@/shared/settings"

export type { IInferenceAdapter, InferenceRequest, InferenceResult, InferenceTier } from "@page-agent/memory"

export class InferenceAdapter extends BaseInferenceAdapter {
	private llmClient: ((request: InferenceRequest) => Promise<InferenceResult>) | null = null

	// ── Initialization ────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.isReady) return
		try {
			const settings = await loadSettings()
			const config = createLLMConfigFromProvider(settings)

			if (settings.apiProvider === "browser") {
				this.llmClient = this._createBrowserClient(settings.currentLocalModel ?? undefined)
				this._clientType = "browser"
			} else {
				this.llmClient = this._createAPIClient(config)
				this._clientType = "api"
			}
			this.isReady = true
		} catch (err) {
			console.warn("[InferenceAdapter] LLM init failed, using fallback:", err)
			this.llmClient = this._createFallbackClient()
			this._clientType = "fallback"
			this.isReady = true
		}
	}

	// ── LLM inference ─────────────────────────────────────────────────────────

	async infer(request: InferenceRequest): Promise<InferenceResult> {
		if (!this.isReady) await this.initialize()
		return this.llmClient!(request)
	}

	// ── Private factories ─────────────────────────────────────────────────────

	private _createAPIClient(config: any): (request: InferenceRequest) => Promise<InferenceResult> {
		return async (request) => {
			const startTime = performance.now()
			const response = await fetch(`${config.baseURL}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: "user", content: request.prompt }],
					max_tokens: request.maxTokens ?? 512,
					temperature: request.temperature ?? 0.3,
				}),
			})
			if (!response.ok) throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
			const data = await response.json()
			return { text: data.choices?.[0]?.message?.content ?? "", tokensUsed: data.usage?.total_tokens ?? 0, latencyMs: Math.round(performance.now() - startTime), model: request.model }
		}
	}

	private _createBrowserClient(modelId?: string): (request: InferenceRequest) => Promise<InferenceResult> {
		return async (request) => {
			const response = await chrome.runtime.sendMessage({
				type: "LLM_INFERENCE",
				payload: { prompt: request.prompt, maxTokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.3, model: modelId ?? "gemma-2-2b-it-q4f16_1-MLC" },
			})
			return { text: response?.text ?? "", tokensUsed: response?.tokensUsed ?? 0, latencyMs: response?.latencyMs ?? 0, model: request.model }
		}
	}

	private _createFallbackClient(): (request: InferenceRequest) => Promise<InferenceResult> {
		return async (request) => ({
			text: `[LLM unavailable - cannot process: ${request.prompt.slice(0, 100)}]`,
			tokensUsed: 0,
			latencyMs: 0,
			model: "T3" as const,
		})
	}
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _instance: InferenceAdapter | null = null

export function getInferenceAdapter(): InferenceAdapter {
	if (!_instance) _instance = new InferenceAdapter()
	return _instance
}
