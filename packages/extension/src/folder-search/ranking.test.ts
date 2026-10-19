import { describe, expect, it } from 'vitest'

import {
	type ChunkCandidate,
	MIN_CALIBRATED,
	VectorMatrix,
	blendedStats,
	calibrate,
	groupChunks,
	leadingSection,
	rrf,
	scoreStats,
	truncateAndNormalize,
} from './ranking'

const unit = (...v: number[]) => truncateAndNormalize(v, v.length)

describe('truncateAndNormalize', () => {
	it('re-normalizes after Matryoshka truncation', () => {
		const out = truncateAndNormalize([3, 4, 100, 100], 2)
		expect(Array.from(out)).toEqual([0.6, 0.8].map(x => expect.closeTo(x, 5)))
	})
})

describe('VectorMatrix', () => {
	it('finds the nearest vector, grows past its initial capacity, and honours the allow filter', () => {
		const m = new VectorMatrix(2, 2)
		m.add('x', unit(1, 0))
		m.add('y', unit(0, 1))
		m.add('xy', unit(1, 1))
		m.add('z', unit(-1, 0))
		expect(m.search(unit(1, 0.1), 2).map(h => h.id)).toEqual(['x', 'xy'])
		expect(m.search(unit(1, 0), 1, id => id !== 'x')[0]!.id).toBe('xy')
	})

	it('removes vectors and keeps ids aligned with data', () => {
		const m = new VectorMatrix(2)
		m.add('f1#0', unit(1, 0))
		m.add('f2#0', unit(0, 1))
		m.add('f1#1', unit(1, 1))
		expect(m.removeWhere(id => id.startsWith('f1#'))).toBe(2)
		expect(m.size).toBe(1)
		expect(m.search(unit(0, 1), 5)).toEqual([{ id: 'f2#0', score: expect.closeTo(1, 5) }])
	})

	it('rejects mismatched dimensions instead of returning garbage', () => {
		const m = new VectorMatrix(3)
		expect(() => m.add('a', unit(1, 0))).toThrow(/dims/)
		expect(() => m.scores(unit(1, 0))).toThrow(/dims/)
	})
})

describe('calibration', () => {
	it('trusts a large observed distribution over the prior, and the prior over a tiny one', () => {
		const big = blendedStats({ mean: 0.5, std: 0.05, n: 5000 }, 'text→text')
		expect(big.mean).toBeCloseTo(0.5, 1)
		const tiny = blendedStats({ mean: 0.9, std: 0, n: 1 }, 'text→text')
		expect(tiny.mean).toBeLessThan(0.45)
		expect(tiny.std).toBeGreaterThan(0.05)
	})

	it('puts equally-outstanding hits from different modalities on one scale', () => {
		const docs = { mean: 0.4, std: 0.1 }
		const imgs = { mean: 0.15, std: 0.05 }
		// 0.7 for text↔text and 0.3 for text↔image are both 3σ above their own mean.
		expect(calibrate(0.7, docs)).toBeCloseTo(calibrate(0.3, imgs), 5)
		expect(calibrate(0.7, docs)).toBeGreaterThan(MIN_CALIBRATED)
	})

	it('computes mean/std', () => {
		expect(scoreStats([1, 3])).toEqual({ mean: 2, std: 1, n: 2 })
		expect(scoreStats([])).toEqual({ mean: 0, std: 0, n: 0 })
	})
})

describe('rrf', () => {
	it('rewards agreement between lists', () => {
		const s = rrf([['a', 'b', 'c'], ['c', 'a']])
		expect(s.get('a')!).toBeGreaterThan(s.get('b')!)
		expect(s.get('a')!).toBeGreaterThan(s.get('c')!)
	})
})

describe('groupChunks', () => {
	const cand = (chunkId: string, fileId: string, extra: Partial<ChunkCandidate> = {}): ChunkCandidate => ({
		chunkId,
		fileId,
		text: chunkId,
		...extra,
	})

	it('collapses chunks to one entry per file using the best chunk', () => {
		const out = groupChunks([
			cand('a#0', 'a', { similarity: 0.5 }),
			cand('a#1', 'a', { similarity: 0.7 }),
			cand('b#0', 'b', { similarity: 0.6 }),
		])
		expect(out.map(g => g.fileId)).toEqual(['a', 'b'])
		expect(out[0]).toMatchObject({ bestSimilarity: 0.7, matchedChunks: 2 })
		expect(out[0]!.bestChunk.chunkId).toBe('a#1')
	})

	it('lets an exact keyword hit beat a slightly higher vector-only score', () => {
		const out = groupChunks([
			cand('vec#0', 'vec', { similarity: 0.62 }),
			cand('kw#0', 'kw', { similarity: 0.6, keyword: { chunkId: 'kw#0', score: 9, matchedTerms: ['inv-2024-0042'] } }),
		])
		expect(out[0]!.fileId).toBe('kw')
		expect(out[0]!.matchedTerms).toEqual(['inv-2024-0042'])
	})

	it('ignores filename hits for files that have no candidate chunk (name-only hits arrive as chunks)', () => {
		const out = groupChunks([cand('a#0', 'a', { similarity: 0.5 })], new Map([['named', ['budget']]]))
		expect(out.map(g => g.fileId)).toEqual(['a'])
	})

	it('boosts a file whose name matched', () => {
		const base = [cand('a#0', 'a', { similarity: 0.6 }), cand('b#0', 'b', { similarity: 0.6 })]
		const out = groupChunks(base, new Map([['b', ['budget']]]))
		expect(out[0]!.fileId).toBe('b')
		expect(out[0]!.filenameHit).toBe(true)
	})
})

describe('leadingSection', () => {
	it('follows the strongest calibrated hit, with exact-string queries favouring documents', () => {
		expect(leadingSection(5, 3, false, false)).toBe('media')
		expect(leadingSection(3, 5, false, false)).toBe('documents')
		expect(leadingSection(5, 3, true, true)).toBe('documents')
		expect(leadingSection(5, 3, true, false)).toBe('media')
		expect(leadingSection(null, null, false, false)).toBe('documents')
		expect(leadingSection(4, null, false, false)).toBe('media')
	})
})

describe('VectorMatrix.addIfAbsent', () => {
	it('ignores a replayed id and forgets ids that were removed', () => {
		const m = new VectorMatrix(2)
		expect(m.addIfAbsent('a', unit(1, 0))).toBe(true)
		expect(m.addIfAbsent('a', unit(0, 1))).toBe(false)
		expect(m.size).toBe(1)
		m.removeWhere(id => id === 'a')
		expect(m.has('a')).toBe(false)
		expect(m.addIfAbsent('a', unit(0, 1))).toBe(true)
	})
})
