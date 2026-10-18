import { describe, expect, it } from 'vitest'

import { buildAskMessages, citedSources, pickSources } from './ask'
import type { DocumentHit } from './types'

const hit = (relPath: string, excerpt: string, page?: number): DocumentHit => ({
	folderId: 'f', fileId: `f:${relPath}`, relPath, score: 0, calibrated: 5, snippet: '', excerpt,
	page, matchedTerms: [], matchedChunks: 1, hasPageThumbnail: !excerpt,
})

describe('pickSources', () => {
	it('skips hits with no text, numbers the rest, and caps the count', () => {
		const docs = [hit('scan.pdf', ''), ...Array.from({ length: 8 }, (_, i) => hit(`d${i}.md`, `text ${i}`))]
		const s = pickSources(docs)
		expect(s).toHaveLength(5)
		expect(s.map(x => x.n)).toEqual([1, 2, 3, 4, 5])
		expect(s[0]!.relPath).toBe('d0.md')
	})

	it('stays within the context budget', () => {
		const s = pickSources([hit('a.txt', 'x'.repeat(5000)), hit('b.txt', 'y'.repeat(5000)), hit('c.txt', 'z')])
		expect(s.reduce((n, x) => n + x.excerpt.length, 0)).toBeLessThanOrEqual(6000)
		expect(s.some(x => x.relPath === 'c.txt')).toBe(false)
	})
})

describe('buildAskMessages', () => {
	it('labels passages with their number, file and page, and treats them as untrusted', () => {
		const msgs = buildAskMessages('When is the deadline?', pickSources([hit('plan.pdf', 'Due 5 May.', 3)]))
		expect(msgs[1]!.content).toContain('[1] plan.pdf (page 3)')
		expect(msgs[1]!.content).toContain('Question: When is the deadline?')
		expect(String(msgs[0]!.content)).toMatch(/untrusted/)
	})
})

describe('citedSources', () => {
	const sources = pickSources([hit('a.md', 'A'), hit('b.md', 'B')])
	it('returns only sources that exist and were cited, ignoring invented numbers', () => {
		expect(citedSources('See [2] and [9].', sources).map(s => s.relPath)).toEqual(['b.md'])
		expect(citedSources('No citations.', sources)).toEqual([])
	})
})
