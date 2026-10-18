import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { loadSettings, saveSettings } from '@/shared/settings'

import { detectBrowserUILanguage } from './detectLanguage'
import {
	type SupportedUILanguage,
	type TranslationKey,
	type TranslationParams,
	locales,
} from './locales'

interface I18nContextValue {
	/** The language currently in effect (explicit pick, or browser-detected). */
	language: SupportedUILanguage
	/** The user's explicit pick, if any - `undefined` while following the browser. */
	explicitLanguage: SupportedUILanguage | undefined
	setLanguage: (language: SupportedUILanguage | undefined) => void
	t: (key: TranslationKey, params?: TranslationParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getNestedValue(obj: unknown, path: string): string | undefined {
	return path.split('.').reduce<unknown>((current, key) => {
		if (current && typeof current === 'object' && key in current) {
			return (current as Record<string, unknown>)[key]
		}
		return undefined
	}, obj) as string | undefined
}

function interpolate(template: string, params: TranslationParams): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
		params[key] != null ? String(params[key]) : match
	)
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
	// Synchronous browser detection first so the first paint is never wrong while the async
	// settings load resolves an explicit pick.
	const [explicitLanguage, setExplicitLanguage] = useState<SupportedUILanguage | undefined>(
		undefined
	)
	const [browserLanguage] = useState<SupportedUILanguage>(() => detectBrowserUILanguage())

	useEffect(() => {
		loadSettings().then((settings) => {
			if (settings.uiLanguage) setExplicitLanguage(settings.uiLanguage)
		})
	}, [])

	const setLanguage = useCallback((language: SupportedUILanguage | undefined) => {
		setExplicitLanguage(language)
		saveSettings({ uiLanguage: language }).catch((error) => {
			console.error('[I18n] Failed to persist interface language:', error)
		})
	}, [])

	const language = explicitLanguage ?? browserLanguage

	const t = useCallback(
		(key: TranslationKey, params?: TranslationParams) => {
			const value = getNestedValue(locales[language], key) ?? getNestedValue(locales['en-US'], key)
			if (!value) {
				console.warn(`[I18n] Translation key "${key}" not found`)
				return key
			}
			return params ? interpolate(value, params) : value
		},
		[language]
	)

	const value = useMemo(
		() => ({ language, explicitLanguage, setLanguage, t }),
		[language, explicitLanguage, setLanguage, t]
	)

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
	const context = useContext(I18nContext)
	if (!context) throw new Error('useI18n must be used within an I18nProvider')
	return context
}
