/**
 * Static facts about the EmbeddingGemma 2 ONNX components. Pure (no transformers.js import) so the
 * side panel can show sizes on the consent screen without pulling the ML runtime into its bundle.
 */
import type { ModelDtype, ModelSelection } from './types'

export type ModelComponent = 'text' | 'vision' | 'audio'

const MB = 1024 * 1024

/** Download sizes from the model card (fetched 2026-10-18). */
export const COMPONENT_BYTES: Record<ModelDtype, Record<ModelComponent, number>> = {
	q4: { text: 175 * MB, vision: 109 * MB, audio: 189 * MB },
	q8: { text: 314 * MB, vision: 195 * MB, audio: 340 * MB },
	fp16: { text: 543 * MB, vision: 336 * MB, audio: 587 * MB },
}

/**
 * The audio encoder is always q8 (the model card says audio suffers most from quantization),
 * whatever precision text and vision use. Never fp16: the CPU fallback keeps audio at q8 too.
 */
export function componentDtype(selected: ModelDtype, component: ModelComponent): ModelDtype {
	return component === 'audio' ? 'q8' : selected
}

export function componentBytes(selected: ModelDtype, component: ModelComponent): number {
	return COMPONENT_BYTES[componentDtype(selected, component)][component]
}

export const COMPONENT_LABEL: Record<ModelComponent, string> = {
	text: 'Documents (text)',
	vision: 'Images & video (vision)',
	audio: 'Audio',
}

export function selectedComponents(sel: ModelSelection): ModelComponent[] {
	return ['text', ...(sel.vision ? ['vision' as const] : []), ...(sel.audio ? ['audio' as const] : [])]
}

export function selectionBytes(sel: ModelSelection): number {
	return selectedComponents(sel).reduce((n, c) => n + componentBytes(sel.dtype, c), 0)
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
	if (bytes >= MB) return `${Math.round(bytes / MB)} MB`
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
	return `${bytes} B`
}

/** Which component a cached/downloaded model file belongs to; null for shared small files. */
export function componentOfFile(file: string): ModelComponent | null {
	if (/vision_encoder/i.test(file)) return 'vision'
	if (/audio_encoder/i.test(file)) return 'audio'
	if (/\.onnx(_data)?(\?|$)/i.test(file) || /\/onnx\/model/i.test(file)) return 'text'
	return null
}

/** transformers.js file suffix for a dtype (`q8` is published as `_quantized`). */
export function dtypeSuffix(dtype: ModelDtype): string {
	return dtype === 'q8' ? '_quantized' : dtype === 'fp16' ? '_fp16' : '_q4'
}

/** Cached-file test for one component at the selected precision (audio is always q8). */
export function fileMatchesComponentDtype(url: string, component: ModelComponent, selected: ModelDtype): boolean {
	const suffix = dtypeSuffix(componentDtype(selected, component))
	return componentOfFile(url) === component && new RegExp(`${suffix}\\.onnx(_data)?(\\?|$)`, 'i').test(url)
}

export interface ComponentProgress {
	loaded: number
	total: number
}

export interface DownloadSnapshot {
	phase: 'idle' | 'downloading' | 'warming' | 'done' | 'error'
	components: Partial<Record<ModelComponent, ComponentProgress>>
	error?: string
}

/** Prefix of errors meaning WebGPU is missing or failed to start; the UI then offers the fp16 CPU fallback. */
export const WEBGPU_UNAVAILABLE = 'WEBGPU_UNAVAILABLE'

export function isWebGPUError(message: string): boolean {
	return message.includes(WEBGPU_UNAVAILABLE)
}

/** Message without the machine-readable prefix, for display. */
export function displayError(message: string): string {
	return message.replace(new RegExp(`${WEBGPU_UNAVAILABLE}:\\s*`), '')
}

export interface ModelStatus {
	cached: Record<ModelComponent, boolean>
	/** Bytes on disk for this model in the browser cache. */
	cachedBytes: number
	loaded: boolean
	device: 'webgpu' | 'wasm' | null
	/** A WebGPU adapter was obtained (probed, not just `navigator.gpu` present). */
	webgpu: boolean
	/** Why WebGPU is unavailable, when it is. */
	webgpuReason: string | null
}

/** Folds per-file progress events into per-component totals. */
export function aggregateProgress(files: Map<string, ComponentProgress>): DownloadSnapshot['components'] {
	const out: DownloadSnapshot['components'] = {}
	for (const [file, p] of files) {
		const c = componentOfFile(file)
		if (!c || p.total <= 0) continue
		const cur = out[c] ?? { loaded: 0, total: 0 }
		cur.loaded += Math.min(p.loaded, p.total)
		cur.total += p.total
		out[c] = cur
	}
	return out
}
