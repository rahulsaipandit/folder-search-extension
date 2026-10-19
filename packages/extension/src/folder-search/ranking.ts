import type { KeywordHit } from './keywords'

/**
 * Brute-force similarity search over unit-normalized vectors stored contiguously. Fine up to ~50k
 * vectors on-device (design §3.4); the whole score distribution is returned so callers can
 * calibrate against it (§6.2).
 */
export class VectorMatrix {
	readonly dim: number
	private data: Float32Array
	private count = 0
	readonly ids: string[] = []

	constructor(dim: number, capacity = 1024) {
		this.dim = dim
		this.data = new Float32Array(dim * capacity)
	}

	get size(): number {
		return this.count
	}

	private idSet = new Set<string>()

	has(id: string): boolean {
		return this.idSet.has(id)
	}

	/** Adds the vector unless `id` is already present (updates may be replayed). Returns whether it was added. */
	addIfAbsent(id: string, vec: Float32Array): boolean {
		if (this.idSet.has(id)) return false
		this.add(id, vec)
		return true
	}

	add(id: string, vec: Float32Array): void {
		if (vec.length !== this.dim) throw new Error(`Vector has ${vec.length} dims, index expects ${this.dim}`)
		if ((this.count + 1) * this.dim > this.data.length) {
			const bigger = new Float32Array(this.data.length * 2)
			bigger.set(this.data)
			this.data = bigger
		}
		this.data.set(vec, this.count * this.dim)
		this.ids.push(id)
		this.idSet.add(id)
		this.count++
	}

	/** Removes every vector whose id satisfies `pred`, compacting in place. */
	removeWhere(pred: (id: string) => boolean): number {
		let w = 0
		const keptIds: string[] = []
		for (let r = 0; r < this.count; r++) {
			if (pred(this.ids[r]!)) continue
			if (w !== r) this.data.copyWithin(w * this.dim, r * this.dim, (r + 1) * this.dim)
			keptIds.push(this.ids[r]!)
			w++
		}
		const removed = this.count - w
		this.ids.length = 0
		this.ids.push(...keptIds)
		this.idSet = new Set(keptIds)
		this.count = w
		return removed
	}

	/** Dot products of `query` against every vector, optionally restricted by `allow`. */
	scores(query: Float32Array, allow?: (id: string) => boolean): { index: number; score: number }[] {
		if (query.length !== this.dim) throw new Error(`Query has ${query.length} dims, index expects ${this.dim}`)
		const out: { index: number; score: number }[] = []
		const d = this.dim
		for (let i = 0; i < this.count; i++) {
			if (allow && !allow(this.ids[i]!)) continue
			let s = 0
			const base = i * d
			for (let j = 0; j < d; j++) s += this.data[base + j]! * query[j]!
			out.push({ index: i, score: s })
		}
		return out
	}

	search(query: Float32Array, k: number, allow?: (id: string) => boolean): ScoredId[] {
		return topK(this.scores(query, allow), k).map(h => ({ id: this.ids[h.index]!, score: h.score }))
	}

	getVector(id: string): Float32Array | null {
		const i = this.ids.indexOf(id)
		return i === -1 ? null : this.data.slice(i * this.dim, (i + 1) * this.dim)
	}
}

export interface ScoredId {
	id: string
	score: number
}

export function topK<T extends { score: number }>(items: T[], k: number): T[] {
	return items.sort((a, b) => b.score - a.score).slice(0, k)
}

/** Truncates to the first `dim` components and re-normalizes (Matryoshka, design §3.2). */
export function truncateAndNormalize(vec: ArrayLike<number>, dim: number): Float32Array {
	const out = new Float32Array(dim)
	let norm = 0
	for (let i = 0; i < dim; i++) {
		const v = vec[i] ?? 0
		out[i] = v
		norm += v * v
	}
	norm = Math.sqrt(norm) || 1
	for (let i = 0; i < dim; i++) out[i]! /= norm
	return out
}

// ── Calibration (design §6.2) ───────────────────────────────────────────────────────────────

export interface ScoreStats {
	mean: number
	std: number
	n: number
}

export function scoreStats(scores: number[]): ScoreStats {
	const n = scores.length
	if (!n) return { mean: 0, std: 0, n: 0 }
	let sum = 0
	for (const s of scores) sum += s
	const mean = sum / n
	let v = 0
	for (const s of scores) v += (s - mean) ** 2
	return { mean, std: Math.sqrt(v / n), n }
}

/**
 * Starting points for each (query-modality → candidate-modality) similarity distribution. These are
 * priors, not measurements: they only matter for tiny indexes, and must be tuned on a labeled
 * sample (design §6.2, §13). Real distributions take over as the index grows.
 */
export const PRIOR_STATS = {
	'text→text': { mean: 0.4, std: 0.1 },
	'text→image': { mean: 0.15, std: 0.06 },
	'text→media': { mean: 0.15, std: 0.06 },
	'image→image': { mean: 0.35, std: 0.12 },
} as const

export type Modality = keyof typeof PRIOR_STATS

const PRIOR_WEIGHT = 30

/** Shrinks the observed distribution toward the prior by `PRIOR_WEIGHT` pseudo-observations. */
export function blendedStats(observed: ScoreStats, modality: Modality): { mean: number; std: number } {
	const prior = PRIOR_STATS[modality]
	const w = observed.n / (observed.n + PRIOR_WEIGHT)
	const mean = w * observed.mean + (1 - w) * prior.mean
	const std = Math.max(0.02, w * observed.std + (1 - w) * prior.std)
	return { mean, std }
}

export function calibrate(score: number, stats: { mean: number; std: number }): number {
	return (score - stats.mean) / stats.std
}

/** Hits below this many standard deviations above the mean are not shown. */
export const MIN_CALIBRATED = 2.5

// ── Fusion and grouping ─────────────────────────────────────────────────────────────────────

const RRF_K = 60

/** Reciprocal-rank fusion of ranked id lists. */
export function rrf(lists: string[][]): Map<string, number> {
	const out = new Map<string, number>()
	for (const list of lists) {
		list.forEach((id, rank) => out.set(id, (out.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
	}
	return out
}

export interface ChunkCandidate {
	chunkId: string
	fileId: string
	page?: number
	text: string
	/** Any comparable similarity; the search layer passes calibrated z-scores so modalities mix. */
	similarity?: number
	/** BM25-style score, when the keyword search returned this chunk. */
	keyword?: KeywordHit
}

export interface GroupedDocument {
	fileId: string
	fused: number
	bestSimilarity: number | null
	bestChunk: ChunkCandidate
	matchedChunks: number
	matchedTerms: string[]
	filenameHit: boolean
}

/**
 * Collapses chunk candidates to one entry per file (design §6.3): file score is the best chunk's
 * fused score, plus a damped contribution from further matching chunks and a boost for a
 * file-name keyword hit. Rank fusion happens at chunk level.
 */
export function groupChunks(
	candidates: ChunkCandidate[],
	filenameHits = new Map<string, string[]>()
): GroupedDocument[] {
	const vecRank = candidates
		.filter(c => c.similarity !== undefined)
		.sort((a, b) => b.similarity! - a.similarity!)
		.map(c => c.chunkId)
	const kwRank = candidates
		.filter(c => c.keyword)
		.sort((a, b) => b.keyword!.score - a.keyword!.score)
		.map(c => c.chunkId)
	const fused = rrf([vecRank, kwRank])

	const byFile = new Map<string, ChunkCandidate[]>()
	for (const c of candidates) {
		const arr = byFile.get(c.fileId) ?? []
		arr.push(c)
		byFile.set(c.fileId, arr)
	}

	const out: GroupedDocument[] = []
	for (const [fileId, chunks] of byFile) {
		const scored = chunks
			.map(c => ({ c, f: fused.get(c.chunkId) ?? 0 }))
			.sort((a, b) => b.f - a.f)
		const best = scored[0]!
		const extra = scored.slice(1, 3).reduce((n, s) => n + s.f, 0) * 0.15
		const nameTerms = filenameHits.get(fileId) ?? []
		const filenameBoost = nameTerms.length ? 1 / (RRF_K + 1) : 0
		const sims = chunks.map(c => c.similarity).filter((v): v is number => v !== undefined)
		out.push({
			fileId,
			fused: best.f + extra + filenameBoost,
			bestSimilarity: sims.length ? Math.max(...sims) : null,
			bestChunk: best.c,
			matchedChunks: chunks.length,
			matchedTerms: [...new Set([...chunks.flatMap(c => c.keyword?.matchedTerms ?? []), ...nameTerms])],
			filenameHit: nameTerms.length > 0,
		})
	}
	return out.sort((a, b) => b.fused - a.fused)
}

/**
 * Calibrated score for a document that matched by keyword only (no vector evidence). A keyword
 * match on a distinctive term is strong evidence on its own, so it clears the display threshold.
 */
export const KEYWORD_ONLY_CALIBRATED = MIN_CALIBRATED + 1.5

export function leadingSection(
	topMedia: number | null,
	topDocs: number | null,
	exactStyle: boolean,
	hasKeywordDoc: boolean
): 'media' | 'documents' {
	if (exactStyle && hasKeywordDoc) return 'documents'
	if (topMedia === null) return 'documents'
	if (topDocs === null) return 'media'
	return topMedia > topDocs ? 'media' : 'documents'
}
