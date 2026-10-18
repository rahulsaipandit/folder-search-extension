/**
 * Model status / download / remove, running in the offscreen document (design §3.3, §4A.2 Screen
 * 2-3). Weights are cached by transformers.js in Cache Storage; "cached" means every file of that
 * component finished downloading (entries are only stored once complete).
 *
 * WebGPU is required (design §14.5): q4/q8 do not run on the WASM backend. The fp16 CPU path is
 * used only after the user explicitly approved it (`settings.cpuFallbackApproved`).
 */
import { GEMMA_MODEL_ID, gemma, probeWebGPU } from '@/browser-ml/gemma-embeddings'

import { FAKE_EMBEDDER_ENABLED, FAKE_MODEL_CACHE } from './fakeEmbedder'
import {
	type ComponentProgress,
	type DownloadSnapshot,
	type ModelComponent,
	type ModelStatus,
	WEBGPU_UNAVAILABLE,
	aggregateProgress,
	fileMatchesComponentDtype,
} from './modelCatalog'
import { loadFolderSearchSettings } from './settings'
import type { ModelSelection } from './types'

const CACHE_NAME = 'transformers-cache'

let snapshot: DownloadSnapshot = { phase: 'idle', components: {} }
const listeners = new Set<(s: DownloadSnapshot) => void>()

export function onDownloadProgress(fn: (s: DownloadSnapshot) => void): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}
export function currentDownload(): DownloadSnapshot {
	return snapshot
}
function publish(next: DownloadSnapshot): void {
	snapshot = next
	for (const fn of listeners) fn(next)
}

async function cachedModelRequests(): Promise<Request[]> {
	if (typeof caches === 'undefined') return []
	const cache = await caches.open(CACHE_NAME)
	return (await cache.keys()).filter(r => r.url.includes(GEMMA_MODEL_ID))
}

export async function modelStatus(sel: ModelSelection): Promise<ModelStatus> {
	if (FAKE_EMBEDDER_ENABLED) {
		const cached = await caches.has(FAKE_MODEL_CACHE)
		return {
			cached: { text: cached, vision: cached, audio: cached },
			cachedBytes: 0,
			loaded: gemma.isLoaded,
			device: gemma.device,
			// The E2E fake needs no GPU, so the WebGPU requirement must not block its flow.
			webgpu: true,
			webgpuReason: null,
		}
	}
	const reqs = await cachedModelRequests()
	const has = (c: ModelComponent) => reqs.some(r => fileMatchesComponentDtype(r.url, c, sel.dtype))
	let bytes = 0
	if (reqs.length) {
		const cache = await caches.open(CACHE_NAME)
		for (const r of reqs) {
			const len = Number((await cache.match(r))?.headers.get('content-length') ?? 0)
			bytes += Number.isFinite(len) ? len : 0
		}
	}
	const gpu = await probeWebGPU()
	return {
		cached: { text: has('text'), vision: has('vision'), audio: has('audio') },
		cachedBytes: bytes,
		loaded: gemma.isLoaded,
		device: gemma.device,
		webgpu: gpu.available,
		webgpuReason: gpu.reason,
	}
}

/**
 * Chooses the backend. WebGPU unless it is unavailable AND the user approved the CPU fallback;
 * otherwise throws a `WEBGPU_UNAVAILABLE` error before anything is downloaded.
 */
async function resolveDevice(sel: ModelSelection): Promise<'webgpu' | 'wasm'> {
	if (FAKE_EMBEDDER_ENABLED) return 'wasm'
	const gpu = await probeWebGPU()
	if (gpu.available) return 'webgpu'
	const { cpuFallbackApproved } = await loadFolderSearchSettings()
	if (!cpuFallbackApproved) {
		throw new Error(`${WEBGPU_UNAVAILABLE}: ${gpu.reason ?? 'WebGPU is not available.'}`)
	}
	if (sel.dtype !== 'fp16') {
		throw new Error('CPU mode needs the fp16 model. Choose the CPU fallback again to download it.')
	}
	return 'wasm'
}

/** Downloads (if needed) and loads the selected components. Failures are published verbatim. */
export async function downloadAndLoad(sel: ModelSelection): Promise<ModelStatus> {
	const files = new Map<string, ComponentProgress>()
	publish({ phase: 'downloading', components: {} })
	try {
		const device = await resolveDevice(sel)
		try {
			await gemma.load({
				vision: sel.vision,
				audio: sel.audio,
				dtype: sel.dtype,
				device,
				onProgress: e => {
					files.set(e.file, { loaded: e.loaded, total: e.total })
					publish({ phase: e.status === 'done' ? 'warming' : 'downloading', components: aggregateProgress(files) })
				},
			})
		} catch (e) {
			// A WebGPU failure while loading (e.g. "no available backend … [webgpu]") means the GPU path
			// does not work here, which is what the fallback offer is for. Network errors are left alone.
			const message = e instanceof Error ? e.message : String(e)
			if (device === 'webgpu' && /webgpu|adapter|no available backend/i.test(message)) {
				throw new Error(`${WEBGPU_UNAVAILABLE}: WebGPU failed to initialize. ${message}`, { cause: e })
			}
			throw e
		}
		publish({ phase: 'done', components: aggregateProgress(files) })
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e)
		publish({ phase: 'error', components: aggregateProgress(files), error })
		throw e
	}
	return modelStatus(sel)
}

/** Ensures the selected components are loaded without surfacing progress (used by indexing/search). */
export async function ensureLoaded(sel: ModelSelection): Promise<void> {
	if (gemma.isLoaded && gemma.hasVision === sel.vision && gemma.hasAudio === sel.audio) return
	await downloadAndLoad(sel)
}

export async function removeModels(): Promise<{ freedBytes: number }> {
	await gemma.unload()
	let freed = 0
	if (typeof caches !== 'undefined') {
		const cache = await caches.open(CACHE_NAME)
		for (const r of await cachedModelRequests()) {
			freed += Number((await cache.match(r))?.headers.get('content-length') ?? 0) || 0
			await cache.delete(r)
		}
	}
	publish({ phase: 'idle', components: {} })
	return { freedBytes: freed }
}
