const _b64 = {
	fromArrayBuffer(buf: ArrayBuffer): string {
		const bytes = new Uint8Array(buf)
		let binary = ''
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
		return btoa(binary)
	},
	toArrayBuffer(b64: string): ArrayBuffer {
		const binary = atob(b64)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
		return bytes.buffer
	},
}

export interface VectorSearchResult {
	index: number
	score: number
	doc_id: string
	metadata?: Record<string, unknown>
	text?: string
}

export interface SerializedVectorIndex {
	dimension: number
	ids: string[]
	metadata: Record<string, unknown>[]
	vectors_b64?: string
	norms_b64?: string
	vectors?: number[][]
	options?: { maxElements?: number; efConstruction?: number; M?: number; ef?: number }
	format?: string
}

export class BrowserVectorSearch {
	dimension: number
	private _matrix: Float32Array | null = null
	private _norms: Float32Array | null = null
	ids: string[] = []
	metadata: Record<string, unknown>[] = []
	isBuilt = false
	maxElements: number
	efConstruction: number
	M: number
	ef: number
	useFlatIndex = true

	constructor(dimension = 384, options: { maxElements?: number; efConstruction?: number; M?: number; ef?: number } = {}) {
		this.dimension = dimension
		this.maxElements = options.maxElements ?? 100000
		this.efConstruction = options.efConstruction ?? 200
		this.M = options.M ?? 16
		this.ef = options.ef ?? 50
	}

	async buildIndex(embeddings: number[][], docIds: string[], documents?: unknown[]): Promise<{ numVectors: number; dimension: number; indexType: string }> {
		if (!embeddings?.length) throw new Error('Cannot build index with zero embeddings')
		if (embeddings.length !== docIds.length) throw new Error('Embeddings and IDs must have same length')

		const n = embeddings.length
		const d = this.dimension
		if (embeddings[0].length !== d) throw new Error(`Embedding dimension mismatch: got ${embeddings[0].length}, expected ${d}`)

		const mat = new Float32Array(n * d)
		const norms = new Float32Array(n)
		let offset = 0
		for (let i = 0; i < n; i++) {
			const row = embeddings[i]
			let sum = 0
			for (let j = 0; j < d; j++) { const v = row[j]; mat[offset + j] = v; sum += v * v }
			norms[i] = Math.sqrt(sum) || 1e-12
			offset += d
		}

		this._matrix = mat
		this._norms = norms
		this.ids = docIds.slice()

		if (Array.isArray(documents)) {
			this.metadata = documents.map(doc => {
				if (!doc || typeof doc !== 'object') return (doc ?? {}) as Record<string, unknown>
				const d2 = doc as Record<string, unknown>
				const flat: Record<string, unknown> = {}
				if (d2.metadata && typeof d2.metadata === 'object') Object.assign(flat, d2.metadata)
				for (const [k, v] of Object.entries(d2)) {
					if (k === 'metadata') continue
					if (k === 'text') flat.text = v
					else if (k === 'id') flat.doc_id = v
					else if (!(k in flat)) flat[k] = v
				}
				return flat
			})
		} else {
			this.metadata = Array.from({ length: n }, () => ({} as Record<string, unknown>))
		}
		this.isBuilt = true
		return { numVectors: n, dimension: d, indexType: 'flat' }
	}

	search(queryEmbedding: number[], k = 10, options: { filter?: ((m: Record<string, unknown>) => boolean) | null; minScore?: number; includeMetadata?: boolean } = {}): VectorSearchResult[] {
		if (!this.isBuilt) throw new Error('Index not built. Call buildIndex() first.')
		const { filter = null, minScore = 0.0, includeMetadata = true } = options
		const d = this.dimension
		if (queryEmbedding.length !== d) throw new Error(`Query dim mismatch: got ${queryEmbedding.length}, expected ${d}`)

		const q = new Float32Array(queryEmbedding)
		let qnorm = 0
		for (let i = 0; i < d; i++) qnorm += q[i] * q[i]
		qnorm = Math.sqrt(qnorm) || 1e-12

		const n = this.ids.length
		const mat = this._matrix!
		const norms = this._norms!
		const scores = new Float32Array(n)

		for (let row = 0, base = 0; row < n; row++, base += d) {
			let dot = 0, j = 0
			const lim = d - (d % 4)
			for (; j < lim; j += 4) dot += q[j]*mat[base+j] + q[j+1]*mat[base+j+1] + q[j+2]*mat[base+j+2] + q[j+3]*mat[base+j+3]
			for (; j < d; j++) dot += q[j] * mat[base + j]
			scores[row] = norms[row] > 0 ? dot / (qnorm * norms[row]) : 0
		}

		const candidates: number[] = []
		for (let i = 0; i < n; i++) {
			if (scores[i] < minScore) continue
			if (filter && !filter(this.metadata[i])) continue
			candidates.push(i)
		}

		if (candidates.length > 2 * k && k > 0) {
			candidates.sort((a, b) => scores[b] - scores[a])
			candidates.length = Math.min(k, candidates.length)
		} else {
			candidates.sort((a, b) => scores[b] - scores[a])
			if (k > 0) candidates.length = Math.min(k, candidates.length)
		}

		return candidates.map(idx => includeMetadata
			? { index: idx, score: scores[idx], doc_id: this.ids[idx], metadata: this.metadata[idx] ?? {}, text: (this.metadata[idx]?.text as string) ?? '' }
			: { index: idx, score: scores[idx], doc_id: this.ids[idx] }
		)
	}

	getDocument(docId: string): { doc_id: string; embedding: number[]; metadata: Record<string, unknown> } | null {
		const index = this.ids.indexOf(docId)
		if (index === -1) return null
		const d = this.dimension
		const start = index * d
		return { doc_id: docId, embedding: Array.from(this._matrix!.subarray(start, start + d)), metadata: this.metadata[index] }
	}

	getAllIds(): string[] { return this.ids.slice() }

	getStats() {
		const n = this.ids.length
		return { numVectors: n, dimension: this.dimension, indexType: 'flat', memoryEstimate: `~${Math.round(n * this.dimension * 4 / 1024 / 1024)} MB` }
	}

	serialize(): SerializedVectorIndex {
		return {
			dimension: this.dimension,
			ids: this.ids,
			metadata: this.metadata,
			vectors_b64: this._matrix ? _b64.fromArrayBuffer(this._matrix.buffer as ArrayBuffer) : undefined,
			norms_b64: this._norms ? _b64.fromArrayBuffer(this._norms.buffer as ArrayBuffer) : undefined,
			options: { maxElements: this.maxElements, efConstruction: this.efConstruction, M: this.M, ef: this.ef },
			format: 'contiguous_f32_b64_v1',
		}
	}

	deserialize(data: SerializedVectorIndex): void {
		this.dimension = data.dimension
		if (data.vectors_b64 && data.norms_b64) {
			this._matrix = new Float32Array(_b64.toArrayBuffer(data.vectors_b64))
			this._norms = new Float32Array(_b64.toArrayBuffer(data.norms_b64))
		} else if (Array.isArray(data.vectors)) {
			const vectors = data.vectors
			const n = vectors.length
			if (n > 0 && vectors[0].length !== this.dimension) this.dimension = vectors[0].length
			const d = this.dimension
			const mat = new Float32Array(n * d)
			const norms = new Float32Array(n)
			let off = 0
			for (let i = 0; i < n; i++) {
				const row = vectors[i]; let sum = 0
				for (let j = 0; j < d; j++) { mat[off + j] = row[j]; sum += row[j] * row[j] }
				norms[i] = Math.sqrt(sum) || 1e-12
				off += d
			}
			this._matrix = mat; this._norms = norms
		} else {
			throw new Error('Invalid serialized data: missing vectors')
		}
		this.ids = data.ids ?? []
		this.metadata = data.metadata ?? []
		if (data.options) {
			this.maxElements = data.options.maxElements ?? this.maxElements
			this.efConstruction = data.options.efConstruction ?? this.efConstruction
			this.M = data.options.M ?? this.M
			this.ef = data.options.ef ?? this.ef
		}
		this.isBuilt = true
	}

	clear(): void {
		this._matrix = null; this._norms = null; this.ids = []; this.metadata = []; this.isBuilt = false
	}
}

export class BM25Search {
	k1: number
	b: number
	docCount = 0
	docLengths: number[] = []
	avgDocLength = 0
	postings = new Map<string, { doc: number; tf: number }[]>()
	docIds: string[] = []
	documents: unknown[] = []
	isBuilt = false

	constructor(options: { k1?: number; b?: number } = {}) {
		this.k1 = options.k1 ?? 1.5
		this.b = options.b ?? 0.75
	}

	tokenize(text: string): string[] {
		return String(text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
	}

	buildIndex(documents: unknown[], docIds: string[]): void {
		if (!documents?.length) throw new Error('Cannot build BM25 with zero documents')
		if (documents.length !== docIds.length) throw new Error('Documents and IDs must have same length')
		this.docCount = documents.length
		this.docIds = docIds.slice()
		this.documents = documents.slice()

		const postings = new Map<string, { doc: number; tf: number }[]>()
		const docLengths = new Array<number>(this.docCount)
		let totalLen = 0

		for (let i = 0; i < this.docCount; i++) {
			const doc = documents[i]
			const text = typeof doc === 'string' ? doc : ((doc as any)?.text ?? '')
			const terms = this.tokenize(text)
			const tfMap = new Map<string, number>()
			for (const t of terms) tfMap.set(t, (tfMap.get(t) ?? 0) + 1)
			for (const [t, tf] of tfMap) {
				if (!postings.has(t)) postings.set(t, [])
				postings.get(t)!.push({ doc: i, tf })
			}
			docLengths[i] = terms.length
			totalLen += terms.length
		}

		this.docLengths = docLengths
		this.avgDocLength = Math.max(1, totalLen / (this.docCount || 1))
		this.postings = postings
		this.isBuilt = true
	}

	search(query: string, k = 10): VectorSearchResult[] {
		if (!this.isBuilt) throw new Error('BM25 index not built')
		const qTerms = this.tokenize(query)
		if (!qTerms.length) return []

		const scores = new Float32Array(this.docCount)
		const touched = new Set<number>()
		for (const term of new Set(qTerms)) {
			const plist = this.postings.get(term)
			if (!plist) continue
			const df = plist.length
			const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1)
			for (const { doc, tf } of plist) {
				const dl = this.docLengths[doc]
				scores[doc] += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * dl / this.avgDocLength))
				touched.add(doc)
			}
		}

		return Array.from(touched)
			.sort((a, b) => scores[b] - scores[a])
			.slice(0, k)
			.map(idx => {
				const doc = this.documents[idx] as any
				const meta = (typeof doc === 'object' && doc !== null) ? (doc.metadata ?? doc) : {}
				return { index: idx, score: scores[idx], doc_id: this.docIds[idx], text: typeof doc === 'string' ? doc : (doc?.text ?? ''), parent_id: meta.parent_id ?? doc?.parent_id, metadata: meta }
			})
	}
}
