import { describe, expect, it } from 'vitest'

import { buildDocumentInput, buildQueryInput, chunkPages, chunkText } from './chunker'

const para = (label: string, n: number) => `${label} ` + 'word '.repeat(n).trim() + '.'

describe('chunkText', () => {
	it('returns nothing for blank input and one chunk for short input', () => {
		expect(chunkText('  \n\n ')).toEqual([])
		const [c, ...rest] = chunkText('Short note.')
		expect(rest).toHaveLength(0)
		expect(c).toMatchObject({ text: 'Short note.', offset: 0 })
	})

	it('never exceeds maxChars, even for one enormous unbroken paragraph', () => {
		const text = 'x'.repeat(10_000)
		const chunks = chunkText(text, { maxChars: 1200, targetChars: 800 })
		expect(chunks.length).toBeGreaterThan(5)
		for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1200)
		// Hard-cut pieces must cover the whole input without losing characters.
		expect(chunks.reduce((n, c) => n + c.text.length, 0)).toBeGreaterThanOrEqual(10_000)
	})

	it('splits on paragraph boundaries and records offsets that point at the chunk text', () => {
		const text = [para('alpha', 90), para('bravo', 90), para('charlie', 90)].join('\n\n')
		const chunks = chunkText(text, { targetChars: 600, maxChars: 900, overlapRatio: 0 })
		expect(chunks.length).toBe(3)
		for (const c of chunks) expect(text.slice(c.offset, c.offset + 5)).toBe(c.text.slice(0, 5))
	})

	it('overlaps neighbouring chunks by whole paragraphs and always makes progress', () => {
		const small = Array.from({ length: 30 }, (_, i) => para(`p${i}`, 8)).join('\n\n')
		const chunks = chunkText(small, { targetChars: 400, maxChars: 800, overlapRatio: 0.3 })
		expect(chunks.length).toBeGreaterThan(2)
		for (let i = 1; i < chunks.length; i++) {
			const prevTail = chunks[i - 1]!.text.split('\n\n').pop()!
			expect(chunks[i]!.text.includes(prevTail)).toBe(true)
			expect(chunks[i]!.offset).toBeGreaterThan(chunks[i - 1]!.offset)
		}
		// Every paragraph appears in at least one chunk.
		for (let i = 0; i < 30; i++) expect(chunks.some(c => c.text.includes(`p${i} `))).toBe(true)
	})

	it('keeps markdown headings as boundaries', () => {
		const chunks = chunkText('# One\nbody one\n# Two\nbody two', { targetChars: 12, overlapRatio: 0 })
		expect(chunks.map(c => c.text.startsWith('#'))).toEqual(chunks.map(() => true))
	})
})

describe('chunkPages', () => {
	it('tags chunks with their page and does not merge across pages', () => {
		const chunks = chunkPages([
			{ page: 1, text: 'First page text.' },
			{ page: 2, text: '   ' },
			{ page: 3, text: 'Third page text.' },
		])
		expect(chunks.map(c => c.page)).toEqual([1, 3])
	})
})

describe('prompt builders', () => {
	it('prefixes per the EmbeddingGemma 2 contract and puts the path in the title', () => {
		expect(buildQueryInput('beach')).toBe('task: search result | query: beach')
		expect(buildDocumentInput('trips\\2024\\plan.pdf', 'hello')).toBe(
			'title: trips / 2024 / plan.pdf | text: hello'
		)
		expect(buildDocumentInput('', 'x')).toBe('title: none | text: x')
	})
})
