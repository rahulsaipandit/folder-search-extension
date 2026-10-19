/** Pure layout for the glass wall. No DOM or GL, so it is unit-tested. */

export interface Tile {
	x: number
	y: number
	w: number
	h: number
}

export interface WallLayout {
	tiles: Tile[]
	/** Total content height in px (0 when there are no tiles). */
	height: number
}

/** Extreme strips and panoramas would make a tile unusable; clamp the shape, not the image. */
const MIN_ASPECT = 0.5
const MAX_ASPECT = 3

/** Target height of a row of tiles: a little taller on the wide full-tab page than in the side panel. */
export function targetRowHeight(width: number): number {
	return width < 600 ? 140 : 200
}

/**
 * Justified rows, like the EmbeddingGemma demo: every row has one height, a tile's width is that
 * height times its aspect ratio, and rows are balanced so each fills the full width. So photos and
 * videos in a row are the same height, and a wall of mixed shapes still reads as evenly sized.
 *
 * The row count is chosen so rows come out near `rowHeight`; items are then split into that many
 * contiguous rows with similar total width. A row that would be taller than `maxRowHeight` (few
 * items in a wide window) is capped and left-aligned instead of being blown up.
 */
export function justifiedLayout(
	aspects: number[],
	width: number,
	gap: number,
	rowHeight: number,
	maxRowHeight = rowHeight * 1.5
): WallLayout {
	if (!aspects.length || width <= 0) return { tiles: [], height: 0 }
	const n = aspects.length
	const a = aspects.map(v => Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, Number.isFinite(v) && v > 0 ? v : 4 / 3)))
	// A gap counts as extra width in the balancing, so rows of many small tiles are not over-filled.
	const weight = a.map(v => v + gap / rowHeight)
	const totalWeight = weight.reduce((s, v) => s + v, 0)
	const rows = Math.max(1, Math.min(n, Math.round((totalWeight * rowHeight) / width)))

	const tiles: Tile[] = []
	let start = 0
	let remaining = totalWeight
	let y = 0
	for (let r = 0; r < rows; r++) {
		const left = rows - r
		let end = n
		if (left > 1) {
			// Take items while that brings the row closer to an even share of what is left.
			const ideal = remaining / left
			const latest = n - left + 1 // leave at least one item for every later row
			let sum = weight[start]!
			end = start + 1
			while (end < latest && Math.abs(sum + weight[end]! - ideal) < Math.abs(sum - ideal)) sum += weight[end++]!
		}
		const count = end - start
		const sumAspect = a.slice(start, end).reduce((s, v) => s + v, 0)
		const h = Math.min((width - gap * (count - 1)) / sumAspect, maxRowHeight)
		let x = 0
		for (let i = start; i < end; i++) {
			tiles.push({ x, y, w: a[i]! * h, h })
			x += a[i]! * h + gap
		}
		for (let i = start; i < end; i++) remaining -= weight[i]!
		y += h + gap
		start = end
	}
	return { tiles, height: y - gap }
}

/** Indices of tiles that intersect the vertical band [top, bottom], in layout order. */
export function tilesInBand(tiles: Tile[], top: number, bottom: number): number[] {
	const out: number[] = []
	for (let i = 0; i < tiles.length; i++) {
		const t = tiles[i]!
		if (t.y + t.h >= top && t.y <= bottom) out.push(i)
	}
	return out
}
