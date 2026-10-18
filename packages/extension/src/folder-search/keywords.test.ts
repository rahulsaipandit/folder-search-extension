import { describe, expect, it } from 'vitest'

import { looksExact, makeSnippet, queryTerms, scoreKeywords, tokenize } from './keywords'

describe('tokenize', () => {
	it('indexes compound identifiers whole and by part', () => {
		expect(tokenize('Invoice INV-2024-0042 paid')).toEqual(
			expect.arrayContaining(['invoice', 'inv-2024-0042', 'inv', '2024', '0042', 'paid'])
		)
		expect(tokenize('see report.final.pdf')).toEqual(expect.arrayContaining(['report.final.pdf', 'report', 'pdf']))
	})

	it('handles non-Latin scripts', () => {
		expect(tokenize('预算 报告 2024')).toEqual(expect.arrayContaining(['预算', '报告', '2024']))
	})
})

describe('queryTerms', () => {
	it('drops stopwords and duplicates', () => {
		expect(queryTerms('photos of the beach beach')).toEqual(['beach'])
	})
})

describe('looksExact', () => {
	it.each(['INV-2024-0042', '"quarterly budget"', 'ECONNREFUSED', 'a@b.com', '0x1F4A', 'C:/work/x.txt'])(
		'treats %s as an identifier',
		q => expect(looksExact(q)).toBe(true)
	)
	it.each(['beach sunset with dog', 'Q3 budget contract', 'photos of my cat', ''])(
		'treats %s as a description',
		q => expect(looksExact(q)).toBe(false)
	)
})

describe('scoreKeywords', () => {
	const postings = new Map<string, Record<string, number>>([
		['acme', { 'a#0': 1, 'b#0': 1, 'c#0': 1 }],
		['inv-2024-0042', { 'b#0': 1 }],
	])

	it('ranks the chunk with the rare, exact term first and reports matched terms', () => {
		const hits = scoreKeywords(['acme', 'inv-2024-0042'], postings, { n: 100 })
		expect(hits[0]).toMatchObject({ chunkId: 'b#0', matchedTerms: ['acme', 'inv-2024-0042'] })
		expect(hits).toHaveLength(3)
	})

	it('returns nothing for unknown terms', () => {
		expect(scoreKeywords(['nope'], postings, { n: 100 })).toEqual([])
	})
})

describe('makeSnippet', () => {
	const long = 'lorem '.repeat(80) + 'The Biscuit dog loved the beach. ' + 'ipsum '.repeat(80)

	it('centres the window on the first match and marks truncation', () => {
		const s = makeSnippet(long, ['biscuit'], 120)
		expect(s.toLowerCase()).toContain('biscuit')
		expect(s.startsWith('…') && s.endsWith('…')).toBe(true)
		expect(s.length).toBeLessThanOrEqual(124)
	})

	it('falls back to the start of the text when nothing matches', () => {
		expect(makeSnippet(long, ['zzz'], 50).startsWith('lorem')).toBe(true)
	})
})
