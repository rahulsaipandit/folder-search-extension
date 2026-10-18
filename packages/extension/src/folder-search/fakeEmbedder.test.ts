import { describe, expect, it } from 'vitest'

import { fakeEmbedText } from './fakeEmbedder'

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)

describe('fakeEmbedText', () => {
	it('is deterministic and unit-length', () => {
		const a = fakeEmbedText('invoice from acme', 256)
		expect(fakeEmbedText('invoice from acme', 256)).toEqual(a)
		expect(dot(a, a)).toBeCloseTo(1, 5)
	})

	it('ranks word-sharing text above unrelated text and ignores prompt scaffolding', () => {
		const q = fakeEmbedText('task: search result | query: acme invoice', 256)
		const related = fakeEmbedText('title: a.txt | text: Invoice from Acme for Q3', 256)
		const unrelated = fakeEmbedText('title: b.txt | text: hiking trip photos', 256)
		expect(dot(q, related)).toBeGreaterThan(dot(q, unrelated))
	})
})
