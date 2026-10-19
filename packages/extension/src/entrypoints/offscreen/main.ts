/**
 * The offscreen document is the ONLY extension page that loads the embedding model, ONNX Runtime
 * and pdf.js (same-origin with the packed extension, so it satisfies the manifest CSP's
 * `worker-src`/`script-src`). Other pages reach it through `folder-search/bridge.ts`.
 * See AGENTS.md > "Folder Search".
 */
import { handleFolderMessage } from '@/folder-search/engine'

interface OffscreenMessage {
	type: string
	requestId: string
	[key: string]: unknown
}

async function handleMessage(message: OffscreenMessage): Promise<unknown> {
	if (message.type.startsWith('offscreen:folder:')) return handleFolderMessage(message.type, message)
	throw new Error(`Unknown offscreen message type: ${message.type}`)
}

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
	if (!message?.type?.startsWith('offscreen:')) return false

	handleMessage(message)
		.then(result => sendResponse({ ok: true, result }))
		.catch(err => sendResponse({ ok: false, error: err?.message ?? String(err) }))

	return true
})
