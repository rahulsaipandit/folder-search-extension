/**
 * In-memory search over the persisted index (design §6). Lives in the offscreen document, next to
 * the embedder. Vectors are mirrored into contiguous matrices per folder; chunk text and
 * thumbnails stay in IndexedDB and are fetched only for the few hits shown.
 */
import { gemma } from '@/browser-ml/gemma-embeddings'

import { buildQueryInput } from './chunker'
import {
	getChunk,
	getFiles,
	getPostings,
	scanChunks,
	scanImageVectors,
	scanMediaUnits,
} from './db'
import { unitFileOf, unitStartOf } from './unitIds'
import { looksExact, makeSnippet, queryTerms, scoreKeywords } from './keywords'
import {
	type ChunkCandidate,
	KEYWORD_ONLY_CALIBRATED,
	MIN_CALIBRATED,
	type Modality,
	VectorMatrix,
	blendedStats,
	calibrate,
	groupChunks,
	leadingSection,
	scoreStats,
} from './ranking'
import type {
	ChunkRecord,
	DocumentHit,
	FileRecord,
	ImageVectorRecord,
	MediaHit,
	MediaUnitRecord,
	SearchOptions,
	SearchResponse,
} from './types'

const DOC_K = 50
const PAGE_K = 20
const MEDIA_K = 80
const KEYWORD_K = 50
const MAX_DOC_RESULTS = 30
const MAX_MEDIA_RESULTS = 60

interface FolderIndex {
	dim: number
	chunks: VectorMatrix
	pages: VectorMatrix
	images: VectorMatrix
	units: VectorMatrix
	files: Map<string, FileRecord>
	/** primary fileId → byte-identical duplicates (design §11). */
	duplicates: Map<string, string[]>
}

export class SearchIndex {
	private folders = new Map<string, FolderIndex>()
	private loading = new Map<string, Promise<FolderIndex>>()
	private dim: number
	/** Bumped when cached data becomes invalid, so an in-flight load knows to start over. */
	private epoch = 0
	/** Index updates that arrived while a folder was loading; replayed in order once it finishes. */
	private pending = new Map<string, ((idx: FolderIndex) => void)[]>()

	constructor(dim: number) {
		this.dim = dim
	}

	/** Dimension change means different vectors; drop everything cached. */
	setDim(dim: number): void {
		if (dim !== this.dim) {
			this.dim = dim
			this.folders.clear()
			this.epoch++
		}
	}

	invalidate(folderId: string): void {
		this.folders.delete(folderId)
		this.epoch++
	}

	private async ensure(folderId: string): Promise<FolderIndex> {
		const cached = this.folders.get(folderId)
		if (cached) return cached
		let p = this.loading.get(folderId)
		if (!p) {
			p = this.load(folderId).finally(() => this.loading.delete(folderId))
			this.loading.set(folderId, p)
		}
		return p
	}

	private async load(folderId: string): Promise<FolderIndex> {
		for (;;) {
			const epoch = this.epoch
			// Start recording updates before reading, so rows written while we scan are never lost.
			this.pending.set(folderId, [])
			const idx: FolderIndex = {
				dim: this.dim,
				chunks: new VectorMatrix(this.dim),
				pages: new VectorMatrix(this.dim),
				images: new VectorMatrix(this.dim),
				units: new VectorMatrix(this.dim),
				files: new Map(),
				duplicates: new Map(),
			}
			try {
				for (const f of await getFiles(folderId)) this.trackFile(idx, f)
				await scanChunks(folderId, c => this.addChunkTo(idx, c))
				await scanImageVectors(folderId, v => this.addImageTo(idx, v))
				await scanMediaUnits(folderId, u => this.addUnitTo(idx, u))
			} catch (e) {
				this.pending.delete(folderId)
				throw e
			}
			// Invalidated mid-load (folder removed, dimension changed): what we read may be stale.
			if (epoch !== this.epoch) continue
			// Replay and publish in the same tick, so no update can fall between the two.
			for (const op of this.pending.get(folderId) ?? []) op(idx)
			this.pending.delete(folderId)
			this.folders.set(folderId, idx)
			return idx
		}
	}

	/** Applies an update now if the folder is loaded, queues it if a load is in flight, else drops it (the next load reads the DB). */
	private apply(folderId: string, op: (idx: FolderIndex) => void): void {
		const idx = this.folders.get(folderId)
		if (idx) op(idx)
		else this.pending.get(folderId)?.push(op)
	}

	// ── incremental updates from the indexer ───────────────────────────────────────────────
	private trackFile(idx: FolderIndex, f: FileRecord): void {
		idx.files.set(f.fileId, f)
		if (f.duplicateOf) {
			const list = idx.duplicates.get(f.duplicateOf) ?? []
			if (!list.includes(f.relPath)) list.push(f.relPath)
			idx.duplicates.set(f.duplicateOf, list)
		}
	}

	private addChunkTo(idx: FolderIndex, c: ChunkRecord): void {
		if (c.embedding.length !== idx.dim) return
		;(c.source === 'page-image' ? idx.pages : idx.chunks).addIfAbsent(c.chunkId, c.embedding)
	}
	private addImageTo(idx: FolderIndex, v: ImageVectorRecord): void {
		if (v.embedding.length === idx.dim) idx.images.addIfAbsent(v.fileId, v.embedding)
	}
	private addUnitTo(idx: FolderIndex, u: MediaUnitRecord): void {
		if (u.embedding.length === idx.dim) idx.units.addIfAbsent(u.unitId, u.embedding)
	}

	noteFile(f: FileRecord): void {
		this.apply(f.folderId, idx => this.trackFile(idx, f))
	}
	noteChunks(folderId: string, chunks: ChunkRecord[]): void {
		this.apply(folderId, idx => {
			for (const c of chunks) this.addChunkTo(idx, c)
		})
	}
	noteImage(v: ImageVectorRecord): void {
		this.apply(v.folderId, idx => this.addImageTo(idx, v))
	}
	noteUnits(folderId: string, units: MediaUnitRecord[]): void {
		this.apply(folderId, idx => {
			for (const u of units) this.addUnitTo(idx, u)
		})
	}
	forgetFile(folderId: string, fileId: string): void {
		this.apply(folderId, idx => this.forgetFileIn(idx, fileId))
	}
	private forgetFileIn(idx: FolderIndex, fileId: string): void {
		idx.chunks.removeWhere(id => chunkFileOf(id) === fileId)
		idx.pages.removeWhere(id => chunkFileOf(id) === fileId)
		idx.images.removeWhere(id => id === fileId)
		idx.units.removeWhere(id => unitFileOf(id) === fileId)
		const gone = idx.files.get(fileId)
		idx.files.delete(fileId)
		idx.duplicates.delete(fileId)
		if (gone?.duplicateOf) {
			const list = idx.duplicates.get(gone.duplicateOf)?.filter(p => p !== gone.relPath) ?? []
			if (list.length) idx.duplicates.set(gone.duplicateOf, list)
			else idx.duplicates.delete(gone.duplicateOf)
		}
	}

	// ── search ─────────────────────────────────────────────────────────────────────────────
	async search(query: string, opts: SearchOptions, partialIndex: boolean): Promise<SearchResponse> {
		const t0 = performance.now()
		const q = query.trim()
		const idx = await this.ensure(opts.folderId)
		const exactStyle = looksExact(q)
		const empty: SearchResponse = {
			query: q,
			media: [],
			documents: [],
			leading: 'documents',
			exactStyle,
			partialIndex,
			tookMs: 0,
		}
		if (!q) return empty

		const kinds = opts.kinds ?? 'all'
		const wantDocs = kinds === 'all' || kinds === 'documents'
		const wantImages = kinds === 'all' || kinds === 'images'
		const wantAv = kinds === 'all' || kinds === 'audio-video'
		const terms = queryTerms(q)

		const [qVec] = await gemma.embedTexts([buildQueryInput(q)], idx.dim)
		const inScope = (fileId: string) => {
			const f = idx.files.get(fileId)
			if (!f) return false
			return !opts.subfolder || f.relPath.startsWith(opts.subfolder.replace(/\/?$/, '/'))
		}

		const documents = wantDocs ? await this.searchDocuments(idx, opts, qVec!, terms, exactStyle, inScope) : []
		const media = [
			...(wantImages ? this.searchImages(idx, qVec!, inScope) : []),
			...(wantAv ? this.searchUnits(idx, qVec!, inScope) : []),
			...(wantImages || wantAv ? await this.nameMatchedMedia(idx, opts, terms, inScope, wantImages, wantAv) : []),
		]
		const mediaDeduped = dedupeBest(media).sort((a, b) => b.calibrated - a.calibrated).slice(0, MAX_MEDIA_RESULTS)

		const leading = leadingSection(
			mediaDeduped[0]?.calibrated ?? null,
			documents[0]?.calibrated ?? null,
			exactStyle,
			documents.some(d => d.matchedTerms.length > 0)
		)
		return {
			...empty,
			media: mediaDeduped,
			documents,
			leading,
			tookMs: Math.round(performance.now() - t0),
		}
	}

	private async searchDocuments(
		idx: FolderIndex,
		opts: SearchOptions,
		qVec: Float32Array,
		terms: string[],
		exactStyle: boolean,
		inScope: (id: string) => boolean
	): Promise<DocumentHit[]> {
		const candidates = new Map<string, ChunkCandidate>()
		const raw = new Map<string, number>()
		const pageImageIds = new Set<string>()

		const addVector = async (m: VectorMatrix, modality: Modality, k: number) => {
			if (!m.size) return
			const all = m.scores(qVec, id => inScope(chunkFileOf(id)))
			if (!all.length) return
			const stats = blendedStats(scoreStats(all.map(s => s.score)), modality)
			const top = all.sort((a, b) => b.score - a.score).slice(0, k)
			for (const h of top) {
				const id = m.ids[h.index]!
				const z = calibrate(h.score, stats)
				if (z < MIN_CALIBRATED) continue
				raw.set(id, h.score)
				const rec = await getChunk(id)
				if (!rec) continue
				if (rec.source === 'page-image') pageImageIds.add(id)
				candidates.set(id, { chunkId: id, fileId: rec.fileId, page: rec.page, text: rec.text, similarity: z })
			}
		}
		await addVector(idx.chunks, 'text→text', DOC_K)
		await addVector(idx.pages, 'text→image', PAGE_K)

		const kwHits = terms.length
			? scoreKeywords(terms, await getPostings(opts.folderId, terms), { n: Math.max(1, idx.chunks.size) }).slice(0, KEYWORD_K)
			: []
		const filenameHits = new Map<string, string[]>()
		for (const h of kwHits) {
			const isName = h.chunkId.endsWith('#name')
			const fileId = chunkFileOf(h.chunkId)
			const file = idx.files.get(fileId)
			if (!file || !inScope(fileId) || file.kind !== 'document') continue
			if (isName) {
				filenameHits.set(fileId, h.matchedTerms)
				const prior = candidates.get(h.chunkId)
				candidates.set(h.chunkId, { ...(prior ?? { chunkId: h.chunkId, fileId, text: file.relPath }), keyword: h })
				continue
			}
			const prior = candidates.get(h.chunkId)
			if (prior) {
				prior.keyword = h
			} else {
				const rec = await getChunk(h.chunkId)
				if (rec) candidates.set(h.chunkId, { chunkId: h.chunkId, fileId, page: rec.page, text: rec.text, keyword: h })
			}
		}

		const grouped = groupChunks([...candidates.values()], filenameHits)
		const out: DocumentHit[] = []
		for (const g of grouped) {
			const file = idx.files.get(g.fileId)
			if (!file) continue
			const sim = g.bestSimilarity
			const keywordEvidence = g.matchedTerms.length > 0
			// Keyword evidence is strong on its own, and exact-style queries trust it fully.
			const calibrated =
				sim !== null ? (keywordEvidence && exactStyle ? Math.max(sim, KEYWORD_ONLY_CALIBRATED) : sim) : KEYWORD_ONLY_CALIBRATED
			const isPageImage = pageImageIds.has(g.bestChunk.chunkId)
			out.push({
				folderId: file.folderId,
				fileId: g.fileId,
				relPath: file.relPath,
				score: raw.get(g.bestChunk.chunkId) ?? 0,
				calibrated,
				snippet: isPageImage ? '' : makeSnippet(g.bestChunk.text, [...g.matchedTerms, ...terms]),
				excerpt: isPageImage ? '' : g.bestChunk.text.slice(0, 1500),
				page: g.bestChunk.page,
				matchedTerms: g.matchedTerms,
				matchedChunks: g.matchedChunks,
				hasPageThumbnail: isPageImage,
			})
			if (out.length >= MAX_DOC_RESULTS) break
		}
		return out
	}

	private searchImages(idx: FolderIndex, qVec: Float32Array, inScope: (id: string) => boolean): MediaHit[] {
		if (!idx.images.size) return []
		const all = idx.images.scores(qVec, inScope)
		if (!all.length) return []
		const stats = blendedStats(scoreStats(all.map(s => s.score)), 'text→image')
		return all
			.sort((a, b) => b.score - a.score)
			.slice(0, MEDIA_K)
			.map(h => ({ h, z: calibrate(h.score, stats) }))
			.filter(x => x.z >= MIN_CALIBRATED)
			.map(({ h, z }) => this.imageHit(idx, idx.images.ids[h.index]!, h.score, z))
	}

	private imageHit(idx: FolderIndex, fileId: string, score: number, calibrated: number): MediaHit {
		const f = idx.files.get(fileId)!
		return {
			folderId: f.folderId,
			fileId,
			relPath: f.relPath,
			kind: 'image',
			score,
			calibrated,
			duplicates: idx.duplicates.get(fileId),
		}
	}

	private searchUnits(
		idx: FolderIndex,
		qVec: Float32Array,
		inScope: (id: string) => boolean
	): MediaHit[] {
		if (!idx.units.size) return []
		const all = idx.units.scores(qVec, id => inScope(unitFileOf(id)))
		if (!all.length) return []
		const stats = blendedStats(scoreStats(all.map(s => s.score)), 'text→media')
		const hits: MediaHit[] = []
		for (const h of all.sort((a, b) => b.score - a.score).slice(0, MEDIA_K)) {
			const z = calibrate(h.score, stats)
			if (z < MIN_CALIBRATED) continue
			const unitId = idx.units.ids[h.index]!
			const f = idx.files.get(unitFileOf(unitId))
			if (!f) continue
			const startSec = unitStartOf(unitId)
			hits.push({
				folderId: f.folderId,
				fileId: f.fileId,
				relPath: f.relPath,
				kind: f.kind === 'audio' ? 'audio' : 'video',
				score: h.score,
				calibrated: z,
				startSec,
				duplicates: idx.duplicates.get(f.fileId),
			})
		}
		return hits
	}

	/** Media whose file *name* matches a query term, so "IMG_4412" finds the photo. */
	private async nameMatchedMedia(
		idx: FolderIndex,
		opts: SearchOptions,
		terms: string[],
		inScope: (id: string) => boolean,
		wantImages: boolean,
		wantAv: boolean
	): Promise<MediaHit[]> {
		if (!terms.length) return []
		const postings = await getPostings(opts.folderId, terms)
		const out: MediaHit[] = []
		for (const hit of scoreKeywords(terms, postings, { n: Math.max(1, idx.chunks.size) }).slice(0, KEYWORD_K)) {
			if (!hit.chunkId.endsWith('#name')) continue
			const f = idx.files.get(hit.chunkId.slice(0, -'#name'.length))
			if (!f || !inScope(f.fileId)) continue
			if (!((f.kind === 'image' && wantImages) || ((f.kind === 'audio' || f.kind === 'video') && wantAv))) continue
			out.push({
				folderId: f.folderId,
				fileId: f.fileId,
				relPath: f.relPath,
				kind: f.kind as 'image' | 'audio' | 'video',
				score: 0,
				calibrated: KEYWORD_ONLY_CALIBRATED,
				duplicates: idx.duplicates.get(f.fileId),
			})
		}
		return out
	}

	/** Image-to-image search from an indexed image's own vector ("Find similar", design §4A.2). */
	async similar(opts: SearchOptions, fileId: string): Promise<MediaHit[]> {
		const idx = await this.ensure(opts.folderId)
		const vec = idx.images.getVector(fileId)
		if (!vec) throw new Error('This image has no stored vector. It may still be indexing.')
		const all = idx.images.scores(vec, id => id !== fileId)
		const stats = blendedStats(scoreStats(all.map(s => s.score)), 'image→image')
		return all
			.sort((a, b) => b.score - a.score)
			.slice(0, MEDIA_K)
			.map(h => ({ h, z: calibrate(h.score, stats) }))
			.filter(x => x.z >= MIN_CALIBRATED)
			.map(({ h, z }) => this.imageHit(idx, idx.images.ids[h.index]!, h.score, z))
	}

	async stats(folderId: string): Promise<{ chunks: number; pages: number; images: number; units: number }> {
		const idx = await this.ensure(folderId)
		return { chunks: idx.chunks.size, pages: idx.pages.size, images: idx.images.size, units: idx.units.size }
	}
}

/** Chunk ids are `${fileId}#${idx}`, `${fileId}#p${page}` or `${fileId}#name`; file ids may contain '#'. */
const chunkFileOf = (id: string) => id.slice(0, id.lastIndexOf('#'))

function dedupeBest(hits: MediaHit[]): MediaHit[] {
	const best = new Map<string, MediaHit>()
	for (const h of hits) {
		const cur = best.get(h.fileId)
		if (!cur || h.calibrated > cur.calibrated) best.set(h.fileId, h)
	}
	return [...best.values()]
}
