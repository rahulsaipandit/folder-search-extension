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

const MODEL_NAME = 'Xenova/multilingual-e5-small'
const DIMENSION = 384

let embedder: Awaited<ReturnType<typeof pipeline>> | null = null
let isInitialized = false
let activeDevice: 'webgpu' | 'cpu' | null = null

function isWebGPUAvailable(): boolean {
	try { return typeof navigator !== 'undefined' && 'gpu' in navigator } catch { return false }
}

function resolveDevice(pref: string): 'webgpu' | 'cpu' {
	if (pref === 'cpu' || pref === 'wasm') return 'cpu'
	return isWebGPUAvailable() ? 'webgpu' : 'cpu'
}

async function initializeModel(devicePreference = 'auto'): Promise<void> {
	const target = resolveDevice(devicePreference)
	if (embedder && isInitialized && activeDevice === target) {
		self.postMessage({ type: 'init_complete', device: activeDevice }); return
	}

	self.postMessage({ type: 'init_start', targetDevice: target })

	const options: Record<string, unknown> = {}
	if (target === 'webgpu') options.device = 'webgpu'
	else options.device = 'wasm'

	const fileProgress = new Map<string, number>()
	const fileWeights: Record<string, number> = { 'tokenizer_config.json': 0.02, 'config.json': 0.02, 'tokenizer.json': 0.10, 'onnx/model.onnx': 0.86 }
	const fileBytesLoaded = new Map<string, number>()
	const fileBytesTotal = new Map<string, number>()
	let lastProg = 0

	const computeProgress = () => {
		let w = 0, wt = 0
		for (const [f, weight] of Object.entries(fileWeights)) { w += (fileProgress.get(f) ?? 0) * weight; wt += weight }
		fileProgress.forEach((v, f) => { if (!(f in fileWeights)) { w += v * 0.05; wt += 0.05 } })
		const p = wt ? w / wt : 0
		if (p > lastProg) lastProg = p
		return lastProg
	}

	options.progress_callback = (progress: any) => {
		const { file, status, loaded, total } = progress
		if (!file || (status !== 'progress' && status !== 'done')) return
		if (typeof loaded === 'number') fileBytesLoaded.set(file, loaded)
		if (typeof total === 'number' && total > 0) fileBytesTotal.set(file, total)
		const cur = fileProgress.get(file) ?? 0
		const updated = status === 'done' ? 1 : (typeof loaded === 'number' && typeof total === 'number' && total > 0 ? Math.max(cur, loaded / total) : cur)
		fileProgress.set(file, Math.min(1, Math.max(0, updated)))
		const overall = computeProgress()
		let tl = 0, ts = 0
		fileBytesLoaded.forEach(b => tl += b)
		fileBytesTotal.forEach(b => ts += b)
		self.postMessage({ type: 'init_progress', progress: overall, file, fileStatus: status, loaded: tl, total: ts })
	}

	const tryInit = async (opts: Record<string, unknown>): Promise<void> => {
		if (target === 'webgpu' && (navigator as any).gpu) {
			try { await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' }) } catch {}
		}
		embedder = await pipeline('feature-extraction', MODEL_NAME, opts as any)
		isInitialized = true
		activeDevice = opts.device === 'webgpu' ? 'webgpu' : 'cpu'
		self.postMessage({ type: 'init_complete', device: activeDevice, modelName: MODEL_NAME, dimension: DIMENSION })
	}

	try {
		await tryInit(options)
	} catch (err) {
		if (target === 'webgpu') {
			self.postMessage({ type: 'warning', message: 'WebGPU init failed, falling back to CPU' })
			try { await tryInit({ device: 'wasm', progress_callback: options.progress_callback }) }
			catch (e2) { self.postMessage({ type: 'error', error: `CPU fallback failed: ${(e2 as Error).message}` }) }
		} else {
			self.postMessage({ type: 'error', error: `Init failed: ${(err as Error).message}` })
		}
	}
}

async function embedBatch(texts: string[], options: { normalize?: boolean; pooling?: string; maxLength?: number; mode?: string; batchId?: string | null } = {}): Promise<void> {
	if (!isInitialized || !embedder) { self.postMessage({ type: 'error', error: 'Model not initialized', batchId: options.batchId }); return }

	const { normalize = true, pooling = 'mean', maxLength = 256, mode = 'passage', batchId = null } = options
	try {
		const prefix = mode === 'query' ? 'query: ' : 'passage: '
		const prepared = texts.map(t => t ? `${prefix}${t}` : '')
		const output = await (embedder as any)(prepared, { pooling, normalize, max_length: maxLength, truncate: true })
		const result: number[][] = []
		for (let j = 0; j < texts.length; j++) {
			result.push(Array.from(output.data.slice(j * DIMENSION, (j + 1) * DIMENSION)))
		}
		self.postMessage({ type: 'embed_complete', embeddings: result, batchId, device: activeDevice })
	} catch (err) {
		self.postMessage({ type: 'error', error: `Embedding failed: ${(err as Error).message}`, batchId })
	}
}

self.addEventListener('message', async (e: MessageEvent) => {
	const { type, ...data } = e.data
	switch (type) {
		case 'init': await initializeModel(data.devicePreference); break
		case 'embed': await embedBatch(data.texts, { normalize: data.normalize, pooling: data.pooling, maxLength: data.maxLength, mode: data.mode, batchId: data.batchId }); break
		case 'ping': self.postMessage({ type: 'pong' }); break
		default: self.postMessage({ type: 'error', error: `Unknown message type: ${type}` })
	}
})

self.postMessage({ type: 'ready' })
