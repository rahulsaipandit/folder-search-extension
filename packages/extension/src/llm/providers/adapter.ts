/**
 * Resolves the text LLM used by the optional Ask mode.
 *
 * Only private providers are supported (see `shared/settings.ts`): a local OpenAI-compatible
 * server, or a WebLLM model running in the browser.
 */
import type { LLMConfig } from '@page-agent/llms'

import type { TextLLMProvider, UnifiedSettings } from '../../shared/settings'

/**
 * Builds the LLM config for the chosen provider, or `null` when it is not usable yet
 * (no provider chosen, no model, or no endpoint). Callers must treat `null` as "ask the user to
 * set up a private provider" and never fall back to some other provider.
 */
export function getTextLLMConfig(settings: UnifiedSettings): LLMConfig | null {
	const provider: TextLLMProvider | undefined = settings.textLLMProvider
	if (!provider) return null

	if (provider === 'local') {
		const baseURL = settings.textLLMEndpoint || settings.localEndpointUrl || 'http://localhost:1234/v1'
		const model = settings.textLLMModel || settings.currentLocalModel
		if (!model) return null
		return {
			provider: 'local',
			baseURL,
			apiKey: 'NA',
			model,
			maxRetries: 3,
			localEndpointUrl: baseURL,
			// Local servers (LM Studio, Ollama) generally want a string tool_choice; see OpenAIClient.ts.
			disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
		}
	}

	const model = settings.textLLMModel || settings.currentLocalModel
	// A missing model must stay missing: BrowserLLMClient then throws a clear "No browser model
	// selected" instead of WebLLM's cryptic "Cannot find model record in appConfig".
	if (!model) return null
	return {
		provider: 'browser',
		baseURL: 'browser://',
		apiKey: 'NA',
		model,
		maxRetries: 3,
		currentLocalModel: model,
		currentLocalModelContextWindow: settings.currentLocalModelContextWindow,
		disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
	}
}
