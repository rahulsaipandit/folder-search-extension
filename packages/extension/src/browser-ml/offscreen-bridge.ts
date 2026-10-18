/**
 * Caller-side API for running WASM/Worker-based ML (embeddings, vector search,
 * UMAP/HDBSCAN clustering) from the side panel or a content script. The manifest
 * CSP blocks those from loading a Worker/WASM directly, so these functions
 * message-pass into a Chrome offscreen document instead, where the actual
 * implementation classes (`embeddings.ts`, `vector-search.ts`, `clustering.ts`) run -
 * see `entrypoints/offscreen/main.ts`'s `handleMessage()` for the receiving side.
 * See AGENTS.md > "On-device ML" for the full pattern.
 */
const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreenDocument(): Promise<void> {
	try {
		await chrome.offscreen.createDocument({
			url: OFFSCREEN_URL,
			reasons: ['WORKERS'] as chrome.offscreen.Reason[],
			justification: 'Run WASM-based machine learning tasks (embeddings, vector search, clustering)',
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

	// The document can exist before its script has registered the onMessage listener (or after the
	// browser recycled it); Chrome then reports "message port closed". Retry a few times so a cold
	// start doesn't surface as a user-facing error; a persistent failure is still thrown as-is.
	const MAX_ATTEMPTS = 4
	let lastError: Error | undefined
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		try {
			return await sendOnce<T>(type, payload, timeoutMs)
		} catch (e) {
			lastError = e as Error
			if (!/message port closed|Receiving end does not exist/i.test(lastError.message)) throw lastError
			await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
			await ensureOffscreenDocument()
		}
	}
	throw new Error(
		`Offscreen document did not respond to ${type} after ${MAX_ATTEMPTS} attempts (${lastError?.message}). ` +
			`Open chrome://extensions > this extension > "offscreen.html" inspect view to see its startup error.`
	)
}

function sendOnce<T>(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
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

export { ensureOffscreenDocument }
