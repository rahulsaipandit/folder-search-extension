/**
 * @warning Offscreen document only (same rule as `embeddings.ts`): this loads ONNX Runtime
 * WASM/WebGPU, which the manifest CSP blocks outside the offscreen document. Side-panel code must
 * go through `folder-search/bridge.ts`. See AGENTS.md > "On-device ML".
 *
 * EmbeddingGemma 2 (onnx-community/embeddinggemma-2-ONNX): one 768-d space for text, images,
 * audio and video. Encoders are loaded selectively (design §3.2). Text goes through the tokenizer
 * and media through the processor; both feed the same `AutoModel`, whose `sentence_embedding`
 * output is truncated (Matryoshka) and re-normalized here.
 *
 * API usage follows the model card (fetched 2026-10-18). It has not been exercised in a real
 * browser from this repo's automated tests.
 */
import { AutoConfig, AutoModel, AutoProcessor, AutoTokenizer, RawVideo, env } from '@huggingface/transformers'

import { FAKE_EMBEDDER_ENABLED, FAKE_MODEL_CACHE, fakeEmbedText } from '@/folder-search/fakeEmbedder'
import { MAX_BATCH_TOKENS, planBatches } from '@/folder-search/batching'
import { componentDtype } from '@/folder-search/modelCatalog'
import { truncateAndNormalize } from '@/folder-search/ranking'
import type { ModelDtype } from '@/folder-search/types'

env.allowLocalModels = false
env.useBrowserCache = true

/**
 * ONNX Runtime must load from the packed extension, not a CDN. By default transformers.js points
 * `wasmPaths` at jsdelivr and re-wraps the loader as a `blob:` URL, and the manifest CSP
 * (`script-src 'self' 'wasm-unsafe-eval'`) blocks both ("Failed to fetch dynamically imported
 * module: blob:..."). The files are copied to `public/ort/` by `copyOrtAssets` in wxt.config.js.
 * `useWasmCache = false` stops the blob re-wrapping so ORT imports the same-origin file directly.
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && env.backends.onnx?.wasm) {
	const base = chrome.runtime.getURL('ort/')
	env.backends.onnx.wasm.wasmPaths = {
		mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
		wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
	}
	env.useWasmCache = false
	// Extension pages are not cross-origin isolated, so SharedArrayBuffer threads are unavailable anyway.
	env.backends.onnx.wasm.numThreads = 1
}

export const GEMMA_MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX'
export const FULL_DIM = 768

/**
 * Every model call must stay under ~2,700 tokens (see `folder-search/batching.ts`). Text batches
 * are planned from real token counts; a single sequence is truncated to this length, well below it.
 */
const MAX_TEXT_TOKENS = 1024
/**
 * Soft tokens per image, set explicitly because the processor default is not guaranteed to be
 * small (the card allows up to 1,120 per image). 4 images × 280 = 1,120 tokens per call.
 */
const IMAGE_SOFT_TOKENS = 280
const IMAGE_BATCH = Math.max(1, Math.floor(MAX_BATCH_TOKENS / IMAGE_SOFT_TOKENS / 2))
/** A video frame costs ~140 tokens (model card), so 16 frames = 2,240, under the budget. */
const VIDEO_FRAMES_PER_CALL = 16

export interface GemmaLoadOptions {
	vision: boolean
	audio: boolean
	dtype: ModelDtype
	device: 'webgpu' | 'wasm'
	onProgress?: (e: DownloadEvent) => void
}

export interface DownloadEvent {
	file: string
	loaded: number
	total: number
	status: string
}

export type MediaInput = unknown // transformers.js RawImage / Float32Array / RawVideo

export function isWebGPUAvailable(): boolean {
	try {
		return typeof navigator !== 'undefined' && 'gpu' in navigator
	} catch {
		return false
	}
}

/**
 * Checks that WebGPU actually works, not just that `navigator.gpu` exists: browsers expose the
 * object on machines where no adapter can be created (blocked or unsupported GPU).
 */
export async function probeWebGPU(): Promise<{ available: boolean; reason: string | null }> {
	const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<object | null> } }).gpu
	if (!gpu) return { available: false, reason: 'This browser does not expose WebGPU (navigator.gpu is missing).' }
	try {
		return (await gpu.requestAdapter())
			? { available: true, reason: null }
			: { available: false, reason: 'No WebGPU adapter was found. The GPU may be unsupported or blocked.' }
	} catch (e) {
		return { available: false, reason: `WebGPU could not start: ${e instanceof Error ? e.message : String(e)}` }
	}
}

function configKey(o: GemmaLoadOptions): string {
	return `${o.dtype}|${o.vision}|${o.audio}|${o.device}`
}

export class GemmaEmbedder {
	private model: any = null
	private tokenizer: any = null
	private processor: any = null
	private loadedKey: string | null = null
	private loading: Promise<void> | null = null
	/** Serializes GPU work: two model calls must never run at once (design §5.7). */
	private chain: Promise<unknown> = Promise.resolve()
	device: 'webgpu' | 'wasm' | null = null
	hasVision = false
	hasAudio = false

	get isLoaded(): boolean {
		return this.model !== null
	}

	async load(options: GemmaLoadOptions): Promise<void> {
		const key = configKey(options)
		if (this.loadedKey === key && this.model) return
		if (this.loading) await this.loading
		if (this.loadedKey === key && this.model) return
		this.loading = this.doLoad(options, key).finally(() => (this.loading = null))
		return this.loading
	}

	private async doLoad(options: GemmaLoadOptions, key: string): Promise<void> {
		await this.unload()
		if (FAKE_EMBEDDER_ENABLED) {
			// E2E build only: no weights, tokenizer or ONNX runtime (see folder-search/fakeEmbedder.ts).
			await (await caches.open(FAKE_MODEL_CACHE)).put('https://e2e.invalid/fake-model', new Response('fake'))
			this.model = {}
			this.device = 'wasm'
			this.hasVision = options.vision
			this.hasAudio = options.audio
			this.loadedKey = key
			return
		}
		const progress_callback = (e: any) => {
			if (e?.file && options.onProgress) {
				options.onProgress({
					file: String(e.file),
					loaded: Number(e.loaded ?? 0),
					total: Number(e.total ?? 0),
					status: String(e.status ?? ''),
				})
			}
		}
		const config: any = await AutoConfig.from_pretrained(GEMMA_MODEL_ID, { progress_callback })
		if (!options.vision) config.vision_config = null
		if (!options.audio) config.audio_config = null
		this.tokenizer = await AutoTokenizer.from_pretrained(GEMMA_MODEL_ID, { progress_callback })
		this.model = await (AutoModel as any).from_pretrained(GEMMA_MODEL_ID, {
			config,
			device: options.device,
			dtype: {
				model: componentDtype(options.dtype, 'text'),
				...(options.vision ? { vision_encoder: componentDtype(options.dtype, 'vision') } : {}),
				// Audio is always q8, whatever the others use (model card: audio suffers most from quantization).
				...(options.audio ? { audio_encoder: componentDtype(options.dtype, 'audio') } : {}),
			},
			progress_callback,
		})
		if (options.vision || options.audio) {
			this.processor = await AutoProcessor.from_pretrained(GEMMA_MODEL_ID, { progress_callback })
			// Bounds per-image tokens so image batches obey the dispatch limit (see IMAGE_SOFT_TOKENS).
			this.processor.image_processor.max_soft_tokens = IMAGE_SOFT_TOKENS
		}
		this.device = options.device
		this.hasVision = options.vision
		this.hasAudio = options.audio
		this.loadedKey = key
	}

	async unload(): Promise<void> {
		try {
			await this.model?.dispose?.()
		} catch (e) {
			console.warn('[folder-search] model dispose failed', e)
		}
		this.model = this.tokenizer = this.processor = null
		this.loadedKey = null
		this.device = null
		this.hasVision = this.hasAudio = false
	}

	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(fn, fn)
		this.chain = run.catch(() => undefined)
		return run
	}

	/** Token count after truncation, as the model will actually see it. */
	private countTokens(text: string): number {
		const ids = this.tokenizer(text, { truncation: true, max_length: MAX_TEXT_TOKENS }).input_ids
		return Number(ids.dims?.[ids.dims.length - 1] ?? ids.size ?? MAX_TEXT_TOKENS)
	}

	private requireModel(): void {
		if (!this.model) throw new Error('Embedding model is not loaded. Download and load it first.')
	}

	/** Text is already prefixed by the caller (`buildQueryInput` / `buildDocumentInput`). */
	embedTexts(texts: string[], dim: number): Promise<Float32Array[]> {
		return this.enqueue(async () => {
			this.requireModel()
			if (FAKE_EMBEDDER_ENABLED) return texts.map(t => fakeEmbedText(t, dim))
			const out: Float32Array[] = new Array(texts.length)
			// Real token counts (a chars-per-token guess undercounts CJK and code), batched
			// longest-first so padded size stays under the WebGPU dispatch limit.
			const lengths = texts.map(t => this.countTokens(t))
			for (const idx of planBatches(lengths)) {
				const inputs = this.tokenizer(
					idx.map(j => texts[j]),
					{ padding: true, truncation: true, max_length: MAX_TEXT_TOKENS }
				)
				const { sentence_embedding } = await this.model(inputs)
				idx.forEach((j, n) => (out[j] = rowOf(sentence_embedding, n, dim)))
			}
			return out
		})
	}

	/** `images` are transformers.js `RawImage`s, already resized by the caller. */
	embedImages(images: MediaInput[], dim: number): Promise<Float32Array[]> {
		return this.enqueue(async () => {
			this.requireModel()
			if (!this.hasVision) throw new Error('Vision encoder is not loaded.')
			if (FAKE_EMBEDDER_ENABLED) throw new Error('Image embedding is not supported by the E2E fake embedder.')
			const out: Float32Array[] = []
			// One image per call on WASM: a batch of 9 ran out of WASM memory (std::bad_alloc) in a
			// published WebGPU/WASM comparison (tpiros.dev, 2026).
			const step = this.device === 'wasm' ? 1 : IMAGE_BATCH
			for (let i = 0; i < images.length; i += step) {
				// One inner list per image: a flat list would blend all images into a single vector.
				const batch = images.slice(i, i + step).map(img => [img])
				const inputs = await this.processor(null, batch)
				const { sentence_embedding } = await this.model(inputs)
				for (let n = 0; n < batch.length; n++) out.push(rowOf(sentence_embedding, n, dim))
			}
			return out
		})
	}

	/**
	 * One call per video segment (design §14.5). `frames` are evenly spaced across `duration`
	 * seconds; at most 16 so a call stays under the token budget (16 × ~140 tokens). A flat list of
	 * videos is one sample per item, so each segment yields exactly one vector.
	 */
	embedVideos(segments: { frames: MediaInput[]; duration: number }[], dim: number): Promise<Float32Array[]> {
		return this.enqueue(async () => {
			this.requireModel()
			if (!this.hasVision) throw new Error('Vision encoder is not loaded.')
			if (FAKE_EMBEDDER_ENABLED) throw new Error('Video embedding is not supported by the E2E fake embedder.')
			const out: Float32Array[] = []
			for (const seg of segments) {
				if (seg.frames.length > VIDEO_FRAMES_PER_CALL) {
					throw new Error(`A video segment has ${seg.frames.length} frames; the limit is ${VIDEO_FRAMES_PER_CALL}`)
				}
				const video = new RawVideo(seg.frames as ConstructorParameters<typeof RawVideo>[0], seg.duration)
				const inputs = await this.processor(null, null, null, [video])
				const { sentence_embedding } = await this.model(inputs)
				out.push(rowOf(sentence_embedding, 0, dim))
			}
			return out
		})
	}

	/** `windows` are mono 16 kHz Float32Arrays. */
	embedAudio(windows: Float32Array[], dim: number): Promise<Float32Array[]> {
		return this.enqueue(async () => {
			this.requireModel()
			if (!this.hasAudio) throw new Error('Audio encoder is not loaded.')
			if (FAKE_EMBEDDER_ENABLED) throw new Error('Audio embedding is not supported by the E2E fake embedder.')
			const out: Float32Array[] = []
			for (const w of windows) {
				const inputs = await this.processor(null, null, w)
				const { sentence_embedding } = await this.model(inputs)
				out.push(rowOf(sentence_embedding, 0, dim))
			}
			return out
		})
	}
}

function rowOf(tensor: any, row: number, dim: number): Float32Array {
	const full = tensor.dims?.[1] ?? FULL_DIM
	const data = tensor.data as Float32Array
	return truncateAndNormalize(data.subarray(row * full, row * full + full), dim)
}

export const gemma = new GemmaEmbedder()
