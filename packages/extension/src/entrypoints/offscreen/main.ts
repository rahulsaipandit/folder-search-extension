/**
 * This is the ONLY extension page allowed to load `embeddings`/`BrowserVectorSearch`/
 * `BrowserClustering` - it's the offscreen document, same-origin with the packed
 * extension, so it satisfies the manifest CSP's `worker-src`/`script-src` for the
 * WASM/Worker these need. Callers (side panel, content scripts) must go through
 * `browser-ml/offscreen-bridge.ts`'s `offscreenEmbed()` etc., not import these
 * classes directly. See AGENTS.md > "On-device ML" for the full pattern.
 */
import { embeddings } from '@/browser-ml/embeddings'
import { BrowserVectorSearch } from '@/browser-ml/vector-search'
import { BrowserClustering } from '@/browser-ml/clustering'
import { storage } from '@/browser-ml/storage'
import { handleFolderMessage } from '@/folder-search/engine'

type OffscreenMessage = {
	type: string
	requestId: string
	[key: string]: unknown
}

const vectorIndex = new BrowserVectorSearch()
const clusteringInstance = new BrowserClustering()

async function handleMessage(message: OffscreenMessage): Promise<unknown> {
	const { type } = message

	if (type.startsWith('offscreen:folder:')) return handleFolderMessage(type, message)

	switch (type) {
		case 'offscreen:embed': {
			const texts = message.texts as string[]
			const options = (message.options ?? {}) as Parameters<typeof embeddings.embed>[1]
			await embeddings.initialize()
			const results = await embeddings.embed(texts, options)
			return { embeddings: results.map(e => Array.from(e)) }
		}

		case 'offscreen:embed:init': {
			await embeddings.initialize()
			return { device: embeddings.activeDevice }
		}

		case 'offscreen:vector:build': {
			const vecs = message.embeddings as number[][]
			const ids = message.docIds as string[]
			const docs = message.documents as unknown[]
			const stats = await vectorIndex.buildIndex(vecs, ids, docs)
			return stats
		}

		case 'offscreen:vector:search': {
			const query = message.queryEmbedding as number[]
			const k = (message.k as number) ?? 10
			const opts = (message.options ?? {}) as Parameters<typeof vectorIndex.search>[2]
			return vectorIndex.search(query, k, opts)
		}

		case 'offscreen:vector:serialize':
			return vectorIndex.serialize()

		case 'offscreen:vector:deserialize': {
			vectorIndex.deserialize(message.data as any)
			return { ok: true }
		}

		case 'offscreen:cluster:umap': {
			const vecs = message.embeddings as number[][]
			const opts = (message.options ?? {}) as Parameters<typeof clusteringInstance.computeClusteringUMAP>[1]
			const projection = await clusteringInstance.computeClusteringUMAP(vecs, opts)
			return { projection }
		}

		case 'offscreen:cluster:viz': {
			const vecs = message.embeddings as number[][]
			const opts = (message.options ?? {}) as Parameters<typeof clusteringInstance.computeVisualizationUMAP>[1]
			const projection = await clusteringInstance.computeVisualizationUMAP(vecs, opts)
			return { projection }
		}

		case 'offscreen:cluster:hdbscan': {
			const points = message.points as number[][]
			const opts = (message.options ?? {}) as Parameters<typeof clusteringInstance.computeClusters>[1]
			const labels = await clusteringInstance.computeClusters(points, opts)
			return {
				labels,
				probabilities: clusteringInstance.getProbabilities(),
				stats: clusteringInstance.getClusterStats(),
				keywordData: clusteringInstance.getClusterKeywordData(),
			}
		}

		case 'offscreen:storage:get': {
			const store = message.store as string
			const key = message.key as string
			const value = await (storage as any).getStore(store)?.getItem(key)
			return { value }
		}

		case 'offscreen:storage:set': {
			const store = message.store as string
			const key = message.key as string
			await (storage as any).getStore(store)?.setItem(key, message.value)
			return { ok: true }
		}

		// ── Silence / audio analysis stub ─────────────────────────────────────
		case 'offscreen:audio:analyse': {
			// Phase 3: run Web Audio AnalyserNode RMS on a shared mic stream.
			// Returns conversation state derived from silence duration.
			return { ok: true, stub: true, rms: 0, silenceDurationMs: 999_999 }
		}

		default:
			throw new Error(`Unknown offscreen message type: ${type}`)
	}
}


chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
	if (!message?.type?.startsWith('offscreen:')) return false

	handleMessage(message)
		.then(result => sendResponse({ ok: true, result }))
		.catch(err => sendResponse({ ok: false, error: err?.message ?? String(err) }))

	return true
})
