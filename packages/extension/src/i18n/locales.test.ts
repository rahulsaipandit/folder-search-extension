import { describe, expect, it } from 'vitest'

import { SUPPORTED_UI_LANGUAGES, UI_LANGUAGE_NATIVE_NAMES, locales } from './locales'

function keysOf(obj: unknown, prefix = ''): string[] {
	if (typeof obj === 'string') return [prefix]
	return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
}

describe('locales', () => {
	const base = keysOf(locales['en-US']).sort()

	it.each(SUPPORTED_UI_LANGUAGES)('%s defines exactly the keys of en-US, so no string falls back silently', lang => {
		expect(keysOf(locales[lang]).sort()).toEqual(base)
	})

	it('keeps {{placeholders}} identical across languages', () => {
		const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
		const get = (obj: any, key: string) => key.split('.').reduce((o, k) => o?.[k], obj) as string
		for (const key of base) {
			for (const lang of SUPPORTED_UI_LANGUAGES) {
				expect(placeholders(get(locales[lang], key))).toEqual(placeholders(get(locales['en-US'], key)))
			}
		}
	})

	it('has a native display name for every supported language', () => {
		for (const lang of SUPPORTED_UI_LANGUAGES) expect(UI_LANGUAGE_NATIVE_NAMES[lang]).toBeTruthy()
	})
})
