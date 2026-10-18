import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm'
import { getModelConstraints, type ModelConstraints } from './model-constraints'
import { loadSettings } from '@/shared/settings'

export interface SearchResult {
	doc_id?: string
	id?: string
	score: number
	text?: string
	metadata?: Record<string, unknown>
	parent_id?: string
	chunks?: SearchResult[]
	vector_score?: number
	bm25_score?: number
	vector_rank?: number | null
	bm25_rank?: number | null
	fusion_method?: string
}

interface VectorSearch {
	isBuilt: boolean
	search(embedding: number[], k: number, options?: { minScore?: number; includeMetadata?: boolean; filter?: ((meta: Record<string, unknown>) => boolean) | null }): SearchResult[]
	getDocument?(id: string): SearchResult | undefined
}

interface BM25Search {
	isBuilt: boolean
	search(query: string, k: number): SearchResult[]
}

interface RAGConfig {
	model_id?: string
	temperature?: number
	max_tokens?: number
	top_p?: number
	repeat_penalty?: number
	context_window_size?: number
	num_results?: number
	similarity_threshold?: number
	retrieval_k?: number
	vector_weight?: number
	max_chunks_per_parent?: number
	system_prompt?: string
	user_template?: string
	hyde_prompt?: string
	hyde_temperature?: number
	hyde_max_tokens?: number
}

interface QueryOptions {
	numResults?: number
	temperature?: number
	maxTokens?: number
	includeMetadata?: boolean
	metadataFields?: string[]
	similarityThreshold?: number
	allowedDocIds?: string[] | Set<string> | string | null
	retrievalK?: number
	vectorWeight?: number
	searchType?: string
}

interface RAGResult {
	answer: string
	sources: SearchResult[]
	metadata: {
		numSources: number
		searchType: string
		generationTime?: number
		model: string
		temperature?: number
		retrieval: Record<string, unknown>
		scope: { type: string; size: number } | null
		retrieval_time_ms?: number
		wasStopped: boolean
		contextLimited: boolean
	}
}

interface ContextResult {
	context: string
	contextLimited: boolean
	tokensUsed: number
	maxTokens: number
}

interface ThinkFilter {
	push(chunk: string): string
	flush(): string
}

const DEFAULT_SYSTEM_PROMPT =
`You are a helpful assistant answering questions based on provided documents.
Use [Doc N] to cite sources. If information is missing, say so. Keep answers clear and focused.`

const DEFAULT_USER_TEMPLATE =
`Documents:
{context}

Question: {question}

Answer based on the documents above:`

const DEFAULT_HYDE_PROMPT = `Write a short factual paragraph that could answer this question:`

export class BrowserRAG {
	private vectorSearch: VectorSearch
	private chunkVectorSearch: VectorSearch | null
	private bm25Search: BM25Search | null
	private engine: any = null
	private worker: Worker | null = null
	shouldAbort = false
	private currentGenerationReject: ((err: Error) => void) | null = null
	needsReinit = false
	private modelId: string
	private modelConstraints: ModelConstraints
	isInitialized = false
	private temperature: number
	private maxTokens: number
	private topP: number
	private repeatPenalty: number
	private maxContextLength: number
	private numResults: number
	private similarityThreshold: number
	private retrievalK: number
	private vectorWeight: number
	private maxChunksPerParent: number
	conversationHistory: unknown[] = []
	private systemPrompt: string
	private userTemplate: string
	private hydePrompt: string
	private hydeTemperature: number
	private hydeMaxTokens: number

	constructor(vectorSearch: VectorSearch, chunkVectorSearch: VectorSearch | null = null, bm25Search: BM25Search | null = null) {
		this.vectorSearch = vectorSearch
		this.chunkVectorSearch = chunkVectorSearch
		this.bm25Search = bm25Search

		const saved = this._loadSavedConfigSync()
		this.modelId = saved.model_id ?? 'gemma-2-2b-it-q4f32_1-MLC'
		this.modelConstraints = getModelConstraints(this.modelId)
		this.temperature = saved.temperature ?? 0.5
		this.maxTokens = saved.max_tokens ?? 1024
		this.topP = saved.top_p ?? 0.9
		this.repeatPenalty = saved.repeat_penalty ?? 1.15
		this.maxContextLength = saved.context_window_size ?? this.modelConstraints.contextWindow ?? 2048
		this.numResults = saved.num_results ?? 5
		this.similarityThreshold = saved.similarity_threshold ?? 0.7
		this.retrievalK = saved.retrieval_k ?? 60
		this.vectorWeight = saved.vector_weight ?? 0.6
		this.maxChunksPerParent = saved.max_chunks_per_parent ?? 5
		this.systemPrompt = saved.system_prompt ?? DEFAULT_SYSTEM_PROMPT
		this.userTemplate = saved.user_template ?? DEFAULT_USER_TEMPLATE
		this.hydePrompt = saved.hyde_prompt ?? DEFAULT_HYDE_PROMPT
		this.hydeTemperature = saved.hyde_temperature ?? 0.2
		this.hydeMaxTokens = saved.hyde_max_tokens ?? 256
	}

	getModelConstraints(): ModelConstraints { return this.modelConstraints }

	abort(): void {
		this.shouldAbort = true
		if (this.engine && typeof this.engine.interruptGenerate === 'function') this.engine.interruptGenerate()
		this.currentGenerationReject?.(new Error('Generation stopped by user'))
	}

	resetAbort(): void {
		this.shouldAbort = false
		this.currentGenerationReject = null
	}

	async reinitializeEngine(): Promise<void> {
		if (this.worker) {
			try { this.worker.terminate() } catch (_) { /* worker may already be gone; nothing to recover */ }
			this.worker = null
		}
		this.engine = null
		this.isInitialized = false
		this.needsReinit = false
		await this.initialize()
	}

	async ensureEngineReady(): Promise<void> {
		if (this.needsReinit) await this.reinitializeEngine()
		if (!this.isInitialized) throw new Error('LLM not initialized. Call initialize() first.')
	}

	private _loadSavedConfigSync(): RAGConfig {
		return {}
	}

	private async _loadSavedConfig(): Promise<RAGConfig> {
		try {
			const settings = await loadSettings()
			const raw = settings as unknown as Record<string, unknown>
			const llm = (raw.llm ?? {}) as Record<string, unknown>
			const search = (raw.search ?? {}) as Record<string, unknown>
			const ragPrompts = (raw.rag_prompts ?? {}) as Record<string, unknown>
			const hyde = (raw.hyde ?? {}) as Record<string, unknown>
			return {
				model_id: llm.model_id as string | undefined,
				temperature: llm.temperature as number | undefined,
				max_tokens: llm.max_tokens as number | undefined,
				top_p: llm.top_p as number | undefined,
				repeat_penalty: llm.repeat_penalty as number | undefined,
				context_window_size: llm.context_window_size as number | undefined,
				num_results: search.num_results as number | undefined,
				similarity_threshold: search.similarity_threshold as number | undefined,
				retrieval_k: search.retrieval_k as number | undefined,
				vector_weight: search.vector_weight as number | undefined,
				max_chunks_per_parent: search.max_chunks_per_parent as number | undefined,
				system_prompt: ragPrompts.system_prompt as string | undefined,
				user_template: ragPrompts.user_template as string | undefined,
				hyde_prompt: hyde.prompt as string | undefined,
				hyde_temperature: hyde.temperature as number | undefined,
				hyde_max_tokens: hyde.max_tokens as number | undefined,
			}
		} catch {
			return {}
		}
	}

	async initialize(onProgress?: ((p: { status: string; text?: string; progress?: number }) => void) | null): Promise<void> {
		if (this.isInitialized) return

		const orig = { log: console.log, info: console.info, warn: console.warn }
		try {
			console.log = () => {}; console.info = () => {}; console.warn = () => {}

			if (this.worker) { try { this.worker.terminate() } catch (_) { /* worker may already be gone; nothing to recover */ } this.worker = null }
			this.worker = new Worker(new URL('./llm-worker.ts', import.meta.url), { type: 'module' })

			const captureModelId = this.modelId
			this.engine = await CreateWebWorkerMLCEngine(this.worker, this.modelId, {
				initProgressCallback: (progress: { text?: string; progress?: number }) => {
					if (progress.text) {
						const sizeMatch = /\/([\d.]+)\s*(GB|MB)/i.exec(progress.text)
						if (sizeMatch) {
							const sizeStr = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`
							try {
								const cached = JSON.parse(localStorage.getItem('vectoria_model_download_sizes') ?? '{}')
								cached[captureModelId] = sizeStr
								localStorage.setItem('vectoria_model_download_sizes', JSON.stringify(cached))
							} catch (_) {
								// Optional cache of download sizes; storage can be unavailable or full.
							}
						}
					}
					onProgress?.({ status: 'loading', text: progress.text, progress: progress.progress ?? 0 })
				},
				...(this.maxContextLength ? { context_window_size: this.maxContextLength } : {}),
				appConfig: {
					...prebuiltAppConfig,
				} as any,
			})

			this.isInitialized = true
			Object.assign(console, orig)
			onProgress?.({ status: 'ready', progress: 1, text: 'Model ready!' })
		} catch (error) {
			Object.assign(console, orig)
			if (this.worker) { try { this.worker.terminate() } catch (_) { /* worker may already be gone; nothing to recover */ } this.worker = null }
			throw new Error(`LLM initialization failed: ${(error as Error).message}`, { cause: error })
		} finally {
			Object.assign(console, orig)
		}
	}

	async generateHyDE(question: string): Promise<string> {
		await this.ensureEngineReady()
		let maxTokens = this.hydeMaxTokens
		if (this.modelConstraints.hasThinkMode) maxTokens = Math.min(maxTokens * 3, this.modelConstraints.maxTokens[1])

		const completion = await this.engine.chat.completions.create({
			messages: [{ role: 'user', content: `${this.hydePrompt}\n\n${question}` }],
			temperature: this.hydeTemperature,
			max_tokens: maxTokens,
			top_p: 0.9,
			stream: true,
		})

		let hydeText = ''
		let wasStopped = false
		const filter = this._createThinkFilter()
		for await (const chunk of completion) {
			if (this.shouldAbort) { wasStopped = true; break }
			hydeText += filter.push(chunk.choices[0]?.delta?.content ?? '')
		}
		hydeText += filter.flush()
		if (wasStopped) { this.needsReinit = true; throw new Error('HyDE generation stopped by user') }
		return this._stripThinkingTokens(hydeText)
	}

	async query(question: string, questionEmbedding: number[], options: QueryOptions = {}): Promise<RAGResult> {
		await this.ensureEngineReady()
		await this._applyFreshConfig()

		const {
			numResults = this.numResults,
			temperature: rawTemperature = this.temperature,
			maxTokens: rawMaxTokens = this.maxTokens,
			includeMetadata = true,
			similarityThreshold = this.similarityThreshold,
			allowedDocIds = null,
			retrievalK = this.retrievalK,
		} = options

		const temperature = Math.max(this.modelConstraints.temp[0], Math.min(this.modelConstraints.temp[1], rawTemperature))
		let maxTokens = Math.max(this.modelConstraints.maxTokens[0], Math.min(this.modelConstraints.maxTokens[1], rawMaxTokens))
		if (this.modelConstraints.hasThinkMode) maxTokens = Math.min(maxTokens * 3, this.modelConstraints.maxTokens[1])

		const allowedDocIdSet = this._normalizeDocScope(allowedDocIds)
		const scopeMetadata = allowedDocIdSet ? { type: 'doc_filter', size: allowedDocIdSet.size } : null
		const allowDoc = (candidate: unknown) =>
			!allowedDocIdSet ||
			((typeof candidate === 'string' || typeof candidate === 'number') && allowedDocIdSet.has(String(candidate)))
		const chunkFilter = allowedDocIdSet ? (m: Record<string, unknown>) => allowDoc(m?.parent_id ?? m?.doc_id ?? m?.id) : null
		const docFilter = allowedDocIdSet ? (m: Record<string, unknown>) => allowDoc(m?.doc_id ?? m?.id) : null

		let results: SearchResult[]
		let isChunkBased: boolean
		let retrievalMetrics: Record<string, unknown>

		if (this.chunkVectorSearch?.isBuilt) {
			const chunkK = Math.max(numResults, retrievalK)
			const vectorWeight = options.vectorWeight ?? this.vectorWeight
			const useBM25 = vectorWeight < 1.0 && !!this.bm25Search?.isBuilt
			const useVector = vectorWeight > 0.0

			const vectorChunkResults: SearchResult[] = useVector
				? this.chunkVectorSearch.search(questionEmbedding, chunkK, { minScore: similarityThreshold, includeMetadata: true, filter: chunkFilter })
				: []

			let bm25ChunkResults: SearchResult[] = []
			if (useBM25 && this.bm25Search) {
				bm25ChunkResults = this.bm25Search.search(question, chunkK)
				if (allowedDocIdSet) bm25ChunkResults = bm25ChunkResults.filter(r => allowDoc(r.parent_id ?? r.metadata?.parent_id ?? r.metadata?.doc_id))
			}

			let fusedChunks: SearchResult[]
			if (vectorWeight >= 1.0) fusedChunks = vectorChunkResults
			else if (vectorWeight <= 0.0 && bm25ChunkResults.length) fusedChunks = bm25ChunkResults
			else if (bm25ChunkResults.length) fusedChunks = this._fuseResults(vectorChunkResults, bm25ChunkResults, { k: 60, vectorWeight, topK: chunkK })
			else fusedChunks = vectorChunkResults

			const maxTotal = numResults * this.maxChunksPerParent * 2
			if (fusedChunks.length > maxTotal) fusedChunks = fusedChunks.slice(0, maxTotal)

			const parentGroups = this._groupChunksByParent(fusedChunks, numResults, this.maxChunksPerParent)
			if (allowedDocIdSet && !parentGroups.length) {
				results = this.vectorSearch.search(questionEmbedding, numResults, { minScore: similarityThreshold, includeMetadata: true, filter: docFilter })
					.map(r => ({ ...r, text: r.text ?? (r.metadata?.text as string) ?? '' }))
				isChunkBased = false
			} else {
				results = parentGroups
				isChunkBased = true
			}

			retrievalMetrics = {
				vector_count: vectorChunkResults.length,
				bm25_count: bm25ChunkResults.length,
				fused_count: fusedChunks.length,
				parent_count: parentGroups.length,
				fusion_method: vectorWeight >= 1.0 ? 'vector-only' : vectorWeight <= 0.0 ? 'bm25-only' : bm25ChunkResults.length ? 'RRF' : 'vector-only',
				scope_size: allowedDocIdSet?.size ?? null,
				requested_k: chunkK,
			}
		} else {
			results = this.vectorSearch.search(questionEmbedding, numResults, { minScore: similarityThreshold, includeMetadata: true, filter: docFilter })
				.map(r => ({ ...r, text: r.text ?? (r.metadata?.text as string) ?? '' }))
			isChunkBased = false
			retrievalMetrics = { vector_count: results.length, bm25_count: 0, fused_count: results.length, parent_count: results.length, fusion_method: 'vector-only', scope_size: allowedDocIdSet?.size ?? null }
		}

		const { context, contextLimited } = isChunkBased
			? this._buildChunkedContext(results, includeMetadata, options.metadataFields)
			: this._buildContext(results, includeMetadata, options.metadataFields)

		const prompt = this._buildRAGPrompt(question, context)
		const startTime = Date.now()

		const completion = await this.engine.chat.completions.create({
			messages: [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: prompt }],
			temperature,
			max_tokens: maxTokens,
			top_p: this.topP,
			repetition_penalty: this.repeatPenalty,
			stream: true,
		})

		let answer = ''
		let wasStopped = false
		const filter = this._createThinkFilter()
		for await (const chunk of completion) {
			if (this.shouldAbort) { wasStopped = true; break }
			answer += filter.push(chunk.choices[0]?.delta?.content ?? '')
		}
		answer += filter.flush()
		if (wasStopped) this.needsReinit = true
		answer = this._stripThinkingTokens(answer)

		const generationTime = (Date.now() - startTime) / 1000
		this.conversationHistory.push({ timestamp: new Date().toISOString(), query: question, answer, sources: results, metadata: { model: this.modelId } })

		return {
			answer,
			sources: results,
			metadata: {
				numSources: results.length,
				searchType: 'hybrid',
				generationTime,
				model: this.modelId,
				temperature,
				retrieval: retrievalMetrics,
				scope: scopeMetadata,
				retrieval_time_ms: generationTime * 1000,
				wasStopped,
				contextLimited,
			},
		}
	}

	async queryStream(question: string, questionEmbedding: number[], onChunk: (chunk: string, full: string) => void, options: QueryOptions = {}): Promise<RAGResult> {
		await this.ensureEngineReady()
		await this._applyFreshConfig()

		const { numResults = this.numResults, temperature = this.temperature, maxTokens: rawMax = this.maxTokens, includeMetadata = true, metadataFields, similarityThreshold = this.similarityThreshold, allowedDocIds = null } = options
		let maxTokens = rawMax
		if (this.modelConstraints.hasThinkMode) maxTokens = Math.min(maxTokens * 3, this.modelConstraints.maxTokens[1])

		const allowedDocIdSet = this._normalizeDocScope(allowedDocIds)
		const scopeMetadata = allowedDocIdSet ? { type: 'doc_filter', size: allowedDocIdSet.size } : null
		const allowDoc = (c: unknown) =>
			!allowedDocIdSet ||
			((typeof c === 'string' || typeof c === 'number') && allowedDocIdSet.has(String(c)))
		const docFilter = allowedDocIdSet ? (m: Record<string, unknown>) => allowDoc(m?.doc_id ?? m?.id) : null

		const results = this.vectorSearch.search(questionEmbedding, numResults, { minScore: similarityThreshold, includeMetadata: true, filter: docFilter })
			.map(r => ({ ...r, text: r.text ?? (r.metadata?.text as string) ?? '' }))

		const { context, contextLimited } = this._buildContext(results, includeMetadata, metadataFields)
		const prompt = this._buildRAGPrompt(question, context)

		const completion = await this.engine.chat.completions.create({
			messages: [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: prompt }],
			temperature,
			max_tokens: maxTokens,
			top_p: this.topP,
			repetition_penalty: this.repeatPenalty,
			stream: true,
		})

		let visibleAnswer = ''
		let wasStopped = false
		const filter = this._createThinkFilter()
		for await (const chunk of completion) {
			if (this.shouldAbort) { wasStopped = true; break }
			const visible = filter.push(chunk.choices[0]?.delta?.content ?? '')
			visibleAnswer += visible
			if (visible) onChunk(visible, visibleAnswer)
		}
		visibleAnswer += filter.flush()
		visibleAnswer = this._stripThinkingTokens(visibleAnswer)

		return { answer: visibleAnswer, sources: results, metadata: { numSources: results.length, searchType: 'semantic', model: this.modelId, retrieval: {}, scope: scopeMetadata, wasStopped, contextLimited } }
	}

	private async _applyFreshConfig(): Promise<void> {
		const cfg = await this._loadSavedConfig()
		if (cfg.temperature != null) this.temperature = cfg.temperature
		if (cfg.max_tokens) this.maxTokens = cfg.max_tokens
		if (cfg.top_p != null) this.topP = cfg.top_p
		if (cfg.repeat_penalty != null) this.repeatPenalty = cfg.repeat_penalty
		if (cfg.num_results) this.numResults = cfg.num_results
		if (cfg.similarity_threshold != null) this.similarityThreshold = cfg.similarity_threshold
		if (cfg.retrieval_k != null) this.retrievalK = cfg.retrieval_k
		if (cfg.vector_weight != null) this.vectorWeight = cfg.vector_weight
		if (cfg.max_chunks_per_parent != null) this.maxChunksPerParent = cfg.max_chunks_per_parent
		if (cfg.system_prompt) this.systemPrompt = cfg.system_prompt
		if (cfg.user_template) this.userTemplate = cfg.user_template
	}

	private _createThinkFilter(): ThinkFilter {
		const isThinkModel = this.modelConstraints.hasThinkMode
		let buffer = ''
		let insideThink = false
		let thinkDone = false

		return {
			push(chunk: string): string {
				if (!isThinkModel || thinkDone) return chunk
				buffer += chunk
				if (!insideThink) {
					const start = buffer.indexOf('<think>')
					if (start !== -1) {
						insideThink = true
						const before = buffer.substring(0, start)
						buffer = buffer.substring(start + 7)
						if (before.trim()) { thinkDone = true; return before }
					} else if (buffer.length > 20) {
						thinkDone = true
						const out = buffer
						buffer = ''
						return out
					}
					return ''
				}
				const end = buffer.indexOf('</think>')
				if (end !== -1) {
					const after = buffer.substring(end + 8)
					buffer = ''
					thinkDone = true
					insideThink = false
					return after
				}
				return ''
			},
			flush(): string {
				const out = buffer
				buffer = ''
				return out
			},
		}
	}

	private _stripThinkingTokens(text: string): string {
		let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim()
		if (!cleaned && text.trim()) cleaned = text.replace(/<\/?think>/g, '').trim()
		return cleaned
	}

	private _fuseResults(vectorResults: SearchResult[], bm25Results: SearchResult[], options: { k?: number; vectorWeight?: number; topK?: number } = {}): SearchResult[] {
		const { k = 60, vectorWeight = 0.6, topK = 10 } = options
		const scoreMap = new Map<string, SearchResult & { vector_rank: number | null; bm25_rank: number | null }>()

		vectorResults.forEach((r, rank) => {
			const id = r.doc_id ?? r.metadata?.doc_id as string ?? r.id ?? ''
			if (!id) return
			scoreMap.set(id, { ...r, doc_id: id, vector_rank: rank, bm25_rank: null, bm25_score: null as any })
		})
		bm25Results.forEach((r, rank) => {
			const id = r.doc_id ?? r.metadata?.doc_id as string ?? r.id ?? ''
			if (!id) return
			const existing = scoreMap.get(id)
			if (existing) { existing.bm25_rank = rank; existing.bm25_score = r.score }
			else scoreMap.set(id, { ...r, doc_id: id, vector_rank: null as any, vector_score: null as any, bm25_rank: rank })
		})

		return Array.from(scoreMap.values())
			.map(e => {
				let rrf = 0
				if (e.vector_rank != null) rrf += vectorWeight * (1 / (k + e.vector_rank + 1))
				if (e.bm25_rank != null) rrf += (1 - vectorWeight) * (1 / (k + e.bm25_rank + 1))
				return { ...e, score: rrf, fusion_method: 'RRF' }
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
	}

	private _buildContext(results: SearchResult[], includeMetadata: boolean, metadataFields?: string[]): ContextResult {
		const maxCtx = this._calculateContextBudget()
		const parts: string[] = []
		let tokens = 0
		let contextLimited = false

		for (let i = 0; i < results.length; i++) {
			const r = results[i]
			const text = r.text ?? (r.metadata?.text as string) ?? ''
			let item = `[${i + 1}] ${text}`
			if (includeMetadata && r.metadata) {
				let entries = Object.entries(r.metadata).filter(([k]) => k !== 'text')
				if (metadataFields?.length) entries = entries.filter(([k]) => metadataFields.includes(k))
				const meta = entries.map(([k, v]) => `${k}: ${v}`).join(', ')
				if (meta) item += `\n   (${meta})`
			}
			const t = this._estimateTokens(item)
			if (tokens + t < maxCtx) { parts.push(item); tokens += t }
			else { contextLimited = true; break }
		}
		return { context: parts.join('\n\n'), contextLimited, tokensUsed: tokens, maxTokens: maxCtx }
	}

	private _buildChunkedContext(parentGroups: SearchResult[], includeMetadata: boolean, metadataFields?: string[]): ContextResult {
		const maxCtx = this._calculateContextBudget()
		const parts: string[] = []
		let tokens = 0
		let contextLimited = false
		const dynThreshold = maxCtx * 0.3
		const dynTarget = Math.floor(maxCtx * 0.15)

		for (let i = 0; i < parentGroups.length; i++) {
			const group = parentGroups[i]
			const chunks = group.chunks ?? []
			let parentCtx = `\n[Document ${i + 1}]`

			if (includeMetadata && chunks[0]?.metadata) {
				let entries = Object.entries(chunks[0].metadata).filter(([k]) => !k.startsWith('chunk_') && k !== 'parent_id' && k !== 'text')
				if (metadataFields?.length) entries = entries.filter(([k]) => metadataFields.includes(k))
				const meta = entries.map(([k, v]) => `${k}: ${v}`).join(', ')
				if (meta) parentCtx += `\n   Metadata: ${meta}`
			}
			parentCtx += '\n   Relevant passages:'

			for (const chunk of chunks) {
				const raw = chunk.text ?? (chunk.metadata?.text as string) ?? ''
				if (this._estimateTokens(raw) > dynThreshold && chunks.length === 1) {
					const dynChunks = this._dynamicChunk(raw, dynTarget)
					for (let j = 0; j < Math.min(dynChunks.length, 3); j++) {
						const txt = `\n   » ${dynChunks[j]}`
						const t = this._estimateTokens(txt)
						if (tokens + t < maxCtx) { parentCtx += txt; tokens += t }
						else { contextLimited = true; break }
					}
				} else {
					const txt = `\n   » ${raw}`
					const t = this._estimateTokens(txt)
					if (tokens + t < maxCtx) { parentCtx += txt; tokens += t }
					else { contextLimited = true; break }
				}
			}
			parts.push(parentCtx)
			if (tokens >= maxCtx) { contextLimited = true; break }
		}
		return { context: parts.join('\n\n'), contextLimited, tokensUsed: tokens, maxTokens: maxCtx }
	}

	private _buildRAGPrompt(question: string, context: string): string {
		return this.userTemplate.replace('{context}', context).replace('{question}', question)
	}

	private _groupChunksByParent(chunkResults: SearchResult[], topK: number, maxChunksPerParent: number): SearchResult[] {
		const groups = new Map<string, SearchResult & { chunks: SearchResult[]; maxScore: number }>()

		chunkResults.forEach(chunk => {
			const parentId = (chunk.metadata?.parent_id as string) ?? chunk.parent_id ?? chunk.doc_id ?? ''
			if (!groups.has(parentId)) {
				groups.set(parentId, { doc_id: parentId, parent_id: parentId, chunks: [], maxScore: 0, score: 0, metadata: {} })
			}
			const g = groups.get(parentId)!
			g.chunks.push(chunk)
			g.maxScore = Math.max(g.maxScore, chunk.score)
		})

		groups.forEach(g => {
			g.chunks.sort((a, b) => b.score - a.score)
			if (g.chunks.length > maxChunksPerParent) g.chunks = g.chunks.slice(0, maxChunksPerParent)
			g.score = g.maxScore
			g.chunks.sort((a, b) => ((a.metadata?.chunk_index as number) ?? 0) - ((b.metadata?.chunk_index as number) ?? 0))
			if (g.chunks[0]) {
				g.metadata = {}
				Object.entries(g.chunks[0].metadata ?? {}).forEach(([k, v]) => { if (!k.startsWith('chunk_') && k !== 'parent_id') (g.metadata!)[k] = v })
				const parentDoc = this.vectorSearch.getDocument?.(g.doc_id!)
				if (parentDoc?.metadata) {
					g.text = (parentDoc.metadata.text as string) ?? ''
					g.metadata = { ...parentDoc.metadata, ...g.metadata }
				}
				if (!g.text) g.text = g.chunks.map(c => c.text ?? (c.metadata?.text as string) ?? '').join(' ')
			}
		})

		return Array.from(groups.values()).sort((a, b) => b.maxScore - a.maxScore).slice(0, topK)
	}

	private _estimateTokens(text: string): number { return Math.ceil(text.length / 3.5 * 1.1) }

	private _calculateContextBudget(): number {
		const window = this.maxContextLength || 2048
		return Math.max(500, window - this._estimateTokens(this.systemPrompt) - 150 - (this.maxTokens || 768))
	}

	private _normalizeDocScope(ids: string[] | Set<string> | string | null | undefined): Set<string> | null {
		if (!ids) return null
		if (ids instanceof Set) return new Set(Array.from(ids).map(String))
		if (Array.isArray(ids)) return new Set(ids.map(String))
		return new Set([ids])
	}

	private _dynamicChunk(text: string, targetTokens: number): string[] {
		const chars = targetTokens * 3.5
		const overlap = Math.floor(chars * 0.15)
		const chunks: string[] = []
		for (let i = 0; i < text.length; i += chars - overlap) {
			const chunk = text.slice(i, i + chars).trim()
			if (chunk) chunks.push(chunk)
		}
		return chunks
	}

	async resetContext(): Promise<void> {
		if (this.isInitialized) await this.engine.resetChat()
	}

	getStats() { return { modelId: this.modelId, isInitialized: this.isInitialized, maxContextLength: this.maxContextLength } }
	setChunkVectorSearch(cs: VectorSearch) { this.chunkVectorSearch = cs }
	setBM25Search(bs: BM25Search) { this.bm25Search = bs }
	clearConversationHistory() { this.conversationHistory = [] }
	getConversationLength() { return this.conversationHistory.length }
}
