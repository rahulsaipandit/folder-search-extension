import { SUPPORTED_UI_LANGUAGES, type SupportedUILanguage } from './locales'

/**
 * Maps a BCP-47 tag (as reported by `navigator.language`) to the closest supported UI
 * locale. Region-specific Chinese needs explicit handling: `zh-HK`/`zh-TW`/`zh-MO` are
 * Traditional Chinese, everything else `zh-*` (including bare `zh`) is Simplified.
 */
export function resolveUILanguage(tag: string): SupportedUILanguage {
	const normalized = tag.toLowerCase()

	if (normalized.startsWith('zh')) {
		return normalized === 'zh-hk' || normalized === 'zh-tw' || normalized === 'zh-mo'
			? 'zh-HK'
			: 'zh-CN'
	}

	const exactMatch = SUPPORTED_UI_LANGUAGES.find((lang) => lang.toLowerCase() === normalized)
	if (exactMatch) return exactMatch

	const languagePart = normalized.split('-')[0]
	const baseMatch = SUPPORTED_UI_LANGUAGES.find((lang) =>
		lang.toLowerCase().startsWith(languagePart)
	)
	if (baseMatch) return baseMatch

	return 'en-US'
}

/** Detects the browser's preferred UI locale, falling back to `en-US`. */
export function detectBrowserUILanguage(): SupportedUILanguage {
	if (typeof navigator === 'undefined' || !navigator.language) return 'en-US'
	return resolveUILanguage(navigator.language)
}
