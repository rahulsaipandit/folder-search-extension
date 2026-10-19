/**
 * Caller-side messaging into the Chrome offscreen document, where all heavy work runs (embedding
 * model, extractors, indexer, vector search - see `entrypoints/offscreen/main.ts` and
 * `folder-search/engine.ts`). The manifest CSP blocks Workers/WASM everywhere else, so the side
 * panel and the full-tab pages only ever send messages; `folder-search/bridge.ts` is the typed API
 * built on `sendToOffscreen()`. See AGENTS.md > "Folder Search".
 */
const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreenDocument(): Promise<void> {
	try {
		await chrome.offscreen.createDocument({
			url: OFFSCREEN_URL,
			// Reasons are fixed when the document is created. Folder Search only needs workers
			// (ONNX Runtime and the pdf.js worker); it records no audio and plays none.
			reasons: [chrome.offscreen.Reason.WORKERS],
			justification: 'Run the on-device search model and index the selected folder without blocking the UI',
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
