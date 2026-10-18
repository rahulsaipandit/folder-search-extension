import { createUMAP as createUMAPWasm } from './umap-wasm/index.js'

export class UMAPAdapter {
	static async createUMAP(
		count: number,
		inputDim: number,
		outputDim: number,
		data: Float32Array | number[][],
		options: {
			n_neighbors?: number
			min_dist?: number
			distance?: string
			onProgress?: ((p: number) => void) | null
		} = {}
	) {
		const { n_neighbors = 15, min_dist = 0.1, distance = 'cosine', onProgress = null } = options

		const flatData = this._prepareData(data, count, inputDim)

		const umapOptions = {
			metric: distance as 'cosine' | 'euclidean',
			knnMethod: 'hnsw' as const,
			nNeighbors: n_neighbors,
			minDist: min_dist,
			initializeMethod: (outputDim > 2 ? 'random' : 'spectral') as 'random' | 'spectral',
		}

		let umap: Awaited<ReturnType<typeof createUMAPWasm>>
		try {
			umap = await (createUMAPWasm as any)(count, inputDim, outputDim, flatData, umapOptions)
		} catch (error: any) {
			if (typeof error?.message === 'string' && error.message.includes('memory access out of bounds')) {
				const inputMb = (flatData.byteLength / 1024 / 1024).toFixed(1)
				const outputMb = ((count * outputDim * 4) / 1024 / 1024).toFixed(1)
				const enhanced = new Error(
					`Apple UMAP WASM exhausted heap (${inputMb}MB input + ${outputMb}MB output). ` +
						`Try reducing dataset size/dimensionality.`
				)
				;(enhanced as any).cause = error
				throw enhanced
			}
			throw error
		}

		const wrapper = {
			_umap: umap,
			async run(epochs: number | null = null) {
				const nEpochs = (umap as any).nEpochs
				const targetEpoch = epochs ?? nEpochs
				if (onProgress) {
					const progressInterval = Math.max(1, Math.floor(nEpochs / 50))
					let lastUpdate = Date.now()
					for (let epoch = 0; epoch <= targetEpoch; epoch += progressInterval) {
						;(umap as any).run(epoch)
						onProgress(epoch / nEpochs)
						const now = Date.now()
						if (now - lastUpdate > 100) {
							await new Promise<void>(resolve => {
								if (typeof requestAnimationFrame === 'function') {
									requestAnimationFrame(() => setTimeout(resolve, 0))
								} else {
									setTimeout(resolve, 10)
								}
							})
							lastUpdate = now
						} else {
							await new Promise<void>(resolve => setTimeout(resolve, 0))
						}
					}
					if (targetEpoch >= nEpochs) {
						;(umap as any).run(nEpochs)
						onProgress(1.0)
					}
				} else {
					;(umap as any).run(targetEpoch)
				}
			},
			get embedding(): Float32Array {
				return (umap as any).embedding
			},
			destroy() {
				if (this._umap) {
					;(this._umap as any).destroy()
					this._umap = null as any
				}
			},
		}

		return wrapper
	}

	static _prepareData(data: Float32Array | number[][], count: number, inputDim: number): Float32Array {
		if (data instanceof Float32Array) return data
		const flat = new Float32Array(count * inputDim)
		if (Array.isArray(data) && Array.isArray(data[0])) {
			for (let i = 0; i < count; i++)
				for (let j = 0; j < inputDim; j++) flat[i * inputDim + j] = (data as number[][])[i][j]
		} else {
			flat.set(data as any)
		}
		return flat
	}
}

export const createUMAP = UMAPAdapter.createUMAP.bind(UMAPAdapter)
