/**
 * Shared settings utilities for the extension.
 *
 * Storage is intentionally decoupled from any browser-specific API via
 * `storageAdapter.ts`. To run this module in a different environment
 * (Firefox, plain web page, test harness) call `setStorageAdapter()`
 * with the appropriate adapter before any settings are read or written.
 */
import { getStorageAdapter } from './storageAdapter'

export interface UnifiedSettings {
	// Provider settings
	apiProvider: 'openai' | 'anthropic' | 'local' | 'browser' | 'demo'
	openaiApiKey?: string
	openaiModel?: string
	anthropicApiKey?: string
	anthropicModel?: string
	localEndpointUrl?: string
	currentLocalModel?: string | null
	currentLocalModelContextWindow?: number
	// Only relevant for local and browser providers (see OpenAIClient.ts)
	disableNamedToolChoice?: boolean
	/**
	 * Override for the shared demo endpoint. Only meaningful when `demoBaseURLCustomized`
	 * is true - otherwise it's stale data from a previous build's DEMO_BASE_URL default and
	 * loadSettings() strips it so callers fall back to the live constant. See
	 * agent/constants.ts DEMO_BASE_URL for why this can't just be baked into defaults.
	 */
	demoBaseURL?: string
	/** True only when the user explicitly typed a custom Demo Base URL in Settings. */
	demoBaseURLCustomized?: boolean

	// Voice settings
	voiceLanguage?: string
	wakeWords?: string
	silenceTimeout?: number

	// UI preferences
	language?: 'en-US' | 'zh-CN'
	/**
	 * Sidepanel interface language, switchable at runtime from Settings. `undefined` means
	 * "follow the browser's language" (re-detected on each load via `navigator.language`) -
	 * once the user explicitly picks one, it's pinned here and no longer auto-follows the
	 * browser. Distinct from `language` above, which is the voice/STT preference.
	 */
	uiLanguage?: 'en-US' | 'de-DE' | 'zh-CN' | 'zh-HK'
	maxSteps?: number
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	enableWebsiteIntegration?: boolean
	enableAdvancedClustering?: boolean

	// Developer settings
	devMode?: boolean

	// Analytics (GA4 Measurement Protocol, see lib/analytics.ts). On by default;
	// user can opt out from Settings. analyticsClientId is a random UUID, not tied
	// to any real identity, generated once and persisted for GA session stitching.
	analyticsEnabled?: boolean
	analyticsClientId?: string

	// Text-LLM override for simple text/language features -
	// never touches the navigation agent's multimodal provider, which
	// stays on apiProvider. When unset or 'use-global', these features inherit the global
	// apiProvider UNLESS apiProvider === 'demo', in which case getTextLLMConfig() returns
	// null and the feature shows a blocking "Set up AI" screen.
	textLLMProvider?: 'use-global' | 'local' | 'browser' | 'openai' | 'anthropic'
	/** Endpoint URL when textLLMProvider === 'local' (falls back to localEndpointUrl) */
	textLLMEndpoint?: string
	/** Model name when textLLMProvider === 'local' or 'browser' (falls back to currentLocalModel) */
	textLLMModel?: string

	// SEO Rank Tracker settings (Phase 1 - free sources only, see docs/designSE_Ranking.md)
	rankNibblerApiKey?: string
	seoScoreApiKey?: string
	googleCustomSearchApiKey?: string
	/** Custom Search Engine ID ("cx" parameter) - the CSE must be configured to search the whole web. */
	googleCustomSearchEngineId?: string
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: UnifiedSettings = {
	apiProvider: 'demo',
	openaiApiKey: '',
	openaiModel: 'gpt-4o',
	anthropicApiKey: '',
	anthropicModel: 'claude-sonnet-4-6',
	localEndpointUrl: '',
	currentLocalModel: undefined,
	currentLocalModelContextWindow: 8192,
	disableNamedToolChoice: true,
	// Intentionally no baked-in demoBaseURL here - see the field's doc comment.
	// A concrete default here would freeze whatever DEMO_BASE_URL was at install time
	// into every user's storage, permanently shadowing later updates to the constant.
	demoBaseURLCustomized: false,

	voiceLanguage: 'en-US',
	wakeWords: 'hey ai, listen up, hey computer, wake up',
	silenceTimeout: 5000,

	language: 'en-US',
	maxSteps: 40,
	systemInstruction: '',
	experimentalLlmsTxt: false,
	enableWebsiteIntegration: false,
	enableAdvancedClustering: false,

	devMode: false,

	analyticsEnabled: true,

	rankNibblerApiKey: '',
	seoScoreApiKey: '',
	googleCustomSearchApiKey: '',
	googleCustomSearchEngineId: '',
}

/** Storage keys used by all adapters. */
export const STORAGE_KEYS = {
	SETTINGS: 'pageAgentSettings',
	USER_AUTH_TOKEN: 'PageAgentExtUserAuthToken',
} as const

export async function loadSettings(): Promise<UnifiedSettings> {
	try {
		const stored = (await getStorageAdapter().get(STORAGE_KEYS.SETTINGS)) as
			Partial<UnifiedSettings> | undefined
		if (!stored) return DEFAULT_SETTINGS

		// Self-heal: a demoBaseURL persisted before demoBaseURLCustomized existed (or from an
		// older build's DEMO_BASE_URL default) is stale data, not a deliberate user override.
		// Drop it so the live DEMO_BASE_URL constant takes effect instead of a frozen one.
		if (stored.demoBaseURL && !stored.demoBaseURLCustomized) {
			delete stored.demoBaseURL
		}

		return { ...DEFAULT_SETTINGS, ...stored }
	} catch (error) {
		console.error('[Settings] Failed to load settings:', error)
		return DEFAULT_SETTINGS
	}
}

export async function saveSettings(settings: Partial<UnifiedSettings>): Promise<void> {
	try {
		const current = await loadSettings()
		await getStorageAdapter().set(STORAGE_KEYS.SETTINGS, { ...current, ...settings })
	} catch (error) {
		console.error('[Settings] Failed to save settings:', error)
		throw error
	}
}

export async function resetSettings(): Promise<void> {
	try {
		await getStorageAdapter().set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS)
	} catch (error) {
		console.error('[Settings] Failed to reset settings:', error)
		throw error
	}
}
