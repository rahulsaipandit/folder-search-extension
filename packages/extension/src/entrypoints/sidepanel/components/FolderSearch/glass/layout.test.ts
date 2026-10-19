import { describe, expect, it } from 'vitest'

import { justifiedLayout, targetRowHeight, tilesInBand } from './layout'

const GAP = 8

/** Tiles grouped by row (same y). */
function rowsOf(tiles: { x: number; y: number; w: number; h: number }[]) {
	const byY = new Map<number, typeof tiles>()
	for (const t of tiles) byY.set(t.y, [...(byY.get(t.y) ?? []), t])
	return [...byY.values()]
}

describe('targetRowHeight', () => {
	it('is taller on the wide tab page than in the side panel', () => {
		expect(targetRowHeight(380)).toBeLessThan(targetRowHeight(1400))
	})
})

describe('justifiedLayout', () => {
	const aspects = Array.from({ length: 24 }, (_, i) => [1.5, 0.75, 1, 1.33, 0.66, 1.78][i % 6]!)

	it('gives every tile in a row the same height, and fills the width exactly', () => {
		const { tiles } = justifiedLayout(aspects, 1000, GAP, 150)
		for (const row of rowsOf(tiles)) {
			expect(new Set(row.map(t => t.h.toFixed(6))).size).toBe(1)
			const last = row[row.length - 1]!
			expect(last.x + last.w).toBeCloseTo(1000, 3)
		}
	})

	it('preserves every aspect ratio and the order of the items', () => {
		const { tiles } = justifiedLayout(aspects, 1000, GAP, 150)
		expect(tiles).toHaveLength(aspects.length)
		tiles.forEach((t, i) => expect(t.w / t.h).toBeCloseTo(aspects[i]!, 5))
		// reading order: row by row, left to right
		for (let i = 1; i < tiles.length; i++) {
			const p = tiles[i - 1]!
			const t = tiles[i]!
			expect(t.y > p.y || (t.y === p.y && t.x > p.x)).toBe(true)
		}
	})

	it('never overlaps two tiles and keeps rows near the target height', () => {
		const { tiles } = justifiedLayout(aspects, 700, GAP, 150)
		for (let i = 0; i < tiles.length; i++) {
			for (let j = i + 1; j < tiles.length; j++) {
				const a = tiles[i]!
				const b = tiles[j]!
				const apart = a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6
				expect(apart).toBe(true)
			}
		}
		for (const row of rowsOf(tiles)) {
			expect(row[0]!.h).toBeGreaterThan(150 * 0.55)
			expect(row[0]!.h).toBeLessThan(150 * 1.5 + 1e-6)
		}
	})

	it('balances rows instead of leaving a short last row', () => {
		const same = Array.from({ length: 12 }, () => 1.5)
		const counts = rowsOf(justifiedLayout(same, 1000, GAP, 150).tiles).map(r => r.length)
		expect(counts).toEqual([4, 4, 4])
	})

	it('caps a lone row instead of blowing it up in a wide window, and left-aligns it', () => {
		const { tiles, height } = justifiedLayout([1.2, 1.2, 1.2], 1400, GAP, 200)
		expect(height).toBeLessThanOrEqual(300 + 1e-6)
		expect(tiles[0]!.x).toBe(0)
		const last = tiles[2]!
		expect(last.x + last.w).toBeLessThan(1400)
	})

	it('reports the height without a trailing gap', () => {
		const { tiles, height } = justifiedLayout(aspects, 700, GAP, 150)
		const bottom = Math.max(...tiles.map(t => t.y + t.h))
		expect(height).toBeCloseTo(bottom)
	})

	it('survives bad aspect ratios and degenerate input', () => {
		const { tiles } = justifiedLayout([100, 0.001, 0, Number.NaN, 1], 400, GAP, 140)
		for (const t of tiles) {
			expect(Number.isFinite(t.w) && Number.isFinite(t.h) && t.w > 0 && t.h > 0).toBe(true)
			expect(t.w / t.h).toBeLessThanOrEqual(3 + 1e-6)
			expect(t.w / t.h).toBeGreaterThanOrEqual(0.5 - 1e-6)
		}
		expect(justifiedLayout([], 400, GAP, 140)).toEqual({ tiles: [], height: 0 })
		expect(justifiedLayout([1], 0, GAP, 140)).toEqual({ tiles: [], height: 0 })
		expect(justifiedLayout([1], 400, GAP, 140).tiles).toHaveLength(1)
	})
})

describe('tilesInBand', () => {
	it('returns only tiles that intersect the band', () => {
		const { tiles } = justifiedLayout(Array(6).fill(1), 160, GAP, 150)
		expect(tilesInBand(tiles, 0, tiles[0]!.h - 1)).toEqual([0])
		expect(tilesInBand(tiles, 1e9, 2e9)).toEqual([])
	})
})
