/**
 * @warning Do NOT import/call this from the side panel, a content script, or any
 * extension page other than the offscreen document. `initialize()`/`embed()` load a
 * Worker + WASM/WebGPU runtime that the manifest's `content_security_policy`
 * (`wxt.config.js`) blocks (`worker-src`/`script-src`) outside the offscreen doc's
 * same-origin bundle. Call `offscreenEmbed()` from `browser-ml/offscreen-bridge.ts`
 * instead - it message-passes into `entrypoints/offscreen/main.ts`, where this class
 * is actually meant to run. See AGENTS.md > "On-device ML" for the full pattern.
 */
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

try {
	const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
	if (env.backends?.onnx?.wasm) {
		;(env.backends.onnx.wasm as any).numThreads = cores
		;(env.backends.onnx.wasm as any).simd = true
		;(env.backends.onnx.wasm as any).proxy = false
	}
} catch (_) {}

type DevicePreference = 'auto' | 'webgpu' | 'cpu'

interface EmbedOptions {
	normalize?: boolean
	pooling?: string
	maxLength?: number
	mode?: 'passage' | 'query'
	useCache?: boolean
	onProgress?: ((p: EmbedProgressEvent) => void) | null
}

interface EmbedProgressEvent {
	stage: string
	status: string
	progress: number
	batch?: number
	totalBatches?: number
	processed?: number
	total?: number
	elapsed?: number
	speed?: number
	mode?: string
	device?: string
}

export class BrowserEmbeddings {
	readonly modelName = 'Xenova/multilingual-e5-small'
	private embedder: Awaited<ReturnType<typeof pipeline>> | null = null
	readonly dimension = 384
	private cache = new Map<string, Float32Array>()
	private cacheMaxSize = 5000
	private _cacheInsertionOrder: string[] = []
	isInitialized = false
	activeDevice: 'webgpu' | 'cpu' | null = null
	devicePreference: DevicePreference = 'auto'
	private batchSize = 32
	private defaultMaxLength = 256

	// Worker-based embedding for background execution
	private worker: Worker | null = null
	private workerReady = false
	private workerPendingMessages = new Map<string, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>()
	private _nextRequestId = 0

	private _isWebGPUAvailable(): boolean {
		try { return typeof navigator !== 'undefined' && 'gpu' in navigator } catch { return false }
	}

	private _resolveDeviceTarget(): 'webgpu' | 'cpu' {
		if (this.devicePreference === 'cpu') return 'cpu'
		return this._isWebGPUAvailable() ? 'webgpu' : 'cpu'
	}

	private _normalizeText(text: string): string {
		if (!text) return ''
		const s = String(text)
		if (s.indexOf('  ') === -1 && s[0] !== ' ' && s[s.length - 1] !== ' ') return s
		return s.replace(/\s+/g, ' ').trim()
	}

	private _cacheKeyForText(text: string, mode: string): string {
		return `${mode}::${text}`
	}

	private _cacheSet(key: string, value: Float32Array): void {
		if (this.cache.has(key)) { this.cache.set(key, value); return }
		if (this.cache.size >= this.cacheMaxSize) {
			const evict = this._cacheInsertionOrder.splice(0, Math.max(1, Math.floor(this.cacheMaxSize * 0.1)))
			for (const k of evict) this.cache.delete(k)
		}
		this.cache.set(key, value)
		this._cacheInsertionOrder.push(key)
	}

	async initialize(onProgress?: ((p: { status: string; progress?: number; file?: string; loaded?: number; total?: number }) => void) | null): Promise<void> {
		if (this.workerReady && this.worker) return

		// Prefer worker execution (avoids blocking offscreen doc main thread)
		if (typeof Worker !== 'undefined') {
			try {
				await this._initializeWorker(onProgress ?? null)
				return
			} catch (err) {
				console.warn('Worker init failed, falling back to main thread:', err)
				this.worker = null
				this.workerReady = false
			}
		}

		// Main thread fallback
		if (this.isInitialized && this.embedder && this.activeDevice === this._resolveDeviceTarget()) return
		await this._ensureEmbedderReady(onProgress ?? null)
	}

	private async _ensureEmbedderReady(onProgress: ((p: any) => void) | null): Promise<void> {
		const target = this._resolveDeviceTarget()
		this.isInitialized = false
		const options: Record<string, unknown> = { device: target === 'webgpu' ? 'webgpu' : 'wasm' }

		if (onProgress) {
			const fileProgress = new Map<string, number>()
			const fileWeights: Record<string, number> = { 'tokenizer_config.json': 0.02, 'config.json': 0.02, 'tokenizer.json': 0.10, 'onnx/model.onnx': 0.86 }
			const fileBytesLoaded = new Map<string, number>()
			const fileBytesTotal = new Map<string, number>()
			let last = 0

			options.progress_callback = (p: any) => {
				if (!p.file || (p.status !== 'progress' && p.status !== 'done')) return
				if (typeof p.loaded === 'number') fileBytesLoaded.set(p.file, p.loaded)
				if (typeof p.total === 'number' && p.total > 0) fileBytesTotal.set(p.file, p.total)
				const cur = fileProgress.get(p.file) ?? 0
				const updated = p.status === 'done' ? 1 : (typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0 ? Math.max(cur, p.loaded / p.total) : cur)
				fileProgress.set(p.file, Math.min(1, Math.max(0, updated)))
				let w = 0, wt = 0
				for (const [f, weight] of Object.entries(fileWeights)) { w += (fileProgress.get(f) ?? 0) * weight; wt += weight }
				fileProgress.forEach((v, f) => { if (!(f in fileWeights)) { w += v * 0.05; wt += 0.05 } })
				const overall = wt ? Math.max(last, w / wt) : 0
				last = overall
				let tl = 0, ts = 0
				fileBytesLoaded.forEach(b => tl += b)
				fileBytesTotal.forEach(b => ts += b)
				onProgress({ status: 'loading', progress: overall, file: p.file, loaded: tl, total: ts })
			}
		}

		try {
			if (target === 'webgpu' && (navigator as any).gpu) {
				try { await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' }) } catch {}
			}
			this.embedder = await pipeline('feature-extraction', this.modelName, options as any)
			this.isInitialized = true
			this.activeDevice = target
		} catch (initErr) {
			if (target === 'webgpu') {
				try {
					const cpuOpts: any = { device: 'wasm' }
					if (options.progress_callback) cpuOpts.progress_callback = options.progress_callback
					this.embedder = await pipeline('feature-extraction', this.modelName, cpuOpts)
					this.isInitialized = true
					this.activeDevice = 'cpu'
				} catch (e2) { throw new Error(`Embeddings init failed: ${(e2 as Error).message}`) }
			} else { throw initErr }
		}
	}

	async embed(texts: string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
		const { normalize = true, pooling = 'mean', maxLength = this.defaultMaxLength, mode = 'passage', useCache = true, onProgress = null } = options
		const embeddingMode = mode === 'query' ? 'query' : 'passage'

		if (this.workerReady && this.worker) return this._embedWithWorker(texts, { normalize, pooling, maxLength, mode: embeddingMode })

		await this._ensureEmbedderReady(null)
		if (!this.isInitialized || !this.embedder) throw new Error('Embeddings model not initialized')

		const result = new Array<Float32Array>(texts.length)
		const itemsToEmbed: { idx: number; normalized: string; cacheKey: string }[] = []
		const seenInBatch = new Map<string, number[]>()
		const normalizedTexts = texts.map(t => this._normalizeText(t))
		const cacheKeys = normalizedTexts.map(t => this._cacheKeyForText(t, embeddingMode))
		const prefix = embeddingMode === 'query' ? 'query: ' : 'passage: '

		for (let i = 0; i < texts.length; i++) {
			const normalized = normalizedTexts[i]
			const cacheKey = cacheKeys[i]
			if (!normalized) { result[i] = new Float32Array(this.dimension); continue }
			if (useCache && this.cache.has(cacheKey)) { result[i] = this.cache.get(cacheKey)!; continue }
			if (seenInBatch.has(cacheKey)) { seenInBatch.get(cacheKey)!.push(i); continue }
			seenInBatch.set(cacheKey, [i])
			itemsToEmbed.push({ idx: i, normalized, cacheKey })
		}

		if (!itemsToEmbed.length) return result

		const batches: typeof itemsToEmbed[] = []
		for (let i = 0; i < itemsToEmbed.length; i += this.batchSize) batches.push(itemsToEmbed.slice(i, i + this.batchSize))
		let processed = 0
		const startTime = performance.now()

		for (let b = 0; b < batches.length; b++) {
			const group = batches[b]
			const batch = group.map(x => `${prefix}${x.normalized}`)
			const output = await (this.embedder as any)(batch, { pooling, normalize, max_length: maxLength, truncate: true })

			for (let j = 0; j < group.length; j++) {
				const start = j * this.dimension
				const emb = new Float32Array(output.data.slice(start, start + this.dimension))
				const { idx, cacheKey } = group[j]
				result[idx] = emb
				if (useCache) this._cacheSet(cacheKey, emb)
				const dups = seenInBatch.get(cacheKey)
				if (dups && dups.length > 1) for (const d of dups) if (d !== idx) result[d] = emb
			}

			processed += group.length
			if (onProgress) {
				const elapsed = (performance.now() - startTime) / 1000
				onProgress({ stage: 'embedding', status: 'batch_complete', progress: processed / itemsToEmbed.length, batch: b + 1, totalBatches: batches.length, processed, total: itemsToEmbed.length, elapsed, speed: elapsed > 0 ? processed / elapsed : 0, mode: embeddingMode, device: this.activeDevice ?? 'unknown' })
			}
		}

		return result
	}

	async embedSingle(text: string, options: { mode?: 'passage' | 'query' } & EmbedOptions = {}): Promise<Float32Array> {
		const embs = await this.embed([text], options)
		return embs[0]
	}

	private async _initializeWorker(onProgress: ((p: any) => void) | null): Promise<void> {
		return new Promise((resolve, reject) => {
			this.worker = new Worker(new URL('./embedding-worker.ts', import.meta.url), { type: 'module' })

			this.worker.onmessage = (e: MessageEvent) => {
				const { type, ...data } = e.data
				switch (type) {
					case 'ready': this.worker!.postMessage({ type: 'init', devicePreference: this.devicePreference }); break
					case 'init_progress': onProgress?.({ status: 'loading', progress: data.progress ?? 0, file: data.file, loaded: data.loaded, total: data.total }); break
					case 'init_complete':
						this.workerReady = true; this.isInitialized = true; this.activeDevice = data.device
						onProgress?.({ status: 'loading', progress: 1 })
						resolve(); break
					case 'embed_complete': {
						const pending = this.workerPendingMessages.get(data.batchId)
						if (pending) { this.workerPendingMessages.delete(data.batchId); pending.resolve(data.embeddings) }; break
					}
					case 'error': {
						const pending = this.workerPendingMessages.get(data.batchId)
						if (pending) { this.workerPendingMessages.delete(data.batchId); pending.reject(new Error(data.error)) }
						else reject(new Error(data.error)); break
					}
				}
			}

			this.worker.onerror = err => reject(err)
		})
	}

	private async _embedWithWorker(texts: string[], options: { normalize?: boolean; pooling?: string; maxLength?: number; mode?: string }): Promise<Float32Array[]> {
		if (!this.workerReady || !this.worker) throw new Error('Worker not ready')
		const { normalize = true, pooling = 'mean', maxLength = this.defaultMaxLength, mode = 'passage' } = options

		const result = new Array<Float32Array>(texts.length)
		const itemsToEmbed: { idx: number; normalized: string; cacheKey: string }[] = []
		const seenInBatch = new Map<string, number[]>()
		const normalizedTexts = texts.map(t => this._normalizeText(t))
		const cacheKeys = normalizedTexts.map(t => this._cacheKeyForText(t, mode))

		for (let i = 0; i < texts.length; i++) {
			const normalized = normalizedTexts[i]
			const cacheKey = cacheKeys[i]
			if (!normalized) { result[i] = new Float32Array(this.dimension); continue }
			if (this.cache.has(cacheKey)) { result[i] = this.cache.get(cacheKey)!; continue }
			if (seenInBatch.has(cacheKey)) { seenInBatch.get(cacheKey)!.push(i); continue }
			seenInBatch.set(cacheKey, [i])
			itemsToEmbed.push({ idx: i, normalized, cacheKey })
		}

		if (!itemsToEmbed.length) return result

		const batches: typeof itemsToEmbed[] = []
		for (let i = 0; i < itemsToEmbed.length; i += this.batchSize) batches.push(itemsToEmbed.slice(i, i + this.batchSize))

		for (const group of batches) {
			const batchTexts = group.map(x => x.normalized)
			const batchId = `batch_${this._nextRequestId++}`
			const batchEmbeddings = await new Promise<number[][]>((resolve, reject) => {
				const timeout = setTimeout(() => { this.workerPendingMessages.delete(batchId); reject(new Error('TIMEOUT')) }, 45000)
				this.workerPendingMessages.set(batchId, {
					resolve: v => { clearTimeout(timeout); resolve(v) },
					reject: e => { clearTimeout(timeout); reject(e) },
				})
				this.worker!.postMessage({ type: 'embed', texts: batchTexts, normalize, pooling, maxLength, mode, batchId })
			})

			for (let j = 0; j < batchEmbeddings.length; j++) {
				const emb = new Float32Array(batchEmbeddings[j])
				const { idx, cacheKey } = group[j]
				result[idx] = emb
				this._cacheSet(cacheKey, emb)
				const dups = seenInBatch.get(cacheKey)
				if (dups && dups.length > 1) for (const d of dups) if (d !== idx) result[d] = emb
			}
		}

		return result
	}

	clearCache(): void { this.cache.clear(); this._cacheInsertionOrder = [] }

	getDeviceStatus() {
		return { webgpuAvailable: this._isWebGPUAvailable(), activeDevice: this.activeDevice ?? 'not initialized', devicePreference: this.devicePreference, isUsingGPU: this.activeDevice === 'webgpu', initialized: this.isInitialized }
	}

	static cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) throw new Error('Embeddings must have same dimension')
		let dot = 0, n1 = 0, n2 = 0
		for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; n1 += a[i] * a[i]; n2 += b[i] * b[i] }
		return dot / (Math.sqrt(n1) * Math.sqrt(n2))
	}
}

export const embeddings = new BrowserEmbeddings()
