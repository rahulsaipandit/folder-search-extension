/**
 * Caller-side API for running WASM/Worker-based ML (embeddings, vector search,
 * UMAP/HDBSCAN clustering) from the side panel or a content script. The manifest
 * CSP blocks those from loading a Worker/WASM directly, so these functions
 * message-pass into a Chrome offscreen document instead, where the actual
 * implementation classes (`embeddings.ts`, `vector-search.ts`, `clustering.ts`) run -
 * see `entrypoints/offscreen/main.ts`'s `handleMessage()` for the receiving side.
 * See AGENTS.md > "On-device ML" for the full pattern.
 */
import type { CaptureSnapshot } from '@/audio/capture'
import type { SttModelStatus } from '@/stt/offscreenStt'
import type { SttModelSetting, SttPollResult } from '@/stt/types'
import type {
	DecideWindowRequest,
	DecideWindowResult,
	DecisionRuntimeInfo,
} from '@/decision/types'

const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreenDocument(): Promise<void> {
	try {
		await chrome.offscreen.createDocument({
			url: OFFSCREEN_URL,
			// USER_MEDIA and AUDIO_PLAYBACK: dual-channel call capture (audio/capture.ts) records the mic and
			// the Meet tab and plays the tab back. Reasons are fixed when the document is created.
			reasons: ['WORKERS', 'USER_MEDIA', 'AUDIO_PLAYBACK'] as chrome.offscreen.Reason[],
			justification:
				'Run WASM-based machine learning tasks, and measure microphone and call audio to tell the user from other speakers',
		})
	} catch (e: any) {
		// "Only a single offscreen document may be created" means it already exists - that's fine.
		if (!e?.message?.includes('single offscreen document')) throw e
	}
}

const DEFAULT_TIMEOUT_MS = 120_000

export async function sendToOffscreen<T = unknown>(
	type: string,
	payload: Record<string, unknown> = {},
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
	await ensureOffscreenDocument()
	const requestId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Offscreen timeout: ${type}`)), timeoutMs)

		chrome.runtime.sendMessage({ type, requestId, ...payload }, response => {
			clearTimeout(timeout)
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message))
				return
			}
			if (!response?.ok) {
				reject(new Error(response?.error ?? `Offscreen error for ${type}`))
				return
			}
			resolve(response.result as T)
		})
	})
}

export async function offscreenEmbed(texts: string[], options?: Record<string, unknown>): Promise<number[][]> {
	const result = await sendToOffscreen<{ embeddings: number[][] }>('offscreen:embed', { texts, options })
	return result.embeddings
}

export async function offscreenVectorSearch(
	queryEmbedding: number[],
	k = 10,
	options: Record<string, unknown> = {}
) {
	return sendToOffscreen('offscreen:vector:search', { queryEmbedding, k, options })
}

export async function offscreenBuildVectorIndex(
	embeddings: number[][],
	docIds: string[],
	documents: unknown[]
) {
	return sendToOffscreen('offscreen:vector:build', { embeddings, docIds, documents })
}

export async function offscreenClusterUMAP(embeddings: number[][], options: Record<string, unknown> = {}) {
	return sendToOffscreen<{ projection: number[][] }>('offscreen:cluster:umap', { embeddings, options })
}

export async function offscreenClusterHDBSCAN(points: number[][], options: Record<string, unknown> = {}) {
	return sendToOffscreen('offscreen:cluster:hdbscan', { points, options })
}

/** First load downloads the model weights (hundreds of MB), so it gets a long timeout. */
const DECISION_INIT_TIMEOUT_MS = 15 * 60_000

export async function offscreenDecideInit(model?: string): Promise<DecisionRuntimeInfo> {
	return sendToOffscreen<DecisionRuntimeInfo>('offscreen:decide:init', { model }, DECISION_INIT_TIMEOUT_MS)
}

export async function offscreenDecide(request: DecideWindowRequest): Promise<DecideWindowResult> {
	return sendToOffscreen<DecideWindowResult>('offscreen:decide', { request }, DECISION_INIT_TIMEOUT_MS)
}

export async function offscreenDecideDispose(): Promise<void> {
	await sendToOffscreen('offscreen:decide:dispose')
}

export { ensureOffscreenDocument }

// ── Dual-channel call audio (audio/capture.ts) ────────────────────────────────────────────────
export type AudioStartResult = CaptureSnapshot & { sttError: string | null; sttOn: boolean }
/** `stt` turns on speech recognition of the call; the model must already be downloaded. */
export const offscreenAudioStart = (streamId: string, stt?: SttModelSetting) =>
	sendToOffscreen<AudioStartResult>('offscreen:audio:start', { streamId, stt }, 120_000)
export const offscreenAudioStop = () => sendToOffscreen<{ ok: true }>('offscreen:audio:stop', {}, 15_000)
export const offscreenAudioSnapshot = (since?: number) =>
	sendToOffscreen<CaptureSnapshot>('offscreen:audio:snapshot', { since }, 5_000)

// Speech model download / cache / live transcription (stt/offscreenStt.ts)
export const offscreenSttStatus = (setting: SttModelSetting) =>
	sendToOffscreen<SttModelStatus>('offscreen:stt:status', { setting }, 15_000)
/** The model download can take a long time on a slow connection. */
export const offscreenSttDownload = (setting: SttModelSetting) =>
	sendToOffscreen<SttModelStatus>('offscreen:stt:download', { setting }, 30 * 60_000)
export const offscreenSttRemove = (setting: SttModelSetting) =>
	sendToOffscreen<{ freedBytes: number }>('offscreen:stt:remove', { setting }, 30_000)
export const offscreenSttPoll = (afterSeq: number) =>
	sendToOffscreen<SttPollResult>('offscreen:stt:poll', { afterSeq }, 5_000)
