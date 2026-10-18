/**
 * LLM provider adapters and utilities
 */

import { DEMO_API_KEY, DEMO_BASE_URL, DEMO_MODEL } from '../../agent/constants'
import type { LLMConfig } from '@page-agent/llms'
import type { UnifiedSettings } from '../../shared/settings'

// Provider-specific configurations
export interface ProviderSettings {
	apiProvider: 'openai' | 'anthropic' | 'local' | 'browser' | 'demo'
	openaiApiKey?: string
	openaiModel?: string
	anthropicApiKey?: string
	anthropicModel?: string
	localEndpointUrl?: string
	currentLocalModel?: string | null
	currentLocalModelContextWindow?: number
	demoBaseURL?: string
	disableNamedToolChoice?: boolean
}

/**
 * Creates LLMConfig from provider-specific settings
 */
export function createLLMConfigFromProvider(settings: ProviderSettings): LLMConfig {
	const { apiProvider } = settings

	switch (apiProvider) {
		case 'openai':
			return {
				provider: 'openai',
				baseURL: 'https://api.openai.com/v1',
				apiKey: settings.openaiApiKey || '',
				model: settings.openaiModel || 'gpt-4o',
				maxRetries: 3,
				openaiApiKey: settings.openaiApiKey,
				openaiModel: settings.openaiModel,
			}

		case 'anthropic':
			return {
				provider: 'anthropic',
				baseURL: 'https://api.anthropic.com/v1',
				apiKey: settings.anthropicApiKey || '',
				model: settings.anthropicModel || 'claude-sonnet-4-6',
				maxRetries: 3,
				anthropicApiKey: settings.anthropicApiKey,
				anthropicModel: settings.anthropicModel,
			}

		case 'local':
			return {
				provider: 'local',
				baseURL: settings.localEndpointUrl || 'http://localhost:1234/v1',
				apiKey: 'NA',
				model: settings.currentLocalModel || 'local-model',
				maxRetries: 3,
				localEndpointUrl: settings.localEndpointUrl,
				// Default to true for local servers (LM Studio, Ollama, etc.)
				// See OpenAIClient.ts for explanation
				disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
			}

		case 'browser':
			console.log('[createLLMConfigFromProvider] browser case, settings.currentLocalModel=%o', settings.currentLocalModel)
			return {
				provider: 'browser',
				baseURL: 'browser://',
				apiKey: 'NA',
				// Leave unset (rather than a placeholder like 'default') when no model was
				// chosen in Settings, so BrowserLLMClient's own guard throws a clear
				// "No browser model selected" error instead of WebLLM's cryptic
				// "Cannot find model record in appConfig" for a nonexistent model id.
				model: settings.currentLocalModel || '',
				maxRetries: 3,
				currentLocalModel: settings.currentLocalModel,
				currentLocalModelContextWindow: settings.currentLocalModelContextWindow,
				// Browser LLM also benefits from string tool_choice
				disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
			}

		case 'demo':
			return {
				provider: 'openai',
				baseURL: settings.demoBaseURL || DEMO_BASE_URL,
				apiKey: DEMO_API_KEY,
				model: DEMO_MODEL,
				maxRetries: 3,
			}

		default:
			throw new Error(`Unknown provider: ${apiProvider}`)
	}
}

/**
 * Returns true when the global navigation provider is the shared demo endpoint.
 * Used by text-feature settings to decide whether to show the privacy warning.
 */
export function isDemoProvider(settings: UnifiedSettings): boolean {
	return settings.apiProvider === 'demo'
}

/**
 * Resolves the effective LLM config for simple text/language features and other
 * non-navigation text operations.
 *
 * Decision table:
 *   global=demo  + no text override  →  null  (caller must block + show warning)
 *   global=demo  + text override     →  override config (navigation keeps demo)
 *   global≠demo  + no text override  →  global config (zero friction for real-key users)
 *   any          + text override     →  override config
 *
 * Returns null to signal "blocked - prompt the user to configure a private provider."
 */
export function getTextLLMConfig(settings: UnifiedSettings): LLMConfig | null {
	const { textLLMProvider } = settings
	const hasOverride = !!textLLMProvider && textLLMProvider !== 'use-global'
	console.log('[getTextLLMConfig] textLLMProvider=%o hasOverride=%o globalApiProvider=%o', textLLMProvider, hasOverride, settings.apiProvider)

	if (hasOverride) {
		// Build effective provider settings from the text-LLM override, falling back
		// to global fields for anything not explicitly overridden.
		const overrideSettings: ProviderSettings = {
			...settings,
			apiProvider: textLLMProvider as Exclude<typeof textLLMProvider, 'use-global'>,
			// `|| ` (not `??`) on purpose: textLLMModel/textLLMEndpoint can be persisted
			// as an empty string (e.g. Text LLM Settings saved with "browser" selected but no
			// model chosen yet) - `??` only falls back on null/undefined and would then
			// permanently pin the override to '', ignoring a model picked later in the
			// global Browser LLM settings page.
			localEndpointUrl: settings.textLLMEndpoint || settings.localEndpointUrl,
			currentLocalModel: settings.textLLMModel || settings.currentLocalModel,
		}
		console.log('[getTextLLMConfig] using override settings', {
			apiProvider: overrideSettings.apiProvider,
			currentLocalModel: overrideSettings.currentLocalModel,
			textLLMModel: settings.textLLMModel,
			globalCurrentLocalModel: settings.currentLocalModel,
		})
		return createLLMConfigFromProvider(overrideSettings)
	}

	// No override - inherit global. Block only if the global provider is demo.
	if (settings.apiProvider === 'demo') {
		console.log('[getTextLLMConfig] no override, global provider is demo -> blocked (null)')
		return null
	}

	console.log('[getTextLLMConfig] no override, using global settings as-is', {
		apiProvider: settings.apiProvider,
		currentLocalModel: settings.currentLocalModel,
	})
	return createLLMConfigFromProvider(settings)
}

/**
 * Gets the effective baseURL for a provider (for UI display)
 */
export function getBaseURLForProvider(provider: string): string {
	switch (provider) {
		case 'openai':
			return 'https://api.openai.com/v1'
		case 'anthropic':
			return 'https://api.anthropic.com/v1'
		case 'local':
			return 'http://localhost:1234/v1'
		case 'browser':
			return 'browser://'
		case 'demo':
			return DEMO_BASE_URL
		default:
			return 'https://api.openai.com/v1'
	}
}