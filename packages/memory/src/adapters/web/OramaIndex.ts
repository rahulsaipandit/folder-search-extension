import { type AnyOrama, type SearchParams, create, insert, remove, search } from '@orama/orama'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IndexResult, IndexSearchOptions, MemoryEntry, NodeKind, QueryIntent, ScoredCandidate } from '../../types'
import type { IEmbedder } from './OffscreenEmbedder'

/**
 * Orama-backed hybrid search index for web and browser extension environments.
 *
 * Orama is an in-process, zero-dependency vector + BM25 search engine.
 * No server, no network calls - runs entirely in the browser.
 *
 * Hybrid retrieval: vector (embedding) + BM25 (keyword), fused with RRF.
 *
 * Phase 2.1: True vector embedding support added via constructor-injected EmbeddingFunction. 
 * When no embeddingFn is supplied the index gracefully degrades to BM25-only regardless of the requested search mode.
 *
 * Phase 2.2 (GA→CB migration): GA ContextBuilder intent patterns ported in.
 * detectQueryIntents() classifies queries into up to 6 GA semantic intents 
 * (residence, employment, temporal, preference, identity, general) which are then overlaid on top of CB's 4 signal-weight presets.  
 * After RRF fusion each result is adjusted by:
 *   - content boost   (+0.10 … +0.30 per matching intent signal)
 *   - subject boost   (+0.20 if extracted proper noun appears in entry)
 *   - contradiction   (−0.15 for entries firing a counter-signal)
 */

// ── Embedding ─────────────────────────────────────────────────────────────────

/** Provider-agnostic embedding function type.  Injected - never hardcoded. */
export type EmbeddingFunction = (text: string) => Promise<number[]>

/** Construction-time configuration for OramaIndex. */
export interface OramaIndexConfig {
	/** Optional embedding function. When omitted, all modes fall back to BM25. */
	embeddingFn?: EmbeddingFunction
	/**
	 * Embedding dimensionality.
	 * Web/browser callers typically use 384 (MiniLM-L6-v2 / Transformers.js).
	 * Native callers use 768 (llama.rn sentence encoder).
	 * Defaults to 384 to match the web-first deployment target of this adapter.
	 */
	dimensions?: number
}

// ── Document shape stored in Orama ───────────────────────────────────────────

interface OramaDocument {
	id: string
	title: string
	content: string
	type: string
	tags: string
	entities: string
	salience: number
	createdAt: string
	// Phase 4 - adaptive retrieval signals
	confidence: number // 0–1, used by reliability signal
	sourceCount: number // number of sourceIds, used by reliability signal
	// Phase 2.1 - vector field; only present when embeddingFn is provided
	vector?: number[]
}

// ── OramaIndex ────────────────────────────────────────────────────────────────

export class OramaIndex implements IMemoryIndex {
	private db: AnyOrama | null = null
	private embeddingFn: EmbeddingFunction | null
	private dimensions: number

	constructor(config: OramaIndexConfig = {}) {
		this.embeddingFn = config.embeddingFn ?? null
		this.dimensions = config.dimensions ?? 384
	}

	async initialize(): Promise<void> {
		if (this.db) return

		const schema: Record<string, unknown> = {
			id: 'string',
			title: 'string',
			content: 'string',
			type: 'string',
			tags: 'string',
			entities: 'string',
			salience: 'number',
			createdAt: 'string',
			confidence: 'number',
			sourceCount: 'number',
		}

		// Only include the vector field when we have an embedding function - Orama
		// requires the schema to declare vector dimensions upfront.
		if (this.embeddingFn) {
			schema['vector'] = `vector[${this.dimensions}]`
		}

		this.db = create({ schema } as any)
	}

	private ensureDb(): AnyOrama {
		if (!this.db) throw new Error('[OramaIndex] Not initialized. Call initialize() first.')
		return this.db
	}

	async index(entry: MemoryEntry): Promise<void> {
		const db = this.ensureDb()

		// Remove stale version first (Orama doesn't support upsert natively)
		try {
			await remove(db, entry.id)
		} catch {
			// Fine - entry may not exist yet
		}

		const doc = await this.toOramaDoc(entry)
		await insert(db, doc as any)
	}

	async indexMany(entries: MemoryEntry[]): Promise<void> {
		// Generate embeddings in parallel for the entire batch when possible, then
		// insert sequentially (Orama insert is synchronous under the hood).
		if (this.embeddingFn) {
			const embeddingFn = this.embeddingFn
			const embeddings = await Promise.all(
				entries.map((e) => embeddingFn(e.content ?? e.title ?? ''))
			)
			const db = this.ensureDb()
			for (let i = 0; i < entries.length; i++) {
				try { await remove(db, entries[i].id) } catch { /* ok */ }
				const doc = toOramaDocSync(entries[i])
				doc.vector = embeddings[i]
				await insert(db, doc as any)
			}
		} else {
			await Promise.all(entries.map((e) => this.index(e)))
		}
	}

	async remove(id: string): Promise<void> {
		try {
			await remove(this.ensureDb(), id)
		} catch {
			// Ignore - entry may not exist
		}
	}

	async search(query: string, options?: IndexSearchOptions): Promise<IndexResult[]> {
		const db = this.ensureDb()
		const topK = options?.topK ?? 10

		// Phase 2.2: detect GA semantic intents from the query when no explicit
		// intent is supplied. detectQueryIntents() never returns an empty array.
		const passedIntent = options?.intent
		const intents: QueryIntent[] = passedIntent
			? [passedIntent]
			: detectQueryIntents(query)

		// Map detected GA intents to a CB weight-distribution preset.
		const weightIntent = resolveWeightIntent(intents)
		const weights = intentWeights(weightIntent)

		// Extract a proper-noun subject for the +0.20 subject boost.
		const subject = extractQuerySubject(query)
		const subjectRe = subject ? new RegExp(`\\b${escapeRegex(subject)}\\b`, 'i') : null

		// Resolve effective mode: if no embedding function fall back to keyword
		// regardless of what the caller requested.
		const requestedMode = options?.mode ?? 'hybrid'
		const effectiveMode: 'keyword' | 'semantic' | 'hybrid' =
			this.embeddingFn ? requestedMode : 'keyword'

		// ── Keyword / BM25 path ────────────────────────────────────────────────
		let results: IndexResult[]
		if (effectiveMode === 'keyword') {
			results = await this.bm25Search(db, query, topK, weights)
		} else {
			// ── Vector embedding required from here ─────────────────────────────
			const queryEmbedding = await this.embeddingFn!(query)

			if (effectiveMode === 'semantic') {
				// Pure vector: no intent boosts applied (no BM25 doc map available)
				return this.vectorSearch(db, queryEmbedding, topK)
			}

			// ── Hybrid: RRF over vector + BM25 results ───────────────────────────
			const [vectorHits, bm25Hits] = await Promise.all([
				vectorSearchRaw(db, queryEmbedding, topK * 2),
				bm25SearchRaw(db, query, topK * 2),
			])

			results = fuseHybrid(vectorHits, bm25Hits, topK, weights)
		}

		// Phase 2.2: intent content boosts, subject boost, contradiction penalty.
		// We need the document objects for text inspection - rebuild the doc map
		// from a second BM25 pass over the result IDs we already have.
		if (!intents.includes('general') || subjectRe) {
			const docMap = await buildDocMap(db, query, topK * 2)
			results = applyIntentPostScoring(results, docMap, intents, subjectRe)
		}

		return results
	}

	async close(): Promise<void> {
		this.db = null
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	private async toOramaDoc(entry: MemoryEntry): Promise<OramaDocument> {
		const doc = toOramaDocSync(entry)
		if (this.embeddingFn) {
			doc.vector = await this.embeddingFn(entry.content ?? entry.title ?? '')
		}
		return doc
	}

	/**
	 * BM25-only search with CB's 4-signal RRF: keyword rank + salience + recency + reliability.
	 */
	private async bm25Search(
		db: AnyOrama,
		query: string,
		topK: number,
		weights: RetrievalWeights,
	): Promise<IndexResult[]> {
		const hits = await bm25SearchRaw(db, query, topK * 2)
		return applyAdaptiveRRF(hits, topK, weights)
	}

	/**
	 * Pure vector search - returns top-K by cosine similarity, no extra signals.
	 */
	private async vectorSearch(
		db: AnyOrama,
		queryEmbedding: number[],
		topK: number,
	): Promise<IndexResult[]> {
		const hits = await vectorSearchRaw(db, queryEmbedding, topK)
		return hits.map((hit, rank) => ({
			id: hit.id as string,
			score: rrfScore([rank], 60),
		}))
	}
}

// ── SemanticSearchBridge ──────────────────────────────────────────────────────
// Phase 4: absorbs extension's SemanticSearchBridge into packages/memory.
// Provides hybrid vector + BM25 search. Delegates embeddings to an injected
// IEmbedder so the Chrome-specific offscreen bridge stays in the extension.

export interface SemanticIndexEntry {
	id: string
	text: string
	kind: NodeKind
	metadata?: Record<string, unknown>
}

export interface SemanticSearchConfig {
	dimension?: number
	enableBM25?: boolean
	vectorWeight?: number
	rrfK?: number
}

export class SemanticSearchBridge {
	isInitialized = false
	isEmbedderReady = false

	private _nodeIdToDocId: Map<string, string>
	private _docIdToNodeId: Map<string, string>
	private _bm25Index: BM25Index | null
	private _vectorIndex: SimpleVectorIndex | null
	private _config: Required<SemanticSearchConfig>
	private _embedder: IEmbedder | undefined

	constructor(config: SemanticSearchConfig = {}, embedder?: IEmbedder) {
		this._config = { dimension: 384, enableBM25: true, vectorWeight: 0.6, rrfK: 60, ...config }
		this._embedder = embedder
		this._nodeIdToDocId = new Map()
		this._docIdToNodeId = new Map()
		this._bm25Index = new BM25Index()
		this._vectorIndex = new SimpleVectorIndex(this._config.dimension)
	}

	async ensureEmbedder(): Promise<void> {
		if (this.isEmbedderReady || !this._embedder) return
		try {
			await this._embedder.initialize()
			this.isEmbedderReady = this._embedder.isReady
		} catch {
			this.isEmbedderReady = false
		}
	}

	async buildIndex(entries: SemanticIndexEntry[]): Promise<{ numVectors: number; dimension: number }> {
		await this.ensureEmbedder()
		const valid = entries.filter(e => e.text)

		this._nodeIdToDocId.clear()
		this._docIdToNodeId.clear()
		for (const e of valid) {
			const docId = `mem_${e.id}`
			this._nodeIdToDocId.set(e.id, docId)
			this._docIdToNodeId.set(docId, e.id)
		}

		const docIds = valid.map(e => `mem_${e.id}`)
		const texts = valid.map(e => e.text)

		if (this.isEmbedderReady && this._embedder && this._vectorIndex) {
			const vectors = await this._embedder.embed(texts, { mode: 'passage' })
			this._vectorIndex.build(vectors, docIds, valid.map(e => ({ kind: e.kind, text: e.text, ...e.metadata })))
		}

		if (this._config.enableBM25 && this._bm25Index) {
			this._bm25Index.build(texts, docIds)
		}

		this.isInitialized = true
		return { numVectors: this._vectorIndex?.size ?? 0, dimension: this._config.dimension }
	}

	async search(query: string, k = 10): Promise<ScoredCandidate[]> {
		await this.ensureEmbedder()
		let queryVec: number[] | null = null

		if (this.isEmbedderReady && this._embedder) {
			try { queryVec = await this._embedder.embedSingle(query, { mode: 'query' }) } catch { /* fallback */ }
		}

		return this._hybridSearch(query, queryVec, k)
	}

	private _hybridSearch(query: string, queryVec: number[] | null, k: number): ScoredCandidate[] {
		const { vectorWeight, rrfK } = this._config
		const scoreMap = new Map<string, { score: number; nodeId: string; kind: NodeKind; text: string; vectorRank: number | null; bm25Rank: number | null }>()

		if (queryVec && this._vectorIndex?.isBuilt) {
			this._vectorIndex.search(queryVec, k * 2).forEach((r, rank) => {
				const nodeId = this._docIdToNodeId.get(r.docId) ?? r.docId
				scoreMap.set(nodeId, { score: 0, nodeId, kind: r.metadata?.kind as NodeKind ?? 'fact', text: r.text ?? '', vectorRank: rank, bm25Rank: null })
			})
		}

		if (this._config.enableBM25 && this._bm25Index?.isBuilt) {
			this._bm25Index.search(query, k * 2).forEach((r, rank) => {
				const nodeId = this._docIdToNodeId.get(r.docId) ?? r.docId
				const existing = scoreMap.get(nodeId)
				if (existing) existing.bm25Rank = rank
				else scoreMap.set(nodeId, { score: 0, nodeId, kind: 'fact', text: r.text ?? '', vectorRank: null, bm25Rank: rank })
			})
		}

		const candidates: ScoredCandidate[] = []
		for (const entry of scoreMap.values()) {
			let score = 0
			if (entry.vectorRank !== null) score += vectorWeight * (1 / (rrfK + entry.vectorRank + 1))
			if (entry.bm25Rank !== null) score += (1 - vectorWeight) * (1 / (rrfK + entry.bm25Rank + 1))
			candidates.push({ id: entry.nodeId, kind: entry.kind, score, content: entry.text })
		}
		return candidates.sort((a, b) => b.score - a.score).slice(0, k)
	}

	stats() {
		return { vectorCount: this._vectorIndex?.size ?? 0, bm25Count: this._bm25Index?.docCount ?? 0, isInitialized: this.isInitialized, isEmbedderReady: this.isEmbedderReady }
	}

	clear(): void {
		this._vectorIndex = new SimpleVectorIndex(this._config.dimension)
		this._bm25Index = new BM25Index()
		this._nodeIdToDocId.clear()
		this._docIdToNodeId.clear()
		this.isInitialized = false
	}
}

// ── Minimal vector index (cosine + brute-force) ───────────────────────────────

interface VectorDoc { docId: string; vector: number[]; text?: string; metadata?: Record<string, unknown> }

class SimpleVectorIndex {
	private docs: VectorDoc[] = []
	private dim: number
	get size() { return this.docs.length }
	get isBuilt() { return this.docs.length > 0 }

	constructor(dim: number) { this.dim = dim }

	build(vectors: number[][], docIds: string[], metadata: Record<string, unknown>[]): void {
		this.docs = vectors.map((v, i) => ({ docId: docIds[i], vector: v, text: metadata[i]?.text as string ?? '', metadata: metadata[i] }))
	}

	search(query: number[], k: number): { docId: string; text?: string; metadata?: Record<string, unknown>; score: number }[] {
		return this.docs
			.map(d => ({ docId: d.docId, text: d.text, metadata: d.metadata, score: cosine(query, d.vector) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, k)
	}
}

function cosine(a: number[], b: number[]): number {
	if (!a.length || a.length !== b.length) return 0
	let dot = 0, na = 0, nb = 0
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
	const d = Math.sqrt(na) * Math.sqrt(nb)
	return d === 0 ? 0 : dot / d
}

// ── Minimal BM25 index ────────────────────────────────────────────────────────

class BM25Index {
	private docs: { docId: string; text: string; terms: string[] }[] = []
	get docCount() { return this.docs.length }
	get isBuilt() { return this.docs.length > 0 }

	build(texts: string[], docIds: string[]): void {
		this.docs = texts.map((text, i) => ({ docId: docIds[i], text, terms: tokenize(text) }))
	}

	search(query: string, k: number): { docId: string; text?: string; score: number }[] {
		const qTerms = tokenize(query)
		const N = this.docs.length
		if (N === 0 || qTerms.length === 0) return []

		const avgLen = this.docs.reduce((s, d) => s + d.terms.length, 0) / N
		const k1 = 1.5, b = 0.75

		return this.docs
			.map(doc => {
				let score = 0
				for (const term of qTerms) {
					const tf = doc.terms.filter(t => t === term).length
					const df = this.docs.filter(d => d.terms.includes(term)).length
					if (tf === 0 || df === 0) continue
					const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
					score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.terms.length / avgLen))
				}
				return { docId: doc.docId, text: doc.text, score }
			})
			.filter(r => r.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, k)
	}
}

function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────


// ── Module-level helpers added in Phase 2.2 ──────────────────────────────────

/**
 * Fetch a BM25 hit-set and return a map from entry id → OramaDocument.
 * Used to get entry text for intent content scoring after the main RRF pass.
 */
async function buildDocMap(
	db: AnyOrama,
	query: string,
	limit: number,
): Promise<Map<string, OramaDocument>> {
	const hits = await bm25SearchRaw(db, query, limit)
	const map = new Map<string, OramaDocument>()
	for (const hit of hits) map.set(hit.id, hit.document)
	return map
}

/**
 * Apply Phase 2.2 post-RRF adjustments in-place:
 *   + intent content boost  (up to +0.45)
 *   + subject boost         (+0.20)
 *   - contradiction penalty (up to −0.15)
 */
function applyIntentPostScoring(
	results: IndexResult[],
	docMap: Map<string, OramaDocument>,
	intents: QueryIntent[],
	subjectRe: RegExp | null,
): IndexResult[] {
	const adjusted = results.map(({ id, score }) => {
		const doc = docMap.get(id)
		if (!doc) return { id, score }

		const text = `${doc.title} ${doc.content}`
		let delta = 0

		// Intent content boost
		delta += computeIntentContentBoost(doc, text, intents)

		// Subject boost: +0.20 when the extracted proper noun appears in the entry
		if (subjectRe && subjectRe.test(text)) delta += 0.2

		// Contradiction penalty
		delta -= computeContradictionPenalty(text, intents)

		return { id, score: score + delta }
	})

	// Re-sort after adjustments
	return adjusted.sort((a, b) => b.score - a.score)
}

// ── Module-level helpers (no `this` needed) ──────────────────────────────────

function toOramaDocSync(entry: MemoryEntry): OramaDocument {
	return {
		id: entry.id,
		title: entry.title ?? '',
		content: entry.content,
		type: entry.type,
		tags: (entry.tags ?? []).join(' '),
		entities: (entry.entities ?? []).join(' '),
		salience: entry.salience ?? 0,
		createdAt: entry.createdAt,
		confidence: entry.confidence ?? 0.5,
		sourceCount: entry.sourceIds?.length ?? 0,
	}
}

async function bm25SearchRaw(
	db: AnyOrama,
	query: string,
	limit: number,
): Promise<{ id: string; document: OramaDocument }[]> {
	const params: SearchParams<AnyOrama> = {
		term: query,
		limit,
		boost: {
			title: 2,
			content: 1,
			tags: 1.5,
			entities: 1.2,
		},
	}
	const result = (await search(db, params)) as unknown as {
		hits: { id: string; document: OramaDocument }[]
	}
	return result.hits
}

async function vectorSearchRaw(
	db: AnyOrama,
	queryEmbedding: number[],
	limit: number,
): Promise<{ id: string; document: OramaDocument }[]> {
	const result = (await search(db, {
		vector: { value: queryEmbedding, property: 'vector' },
		limit,
	} as any)) as unknown as { hits: { id: string; document: OramaDocument }[] }
	return result.hits
}

/**
 * Hybrid RRF fusion: fuses vector ranks with CB's 4-signal adaptive scoring.
 *
 * Vector hits contribute via pure RRF rank position (similarity signal).
 * BM25 hits contribute via both RRF rank AND the salience/recency/reliability
 * boosts already present in the original CB implementation.
 * Entries appearing in both lists accumulate scores from both passes.
 */
function fuseHybrid(
	vectorHits: { id: string; document: OramaDocument }[],
	bm25Hits: { id: string; document: OramaDocument }[],
	topK: number,
	weights: RetrievalWeights,
): IndexResult[] {
	const scores = new Map<string, number>()

	// Vector signal - contributes to the similarity weight bucket
	vectorHits.forEach((hit, rank) => {
		const rrf = rrfScore([rank], 60)
		scores.set(hit.id, (scores.get(hit.id) ?? 0) + rrf * weights.similarity)
	})

	// BM25 signal + salience + recency + reliability
	const now = Date.now()
	bm25Hits.forEach((hit, rank) => {
		const rrf = rrfScore([rank], 60)
		let contribution = rrf * weights.similarity

		// Salience
		contribution += (hit.document.salience ?? 0) * weights.salience

		// Recency - linear decay over 7 days
		const createdMs = hit.document.createdAt
			? new Date(hit.document.createdAt).getTime()
			: now
		const ageHours = (now - createdMs) / 3_600_000
		contribution += Math.max(0, 1 - ageHours / 168) * weights.recency

		// Reliability
		const reliability =
			(hit.document.confidence ?? 0.5) * 0.5 +
			Math.min((hit.document.sourceCount ?? 0) / 5, 1) * 0.5
		contribution += reliability * weights.reliability

		scores.set(hit.id, (scores.get(hit.id) ?? 0) + contribution)
	})

	return Array.from(scores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topK)
		.map(([id, score]) => ({ id, score }))
}

/**
 * CB's original 4-signal adaptive RRF applied to BM25-only hits.
 * Preserved unchanged for the keyword and graceful-degradation paths.
 */
function applyAdaptiveRRF(
	hits: { id: string; document: OramaDocument }[],
	topK: number,
	weights: RetrievalWeights,
): IndexResult[] {
	const rrfScores = new Map<string, number>()
	const now = Date.now()

	hits.forEach((hit, rank) => {
		const rrf = rrfScore([rank], 60)
		rrfScores.set(hit.id, (rrfScores.get(hit.id) ?? 0) + rrf * weights.similarity)
	})

	for (const hit of hits) {
		const current = rrfScores.get(hit.id) ?? 0
		let boost = 0

		// Salience signal
		boost += (hit.document.salience ?? 0) * weights.salience

		// Recency signal - decays linearly over 7 days (168 hours)
		const createdMs = hit.document.createdAt
			? new Date(hit.document.createdAt).getTime()
			: now
		const ageHours = (now - createdMs) / 3_600_000
		boost += Math.max(0, 1 - ageHours / 168) * weights.recency

		// Reliability signal
		const reliabilityScore =
			(hit.document.confidence ?? 0.5) * 0.5 +
			Math.min((hit.document.sourceCount ?? 0) / 5, 1) * 0.5
		boost += reliabilityScore * weights.reliability

		rrfScores.set(hit.id, current + boost)
	}

	return Array.from(rrfScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topK)
		.map(([id, score]) => ({ id, score }))
}

/** Reciprocal Rank Fusion score */
function rrfScore(ranks: number[], k = 60): number {
	return ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0)
}

/** Intent-based weight distribution (from Smriti reference implementation) */
interface RetrievalWeights {
	similarity: number
	recency: number
	salience: number
	reliability: number
}

function intentWeights(intent: QueryIntent): RetrievalWeights {
	switch (intent) {
		case 'factual':
			return { similarity: 0.4, recency: 0.1, salience: 0.2, reliability: 0.3 }
		case 'experiential':
			return { similarity: 0.2, recency: 0.3, salience: 0.3, reliability: 0.1 }
		case 'procedure':
			return { similarity: 0.3, recency: 0.1, salience: 0.15, reliability: 0.3 }
		case 'mixed':
		default:
			return { similarity: 0.3, recency: 0.2, salience: 0.2, reliability: 0.2 }
	}
}

// ── Phase 2.2: GA ContextBuilder intent system ────────────────────────────────
//
// Ported from lib/memory/context/ContextBuilder.ts.
// All detection is regex-based - no LLM call required.
//
// detectQueryIntents()    → classify the query into QueryIntent[]
// extractQuerySubject()   → pull the proper noun being asked about
// computeIntentContentBoost() / computeContradictionPenalty()
//                         → score adjustments applied to Orama results
// resolveWeightIntent()   → map GA intents to a CB weight-preset QueryIntent

type GAIntent = 'residence' | 'employment' | 'temporal' | 'preference' | 'identity'

/** Regex patterns fired against the *query string* to classify intent. */
const QUERY_INTENT_PATTERNS: Record<GAIntent, RegExp[]> = {
	residence: [
		/where\b.*(live|stay|based|reside|located|from)/i,
		/\b(address|location|city|town|country|home|apartment|house|neighborhood)\b/i,
		/\bmov(?:ed|ing) to\b/i,
	],
	employment: [
		/where\b.*(work|employed|job)/i,
		/\b(job|career|company|employer|role|position|title|profession|occupation)\b/i,
		/\b(hired|promoted|fired|quit|laid off|works? at|employed at)\b/i,
	],
	temporal: [
		/\bwhen\b/i,
		/\b(last time|recently|date|history|timeline|ago|before|after|since|latest)\b/i,
		/\b(yesterday|last week|last month|this year|earlier)\b/i,
	],
	preference: [
		/\b(like|prefer|favorite|favourite|enjoy|love|hate|dislike|interested in|fond of)\b/i,
		/what.*\b(think|feel|opinion)\b/i,
	],
	identity: [
		/\bwho is\b/i,
		/\btell me about\b/i,
		/\bwhat.*know about\b/i,
		/\bdescribe\b/i,
		/\bbackground (?:of|on)\b/i,
	],
}

/**
 * Detect one or more QueryIntents from a natural language query.
 * Returns ['general'] when no pattern fires.
 * Exported so callers (MemoryService, ContextBuilder, tests) can reuse it.
 */
export function detectQueryIntents(query: string): QueryIntent[] {
	const detected: QueryIntent[] = []
	for (const [intent, patterns] of Object.entries(QUERY_INTENT_PATTERNS) as [GAIntent, RegExp[]][]) {
		if (patterns.some((re) => re.test(query))) {
			detected.push(intent)
		}
	}
	return detected.length > 0 ? detected : ['general']
}

/** Common sentence-opening words that are NOT subject proper nouns. */
const QUERY_STOP_WORDS = new Set([
	'I', 'A', 'An', 'The',
	'When', 'Where', 'Who', 'What', 'Which', 'How', 'Why',
	'Did', 'Do', 'Does', 'Is', 'Are', 'Was', 'Were',
	'Can', 'Could', 'Would', 'Should', 'Has', 'Have', 'Had',
	'Tell', 'Describe', 'List', 'Show', 'Give',
])

/**
 * Extract the most salient proper noun from the query - longest capitalised
 * token (or multi-word sequence) that is not a common stop-word.
 * Returns null when nothing is found.
 * Exported for reuse in MemoryService / ContextBuilder.
 */
export function extractQuerySubject(query: string): string | null {
	const matches = query.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\b/g)
	if (!matches || matches.length === 0) return null
	const candidates = matches.filter((m) => !QUERY_STOP_WORDS.has(m))
	if (candidates.length === 0) return null
	return candidates.reduce((a, b) => (b.length > a.length ? b : a))
}

interface ContentSignal {
	pattern: RegExp
	weight: number
}

/**
 * Per-intent patterns tested against *entry text* (title + content).
 * Positive weights → boost. Penalty signals live in the `penalty` array
 * and are subtracted (capped at −0.15) rather than added.
 */
const INTENT_CONTENT_SIGNALS: Record<
	GAIntent,
	{ boost: ContentSignal[]; penalty: ContentSignal[] }
> = {
	residence: {
		boost: [
			{ pattern: /\b(?:lives? in|moved? to|relocated|based in|located in|address|hometown)\b/i, weight: 0.25 },
			{ pattern: /\b(?:city|town|country|neighborhood|apartment|house|flat)\b/i, weight: 0.15 },
		],
		penalty: [
			// Entry is about someone *else's* location, not the user's
			{ pattern: /\b(?:parents? live|friend lives|family.*(?:live|stay))\b/i, weight: 0.15 },
		],
	},
	employment: {
		boost: [
			{ pattern: /\b(?:works? at|employed (?:at|by)|position (?:at|of)|job (?:at|title)|hired (?:at|by))\b/i, weight: 0.25 },
			{ pattern: /\b(?:role|title|company|organization|employer|profession|promoted|fired|quit)\b/i, weight: 0.15 },
		],
		penalty: [],
	},
	temporal: {
		boost: [
			{ pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i, weight: 0.25 },
			{ pattern: /\b\d{4}\b/, weight: 0.20 },
			{ pattern: /\b(?:yesterday|last week|last month|this year|ago|recently|on \w+day)\b/i, weight: 0.15 },
		],
		penalty: [],
	},
	preference: {
		boost: [
			{ pattern: /\b(?:loves?|enjoys?|likes?|prefers?|favorite|favourite|hates?|dislikes?)\b/i, weight: 0.25 },
			{ pattern: /\b(?:always|never|usually|typically)\b.*\b(?:eat|drink|watch|read|use|buy)\b/i, weight: 0.15 },
		],
		penalty: [],
	},
	identity: {
		boost: [
			{ pattern: /^[A-Z][a-z]+ (?:is|was|has|works|lives|studied)/m, weight: 0.25 },
			{ pattern: /\b(?:profile|background|bio|known for|described as)\b/i, weight: 0.20 },
		],
		penalty: [],
	},
}

/**
 * Compute total content boost for an entry given the active intents.
 * Type-level shortcuts (procedure / entity) skip the regex scan.
 * Clamped to [0, 0.45].
 */
function computeIntentContentBoost(
	doc: OramaDocument,
	text: string,
	intents: QueryIntent[],
): number {
	if (intents.includes('general')) return 0
	let total = 0

	// CB procedural preset: type='procedure' entries get a direct boost
	if (intents.includes('procedure') && doc.type === 'procedure') total += 0.3

	// GA / CB identity: type='entity' entries get a direct boost
	if (intents.includes('identity') && doc.type === 'entity') total += 0.3

	for (const intent of intents) {
		const signals = INTENT_CONTENT_SIGNALS[intent as GAIntent]
		if (!signals) continue
		for (const { pattern, weight } of signals.boost) {
			if (pattern.test(text)) total += weight
		}
	}

	return Math.min(0.45, total)
}

/**
 * Compute contradiction penalty magnitude for an entry.
 * Caller subtracts this value (never negative) from the score.
 * Capped at 0.15 to match GA reference implementation.
 */
function computeContradictionPenalty(text: string, intents: QueryIntent[]): number {
	if (intents.includes('general')) return 0
	let total = 0
	for (const intent of intents) {
		const signals = INTENT_CONTENT_SIGNALS[intent as GAIntent]
		if (!signals) continue
		for (const { pattern, weight } of signals.penalty) {
			if (pattern.test(text)) total += weight
		}
	}
	return Math.min(0.15, total)
}

/**
 * Map detected GA intents to the best-fitting CB weight-distribution preset.
 *
 *   identity / residence / employment → 'factual'  (high reliability + similarity)
 *   temporal                          → 'experiential' (high recency)
 *   procedural (CB) or how-to queries → 'procedural'
 *   preference / general              → 'mixed'
 */
function resolveWeightIntent(intents: QueryIntent[]): QueryIntent {
	if (intents.includes('factual'))      return 'factual'
	if (intents.includes('experiential')) return 'experiential'
	if (intents.includes('procedure'))    return 'procedure'
	if (intents.includes('identity'))     return 'factual'
	if (intents.includes('temporal'))     return 'experiential'
	if (intents.includes('residence'))    return 'factual'
	if (intents.includes('employment'))   return 'factual'
	if (intents.includes('preference'))   return 'mixed'
	return 'mixed'
}

/** Escape special regex characters in a subject string before building a RegExp. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
