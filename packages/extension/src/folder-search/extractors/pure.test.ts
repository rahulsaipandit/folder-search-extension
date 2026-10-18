import { describe, expect, it } from 'vitest'

import { decodeEntities, docxXmlToText, fingerprint, joinPdfItems, stripRtf, stripTags } from './pure'

describe('docxXmlToText', () => {
	it('keeps paragraph boundaries, tabs and entity-encoded text, and ignores formatting runs', () => {
		const xml =
			'<w:body><w:p><w:pPr><w:b/></w:pPr><w:r><w:t>Q3 &amp; Q4</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> budget</w:t></w:r></w:p>' +
			'<w:p></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body>'
		expect(docxXmlToText(xml)).toBe('Q3 & Q4\t budget\n\nSecond')
	})
})

describe('stripTags', () => {
	it('drops scripts and styles but keeps visible text and line structure', () => {
		const html = '<style>p{}</style><p>One &lt;1&gt;</p><script>alert(1)</script><p>Two</p>'
		expect(stripTags(html)).toBe('One <1>\nTwo')
	})
})

describe('decodeEntities', () => {
	it('decodes numeric entities and leaves unknown ones and invalid code points alone', () => {
		expect(decodeEntities('&#65;&#x42; &bogus; &#0;')).toBe('AB &bogus; &#0;')
	})
})

describe('stripRtf', () => {
	it('extracts text and decodes escapes', () => {
		const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Caf\\\'e9 plan\\par Next \\u8364? line}'
		const out = stripRtf(rtf)
		expect(out).toContain('Café plan')
		expect(out).toContain('Next € line')
		expect(out).not.toContain('Arial')
	})
})

describe('joinPdfItems', () => {
	const item = (str: string, y: number, extra = {}) => ({ str, transform: [10, 0, 0, 10, 0, y], ...extra })

	it('joins words on a baseline with spaces and starts new lines/paragraphs by vertical gap', () => {
		const text = joinPdfItems([
			item('Hello', 100),
			item('world', 100),
			item('next line', 88),
			item('new paragraph', 40),
		])
		expect(text).toBe('Hello world\nnext line\n\nnew paragraph')
	})

	it('honours explicit end-of-line markers', () => {
		expect(joinPdfItems([{ str: 'a', hasEOL: true }, { str: 'b' }])).toBe('a\nb')
	})
})

describe('fingerprint', () => {
	it('is stable for identical bytes and differs when a sampled region differs', async () => {
		const a = new Blob([new Uint8Array(20000).fill(1)])
		const b = new Blob([new Uint8Array(20000).fill(1)])
		const bytes = new Uint8Array(20000).fill(1)
		bytes[19999] = 2
		expect(await fingerprint(a)).toBe(await fingerprint(b))
		expect(await fingerprint(a)).not.toBe(await fingerprint(new Blob([bytes])))
		expect(await fingerprint(new Blob([new Uint8Array(10)]))).toMatch(/^10-/)
	})
})
