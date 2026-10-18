let worker: Worker | null = null
let workerReadyPromise: { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null = null
const pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let nextRequestId = 0

function createDeferred<T>() {
	let resolve!: (v: T) => void
	let reject!: (e: Error) => void
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
	return { promise, resolve, reject }
}

function ensureWorker(): Promise<void> {
	if (!worker) {
		worker = new Worker(new URL('./pyodide-hdbscan-worker.ts', import.meta.url), { type: 'module' })

		worker.onmessage = (event: MessageEvent) => {
			const { type, id, result, error } = event.data ?? {}
			if (type === 'ready') {
				workerReadyPromise?.resolve()
				return
			}
			if (type === 'result' || type === 'error') {
				const deferred = pendingRequests.get(id)
				if (!deferred) { console.warn('Received response for unknown request id', id); return }
				pendingRequests.delete(id)
				if (type === 'result') deferred.resolve(result)
				else deferred.reject(new Error(error))
			}
		}

		worker.onerror = (event: ErrorEvent) => {
			const message = event?.message || 'Unknown worker error'
			workerReadyPromise?.reject(new Error(message))
			pendingRequests.forEach(({ reject }) => reject(new Error(message)))
			pendingRequests.clear()
		}

		workerReadyPromise = createDeferred<void>()
		worker.postMessage({ type: 'init' })
	}

	return workerReadyPromise!.promise
}

export interface HDBSCANResult {
	labels: number[]
	probabilities: number[]
	outlier_scores: number[] | null
	cluster_keywords?: Record<string, string[]>
	cluster_keyword_scores?: Record<string, { keyword: string; score: number }[]>
	cluster_keywords_viz?: Record<string, string[]>
}

export async function runHDBSCANPyodide(
	data: number[][],
	options: {
		minClusterSize: number
		minSamples: number
		metric: string
		documents?: unknown[] | null
		keywordOptions?: Record<string, unknown> | null
	}
): Promise<HDBSCANResult> {
	const { minClusterSize, minSamples, metric, documents = null, keywordOptions = null } = options
	await ensureWorker()

	const requestId = nextRequestId++
	const deferred = createDeferred<HDBSCANResult>()
	pendingRequests.set(requestId, deferred)

	worker!.postMessage({
		type: 'run',
		id: requestId,
		payload: { data, minClusterSize, minSamples, metric, documents, keywordOptions },
	})

	return deferred.promise
}
