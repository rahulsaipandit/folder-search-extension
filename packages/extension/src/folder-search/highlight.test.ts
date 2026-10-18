import { describe, expect, it } from 'vitest'

import { highlightParts } from './highlight'

describe('highlightParts', () => {
	it('marks matches case-insensitively and preserves the original text', () => {
		const parts = highlightParts('The Biscuit dog and biscuit', ['biscuit'])
		expect(parts.map(p => p.text).join('')).toBe('The Biscuit dog and biscuit')
		expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(['Biscuit', 'biscuit'])
	})

	it('treats regex metacharacters in terms literally and prefers the longest term', () => {
		expect(highlightParts('a.b and axb', ['a.b']).filter(p => p.hit).map(p => p.text)).toEqual(['a.b'])
		expect(highlightParts('inv-2024 inv', ['inv', 'inv-2024']).filter(p => p.hit).map(p => p.text)).toEqual(['inv-2024', 'inv'])
	})

	it('returns the text untouched when there is nothing to highlight', () => {
		expect(highlightParts('plain', [])).toEqual([{ text: 'plain', hit: false }])
		expect(highlightParts('', ['x'])).toEqual([{ text: '', hit: false }])
	})
})
