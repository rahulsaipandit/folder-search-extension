/**
 * UI locale resources for the extension sidepanel.
 *
 * This is separate from `@page-agent/ui`'s `I18n` (which localizes the page-agent Panel's
 * own strings) and from `UnifiedSettings.language` (the voice/STT language preference).
 * `en-US` is the base/reference language — every other locale must match its key structure.
 */

export type SupportedUILanguage = 'en-US' | 'de-DE' | 'zh-CN' | 'zh-HK'

export const SUPPORTED_UI_LANGUAGES: SupportedUILanguage[] = ['en-US', 'de-DE', 'zh-CN', 'zh-HK']

/** Native display name shown for each option in the language picker itself. */
export const UI_LANGUAGE_NATIVE_NAMES: Record<SupportedUILanguage, string> = {
	'en-US': 'English',
	'de-DE': 'Deutsch',
	'zh-CN': '简体中文',
	'zh-HK': '繁體中文 (香港)',
}

const enUS = {
	settings: {
		interfaceLanguage: 'Interface Language',
		interfaceLanguageAuto: 'Auto ({{language}})',
	},
} as const

const deDE: TranslationSchema = {
	settings: {
		interfaceLanguage: 'Oberflächensprache',
		interfaceLanguageAuto: 'Automatisch ({{language}})',
	},
}

const zhCN: TranslationSchema = {
	settings: {
		interfaceLanguage: '界面语言',
		interfaceLanguageAuto: '自动 ({{language}})',
	},
}

const zhHK: TranslationSchema = {
	settings: {
		interfaceLanguage: '介面語言',
		interfaceLanguageAuto: '自動（{{language}}）',
	},
}

type DeepStringify<T> = {
	[K in keyof T]: T[K] extends string ? string : T[K] extends object ? DeepStringify<T[K]> : T[K]
}

export type TranslationSchema = DeepStringify<typeof enUS>

type Join<K extends string, P extends string> = P extends '' ? K : `${K}.${P}`
type PathsOf<T> = T extends string
	? ''
	: { [K in keyof T & string]: Join<K, PathsOf<T[K]>> }[keyof T & string]

export type TranslationKey = PathsOf<typeof enUS>
export type TranslationParams = Record<string, string | number>

export const locales: Record<SupportedUILanguage, TranslationSchema> = {
	'en-US': enUS,
	'de-DE': deDE,
	'zh-CN': zhCN,
	'zh-HK': zhHK,
}
