/**
 * Extension-wide settings, currently only the optional "Ask" mode's text LLM.
 *
 * Only private providers exist: a local OpenAI-compatible server or a model running in the browser.
 * Ask sends excerpts of the user's files to the LLM, so a cloud provider would contradict the
 * product's "nothing leaves your device" promise.
 *
 * Storage is decoupled from any browser API via `storageAdapter.ts`. To run this module in another
 * environment (Firefox, plain web page, test harness) call `setStorageAdapter()` first.
 */
import { getStorageAdapter } from './storageAdapter'

export type TextLLMProvider = 'local' | 'browser'

/** Interface languages; must match `SupportedUILanguage` in `i18n/locales.ts`. */
export type UILanguage = 'en-US' | 'de-DE' | 'zh-CN' | 'zh-HK'

export interface UnifiedSettings {
	/**
	 * Interface language pinned by the user (Manage page). `undefined` means "follow the browser",
	 * re-detected on each load; once the user picks one it no longer auto-follows.
	 */
	uiLanguage?: UILanguage

	/** Provider for Ask mode. Unset until the user picks one; Ask stays disabled while unset. */
	textLLMProvider?: TextLLMProvider
	/** Endpoint URL when `textLLMProvider === 'local'` (falls back to `localEndpointUrl`). */
	textLLMEndpoint?: string
	/** Model name when `textLLMProvider` is `local` or `browser` (falls back to `currentLocalModel`). */
	textLLMModel?: string

	// Written by the Browser LLM page after it downloads a WebLLM model.
	localEndpointUrl?: string
	currentLocalModel?: string | null
	currentLocalModelContextWindow?: number
	disableNamedToolChoice?: boolean
}

export const DEFAULT_SETTINGS: UnifiedSettings = {
	localEndpointUrl: '',
	currentLocalModel: undefined,
	currentLocalModelContextWindow: 8192,
	disableNamedToolChoice: true,
}

/** Storage keys used by all adapters. */
export const STORAGE_KEYS = {
	SETTINGS: 'pageAgentSettings',
} as const

/**
 * Settings saved by older builds may carry a cloud provider ('openai', 'anthropic'), the removed
 * shared demo endpoint, or 'use-global'. None of those are valid any more; drop them so Ask shows
 * "choose a provider" instead of silently sending text somewhere the user never chose.
 */
function normalize(stored: Partial<UnifiedSettings> & { textLLMProvider?: string }): UnifiedSettings {
	const provider = stored.textLLMProvider
	const valid = provider === 'local' || provider === 'browser' ? provider : undefined
	return { ...DEFAULT_SETTINGS, ...stored, textLLMProvider: valid }
}

export async function loadSettings(): Promise<UnifiedSettings> {
	try {
		const stored = (await getStorageAdapter().get(STORAGE_KEYS.SETTINGS)) as Partial<UnifiedSettings> | undefined
		return stored ? normalize(stored) : DEFAULT_SETTINGS
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
