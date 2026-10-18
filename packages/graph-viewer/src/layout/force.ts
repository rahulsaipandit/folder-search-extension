import type { GraphViewerData, LayoutNode } from '../types'

const ITERATIONS = 280
const MARGIN = 44

/**
 * Fruchterman-Reingold spring-embedder.
 *
 * Initial positions on a circle (deterministic - no Math.random).
 * Runs synchronously; suitable for graphs up to ~200 nodes.
 */
export function computeForceLayout(data: GraphViewerData, W = 800, H = 480): LayoutNode[] {
	const { entities, edges } = data
	const n = entities.length
	if (n === 0) return []
	if (n === 1) {
		return [{ ...entities[0]!, x: W / 2, y: H / 2, radius: 10, degree: 0 }]
	}

	// Ideal edge length based on graph density
	const k = Math.sqrt(((W - MARGIN * 2) * (H - MARGIN * 2)) / n) * 0.9

	// Degree map for node sizing
	const degree = new Map<string, number>()
	for (const e of edges) {
		degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
		degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
	}

	// Place nodes evenly on a circle to seed the layout deterministically
	const r0 = Math.min(W - MARGIN * 2, H - MARGIN * 2) * 0.32
	const pos = new Map<string, { x: number; y: number }>(
		entities.map((e, i) => [
			e.id,
			{
				x: W / 2 + r0 * Math.cos((2 * Math.PI * i) / n),
				y: H / 2 + r0 * Math.sin((2 * Math.PI * i) / n),
			},
		])
	)

	let temp = Math.min(W, H) * 0.12

	for (let iter = 0; iter < ITERATIONS; iter++) {
		const disp = new Map<string, { dx: number; dy: number }>(
			entities.map((e) => [e.id, { dx: 0, dy: 0 }])
		)

		// Repulsive forces - all pairs
		const ids = entities.map((e) => e.id)
		for (let i = 0; i < ids.length; i++) {
			const ai = ids[i]!
			const a = pos.get(ai)!
			const da = disp.get(ai)!
			for (let j = i + 1; j < ids.length; j++) {
				const bi = ids[j]!
				const b = pos.get(bi)!
				const db = disp.get(bi)!
				const dx = a.x - b.x
				const dy = a.y - b.y
				const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
				const f = (k * k) / dist
				const fx = (dx / dist) * f
				const fy = (dy / dist) * f
				da.dx += fx
				da.dy += fy
				db.dx -= fx
				db.dy -= fy
			}
		}

		// Attractive forces - edges
		for (const edge of edges) {
			const a = pos.get(edge.from)
			const b = pos.get(edge.to)
			const da = disp.get(edge.from)
			const db = disp.get(edge.to)
			if (!a || !b || !da || !db) continue
			const dx = a.x - b.x
			const dy = a.y - b.y
			const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
			const f = (dist * dist) / k
			const fx = (dx / dist) * f
			const fy = (dy / dist) * f
			da.dx -= fx
			da.dy -= fy
			db.dx += fx
			db.dy += fy
		}

		// Apply displacement with temperature cap and canvas bounds
		for (const id of ids) {
			const p = pos.get(id)!
			const d = disp.get(id)!
			const dlen = Math.sqrt(d.dx * d.dx + d.dy * d.dy) || 0.01
			const scale = Math.min(dlen, temp) / dlen
			p.x = Math.max(MARGIN, Math.min(W - MARGIN, p.x + d.dx * scale))
			p.y = Math.max(MARGIN, Math.min(H - MARGIN, p.y + d.dy * scale))
		}

		temp *= 0.975
	}

	// Re-center the result in the canvas
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity
	for (const p of pos.values()) {
		if (p.x < minX) minX = p.x
		if (p.x > maxX) maxX = p.x
		if (p.y < minY) minY = p.y
		if (p.y > maxY) maxY = p.y
	}
	const cx = (minX + maxX) / 2
	const cy = (minY + maxY) / 2
	const ox = W / 2 - cx
	const oy = H / 2 - cy
	for (const p of pos.values()) {
		p.x = Math.max(MARGIN, Math.min(W - MARGIN, p.x + ox))
		p.y = Math.max(MARGIN, Math.min(H - MARGIN, p.y + oy))
	}

	return entities.map((entity) => {
		const p = pos.get(entity.id)!
		const deg = degree.get(entity.id) ?? 0
		return {
			...entity,
			x: p.x,
			y: p.y,
			radius: Math.min(22, 7 + deg * 2.5),
			degree: deg,
		}
	})
}
