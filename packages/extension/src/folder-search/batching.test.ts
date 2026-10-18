import { describe, expect, it } from 'vitest'

import { MAX_BATCH_TOKENS, planBatches } from './batching'

const paddedCost = (lengths: number[], batch: number[]) =>
	batch.length * Math.max(...batch.map(i => lengths[i]!))

describe('planBatches', () => {
	it('keeps every batch within the padded-token budget and covers each item exactly once', () => {
		const lengths = Array.from({ length: 200 }, (_, i) => 20 + ((i * 97) % 1000))
		const batches = planBatches(lengths)
		for (const b of batches) expect(paddedCost(lengths, b)).toBeLessThanOrEqual(MAX_BATCH_TOKENS)
		expect(batches.flat().sort((a, b) => a - b)).toEqual(lengths.map((_, i) => i))
	})

	it('accounts for padding: one long item plus short ones is not judged by their sum', () => {
		// Sum is 1000 + 3*100 = 1300 (< budget), but padded it is 4 × 1000 = 4000 (> budget).
		const batches = planBatches([1000, 100, 100, 100], 2600)
		expect(batches).toHaveLength(2)
		for (const b of batches) expect(paddedCost([1000, 100, 100, 100], b)).toBeLessThanOrEqual(2600)
	})

	it('packs many short items together and puts an oversized item alone rather than dropping it', () => {
		expect(planBatches([10, 10, 10, 10])).toEqual([[0, 1, 2, 3]])
		expect(planBatches([5000, 10], 2600)).toEqual([[0], [1]])
	})

	it('handles empty input', () => {
		expect(planBatches([])).toEqual([])
	})
})
