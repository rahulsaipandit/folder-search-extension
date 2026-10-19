import { describe, expect, it } from 'vitest'

import { LayerPool } from './layerPool'

const none = new Set<number>()

describe('LayerPool', () => {
	it('hands out free layers first, one per tile', () => {
		const pool = new LayerPool(3)
		pool.reset(10)
		const a = pool.take(0, none)!
		const b = pool.take(1, none)!
		expect(a.layer).not.toBe(b.layer)
		expect(pool.layerOf(0)).toBe(a.layer)
		expect(pool.layerOf(1)).toBe(b.layer)
		expect(pool.needsLoad(0)).toBe(false)
		expect(pool.needsLoad(5)).toBe(true)
	})

	it('takes back the least recently drawn layer whose tile has left the viewport', () => {
		const pool = new LayerPool(2)
		pool.reset(10)
		pool.take(0, none)
		pool.take(1, none)
		pool.touch(0, 5)
		pool.touch(1, 9)
		const lease = pool.take(2, new Set([2]))! // tiles 0 and 1 are no longer near
		expect(pool.layerOf(0)).toBe(-1) // older one was evicted
		expect(pool.layerOf(1)).not.toBe(-1)
		expect(pool.layerOf(2)).toBe(lease.layer)
		expect(pool.needsLoad(0)).toBe(true) // it can be loaded again when it returns
	})

	it('never evicts a tile that is near the viewport', () => {
		const pool = new LayerPool(2)
		pool.reset(10)
		pool.take(0, none)
		pool.take(1, none)
		expect(pool.take(2, new Set([0, 1, 2]))).toBeNull()
		expect(pool.layerOf(0)).not.toBe(-1)
		expect(pool.layerOf(1)).not.toBe(-1)
	})

	it('discards a load that finishes after its layer was given to another tile', () => {
		const pool = new LayerPool(1)
		pool.reset(10)
		const slow = pool.take(0, none)!
		const next = pool.take(1, new Set([1]))! // tile 0 left; its layer is re-used
		expect(pool.isCurrent(slow)).toBe(false)
		expect(pool.finish(slow)).toBe(false)
		expect(pool.isReady(1)).toBe(false) // not poisoned by the stale finish
		expect(pool.finish(next)).toBe(true)
		expect(pool.isReady(1)).toBe(true)
	})

	it('discards loads that were in flight when the pool was reset', () => {
		const pool = new LayerPool(2)
		pool.reset(4)
		const lease = pool.take(0, none)!
		pool.reset(4)
		expect(pool.finish(lease)).toBe(false)
		expect(pool.layerOf(0)).toBe(-1)
	})

	it('does not retry a tile that has no picture, but frees its layer', () => {
		const pool = new LayerPool(1)
		pool.reset(4)
		const lease = pool.take(0, none)!
		pool.abandon(0, lease, true)
		expect(pool.layerOf(0)).toBe(-1)
		expect(pool.needsLoad(0)).toBe(false)
		expect(pool.take(1, none)).not.toBeNull() // the layer is free again
	})

	it('lets a failed (not missing) load be retried, and ignores a stale abandon', () => {
		const pool = new LayerPool(1)
		pool.reset(4)
		const lease = pool.take(0, none)!
		pool.abandon(0, lease, false)
		expect(pool.needsLoad(0)).toBe(true)
		const again = pool.take(1, none)!
		pool.abandon(0, lease, true) // old lease: must not free tile 1's layer or mark tile 0 missing
		expect(pool.layerOf(1)).toBe(again.layer)
		expect(pool.needsLoad(0)).toBe(true)
	})

	it('reports a tile as ready only after its picture is uploaded', () => {
		const pool = new LayerPool(2)
		pool.reset(2)
		const lease = pool.take(0, none)!
		expect(pool.isReady(0)).toBe(false)
		pool.finish(lease)
		expect(pool.isReady(0)).toBe(true)
		expect(pool.isReady(1)).toBe(false)
	})
})
