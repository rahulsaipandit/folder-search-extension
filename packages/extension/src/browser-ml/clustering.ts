import { createUMAP } from './umap-wasm-adapter'
import { runHDBSCANPyodide } from './hdbscan-pyodide'

export interface ClusteringConfig {
	umap_n_neighbors?: number
	umap_min_dist?: number
	umap_metric?: string
	umap_clustering_dimensions?: number
	hdbscan_min_cluster_size?: number
	hdbscan_min_samples?: number
	hdbscan_metric?: string
	umap_sample_size?: number
}

export class BrowserClustering {
	nNeighbors: number
	minDist: number
	nComponents: number
	metric: string
	clusteringDimensions: number
	minClusterSize: number
	minSamples: number
	hdbscanMetric: string
	umapSampleSize: number

	clusteringProjection: number[][] | null = null
	visualizationProjection: number[][] | null = null
	labels: number[] | null = null
	probabilities: number[] | null = null
	clusterKeywords = new Map<number, string[]>()
	clusterKeywordScores = new Map<number, { keyword: string; score: number }[]>()
	clusterKeywordsViz = new Map<number, string[]>()

	constructor(options: Partial<ClusteringConfig> = {}) {
		this.nNeighbors = options.umap_n_neighbors ?? 15
		this.minDist = options.umap_min_dist ?? 0.1
		this.nComponents = 2
		this.metric = options.umap_metric ?? 'cosine'
		this.clusteringDimensions = options.umap_clustering_dimensions ?? 15
		this.minClusterSize = options.hdbscan_min_cluster_size ?? 5
		this.minSamples = options.hdbscan_min_samples ?? 5
		this.hdbscanMetric = options.hdbscan_metric ?? 'euclidean'
		this.umapSampleSize = options.umap_sample_size ?? 10000
	}

	async computeClusteringUMAP(
		embeddings: number[][],
		options: {
			nComponents?: number
			nNeighbors?: number
			minDist?: number
			metric?: string
			onProgress?: ((p: { status: string; progress: number; elapsed?: number; forceUpdate?: boolean }) => void) | null
		} = {}
	): Promise<number[][]> {
		const nComponents = options.nComponents ?? this.clusteringDimensions
		const { nNeighbors = this.nNeighbors, minDist = 0.0, metric = 'cosine', onProgress = null } = options

		const embeddingsArray: number[][] = embeddings.map(emb => Array.from(emb))
		const expectedDim = embeddingsArray[0]?.length ?? 0
		const invalid = embeddingsArray.filter(e => !e || e.length !== expectedDim)
		if (invalid.length > 0) throw new Error(`Invalid embedding dimensions: ${invalid.length} don't match expected ${expectedDim}`)

		const numPoints = embeddingsArray.length
		const flatData = new Float32Array(numPoints * expectedDim)
		for (let i = 0; i < numPoints; i++)
			for (let j = 0; j < expectedDim; j++)
				flatData[i * expectedDim + j] = embeddingsArray[i][j]

		const startTime = Date.now()
		if (onProgress) onProgress({ status: 'umap_fitting', progress: 0.10, elapsed: 0 })

		let elapsedTimer: ReturnType<typeof setInterval> | null = null
		let lastElapsed = -1
		if (onProgress) {
			elapsedTimer = setInterval(() => {
				const elapsed = Math.floor((Date.now() - startTime) / 1000)
				if (elapsed !== lastElapsed) {
					lastElapsed = elapsed
					onProgress({ status: 'umap_fitting', progress: 0.5, elapsed, forceUpdate: true })
				}
			}, 500)
		}

		try {
			const umapInstance = await createUMAP(numPoints, expectedDim, nComponents, flatData, {
				n_neighbors: nNeighbors,
				min_dist: minDist,
				distance: metric,
				onProgress: progress => {
					if (onProgress) {
						const elapsed = Math.floor((Date.now() - startTime) / 1000)
						lastElapsed = elapsed
						onProgress({ status: 'umap_fitting', progress: Math.min(0.95, 0.10 + progress * 0.85), elapsed })
					}
				},
			})

			await umapInstance.run()
			if (elapsedTimer) clearInterval(elapsedTimer)

			const flatResult = umapInstance.embedding
			this.clusteringProjection = []
			for (let i = 0; i < numPoints; i++) {
				const row: number[] = []
				for (let j = 0; j < nComponents; j++) row.push(flatResult[i * nComponents + j])
				this.clusteringProjection.push(row)
			}
			umapInstance.destroy()

			if (onProgress) onProgress({ status: 'complete', progress: 1.0 })
			return this.clusteringProjection
		} catch (error: any) {
			if (elapsedTimer) clearInterval(elapsedTimer)
			throw new Error(`UMAP clustering failed: ${error.message}`)
		}
	}

	async computeVisualizationUMAP(
		embeddings: number[][],
		options: {
			nNeighbors?: number
			minDist?: number
			nComponents?: number
			metric?: string
			onProgress?: ((p: { status: string; progress: number; elapsed?: number; forceUpdate?: boolean }) => void) | null
		} = {}
	): Promise<number[][]> {
		const { nNeighbors = 15, minDist = 0.1, nComponents = 2, metric = 'cosine', onProgress = null } = options

		const embeddingsArray: number[][] = embeddings.map(emb => Array.from(emb))
		const expectedDim = embeddingsArray[0]?.length ?? 0
		const invalid = embeddingsArray.filter(e => !e || e.length !== expectedDim)
		if (invalid.length > 0) throw new Error(`Invalid embedding dimensions: ${invalid.length} don't match expected ${expectedDim}`)

		const numPoints = embeddingsArray.length
		const flatData = new Float32Array(numPoints * expectedDim)
		for (let i = 0; i < numPoints; i++)
			for (let j = 0; j < expectedDim; j++)
				flatData[i * expectedDim + j] = embeddingsArray[i][j]

		const startTime = Date.now()
		if (onProgress) onProgress({ status: 'umap_fitting_viz', progress: 0.10, elapsed: 0 })

		let elapsedTimer: ReturnType<typeof setInterval> | null = null
		let lastElapsed = -1
		if (onProgress) {
			elapsedTimer = setInterval(() => {
				const elapsed = Math.floor((Date.now() - startTime) / 1000)
				if (elapsed !== lastElapsed) {
					lastElapsed = elapsed
					onProgress({ status: 'umap_fitting_viz', progress: 0.5, elapsed, forceUpdate: true })
				}
			}, 500)
		}

		try {
			const umapInstance = await createUMAP(numPoints, expectedDim, nComponents, flatData, {
				n_neighbors: nNeighbors,
				min_dist: minDist,
				distance: metric,
				onProgress: progress => {
					if (onProgress) {
						const elapsed = Math.floor((Date.now() - startTime) / 1000)
						lastElapsed = elapsed
						onProgress({ status: 'umap_fitting_viz', progress: Math.min(0.95, 0.10 + progress * 0.85), elapsed })
					}
				},
			})

			await umapInstance.run()
			if (elapsedTimer) clearInterval(elapsedTimer)

			const flatResult = umapInstance.embedding
			this.visualizationProjection = []
			for (let i = 0; i < numPoints; i++) {
				const row: number[] = []
				for (let j = 0; j < nComponents; j++) row.push(flatResult[i * nComponents + j])
				this.visualizationProjection.push(row)
			}
			umapInstance.destroy()

			const isValid = this._validateProjectionQuality(this.visualizationProjection, '2D UMAP Viz')
			if (!isValid) throw new Error('UMAP 2D projection failed quality validation')

			const stats = this._computeProjectionStats(this.visualizationProjection)
			if (stats.std < 0.1) {
				console.warn('2D projection appears collapsed (std < 0.1); consider adjusting UMAP parameters')
			}

			if (onProgress) onProgress({ status: 'complete', progress: 1.0 })
			return this.visualizationProjection
		} catch (error: any) {
			if (elapsedTimer) clearInterval(elapsedTimer)
			throw new Error(`UMAP visualization failed: ${error.message}`)
		}
	}

	async computeClusters(
		points: number[][],
		options: {
			minClusterSize?: number
			minSamples?: number
			documents?: unknown[] | null
			keywordOptions?: Record<string, unknown> | null
		} = {}
	): Promise<number[]> {
		const { minClusterSize = this.minClusterSize, minSamples = this.minSamples, documents = null, keywordOptions = null } = options

		if (!points || points.length === 0) {
			this.labels = []
			this.probabilities = []
			return this.labels
		}

		if (points.length < minClusterSize) {
			this.labels = new Array(points.length).fill(-1)
			this.probabilities = new Array(points.length).fill(0)
			return this.labels
		}

		try {
			const clusteringResult = await runHDBSCANPyodide(points, {
				minClusterSize,
				minSamples,
				metric: this.hdbscanMetric,
				documents,
				keywordOptions,
			})

			this.labels = Array.from(clusteringResult.labels ?? [])
			this.probabilities = this._prepareProbabilityArray(clusteringResult.probabilities, this.labels, points.length)
			this._storeClusterKeywords(clusteringResult)

			if (this.labels.length !== points.length) {
				this.labels = this._resizeArray(this.labels, points.length, -1)
				this.probabilities = this._resizeArray(this.probabilities, points.length, 0)
			}

			return this.labels
		} catch (error: any) {
			this.labels = new Array(points.length).fill(-1)
			this.probabilities = new Array(points.length).fill(0)
			throw new Error(`HDBSCAN clustering failed: ${error.message}`)
		}
	}

	getProbabilities(): number[] | null { return this.probabilities }

	getOutliers(threshold = 0.5): number[] {
		if (!this.probabilities || !this.labels) return []
		const outliers: number[] = []
		for (let i = 0; i < this.labels.length; i++) {
			if (this.labels[i] === -1 || this.probabilities[i] < threshold) outliers.push(i)
		}
		return outliers
	}

	groupByCluster(data: unknown[]): Record<number, { index: number; data: unknown; probability: number | null }[]> {
		if (!this.labels || this.labels.length !== data.length) return {}
		const grouped: Record<number, { index: number; data: unknown; probability: number | null }[]> = {}
		for (let i = 0; i < this.labels.length; i++) {
			const label = this.labels[i]
			if (!grouped[label]) grouped[label] = []
			grouped[label].push({ index: i, data: data[i], probability: this.probabilities ? this.probabilities[i] : null })
		}
		return grouped
	}

	getClusterKeywords(): Map<number, string[]> { return this.clusterKeywords }
	getClusterKeywordScores(): Map<number, { keyword: string; score: number }[]> { return this.clusterKeywordScores }
	getClusterKeywordsViz(): Map<number, string[]> { return this.clusterKeywordsViz }

	hydrateClusterKeywords(data: Record<string, unknown> = {}): void {
		this._storeClusterKeywords({
			cluster_keywords: (data.cluster_keywords ?? data.clusterKeywords) as any,
			cluster_keyword_scores: (data.cluster_keyword_scores ?? data.clusterKeywordScores) as any,
			cluster_keywords_viz: (data.cluster_keywords_viz ?? data.clusterKeywordsViz) as any,
		})
	}

	getClusterKeywordData() {
		const toObject = (map: Map<number, any>) => Object.fromEntries(Array.from(map.entries()))
		return {
			cluster_keywords: toObject(this.clusterKeywords),
			cluster_keyword_scores: toObject(this.clusterKeywordScores),
			cluster_keywords_viz: toObject(this.clusterKeywordsViz),
		}
	}

	getClusterStats(labels: number[] | null = null) {
		const clustLabels = labels || this.labels
		if (!clustLabels) return null

		const clusterCounts = new Map<number, number>()
		const clusterProbabilities = new Map<number, number[]>()

		for (let i = 0; i < clustLabels.length; i++) {
			const label = clustLabels[i]
			clusterCounts.set(label, (clusterCounts.get(label) ?? 0) + 1)
			if (this.probabilities?.[i] !== undefined) {
				if (!clusterProbabilities.has(label)) clusterProbabilities.set(label, [])
				clusterProbabilities.get(label)!.push(this.probabilities[i])
			}
		}

		const avgProbabilities: Record<number, number> = {}
		for (const [label, probs] of clusterProbabilities.entries()) {
			if (label !== -1) {
				avgProbabilities[label] = this._formatProbability(probs.reduce((s, p) => s + p, 0) / probs.length)
			}
		}

		return {
			numClusters: clusterCounts.size - (clusterCounts.has(-1) ? 1 : 0),
			numNoise: clusterCounts.get(-1) ?? 0,
			clusterSizes: Object.fromEntries(
				Array.from(clusterCounts.entries()).filter(([l]) => l !== -1).sort((a, b) => b[1] - a[1])
			),
			avgProbabilities,
			totalPoints: clustLabels.length,
			noisePercentage: parseFloat((((clusterCounts.get(-1) ?? 0) / clustLabels.length) * 100).toFixed(1)),
		}
	}

	normalizeProjection(projection: number[][] | null = null): number[][] | null {
		const proj = projection ?? this.visualizationProjection
		if (!proj) return null
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
		for (const p of proj) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]) }
		const rx = maxX - minX || 1
		const ry = maxY - minY || 1
		return proj.map(p => [(p[0] - minX) / rx, (p[1] - minY) / ry])
	}

	private _validateProjectionQuality(projection: number[][], label: string): boolean {
		if (!projection?.length) return false
		let nanCount = 0, infinityCount = 0, extremeCount = 0
		const maxValue = 1e6
		for (const point of projection) {
			if (!Array.isArray(point)) return false
			for (const v of point) {
				if (!Number.isFinite(v)) { if (Number.isNaN(v)) nanCount++; else infinityCount++ }
				else if (Math.abs(v) > maxValue) extremeCount++
			}
		}
		if (nanCount > 0 || infinityCount > 0 || extremeCount > 0) {
			console.warn(`${label}: numerical anomalies detected (NaN:${nanCount}, Inf:${infinityCount}, extreme:${extremeCount})`)
			return false
		}
		return true
	}

	private _computeProjectionStats(projection: number[][]): { mean: number; std: number; min: number; max: number } {
		if (!projection?.length) return { mean: 0, std: 0, min: 0, max: 0 }
		const values: number[] = []
		for (const point of projection) for (const v of point) if (Number.isFinite(v)) values.push(v)
		if (!values.length) return { mean: 0, std: 0, min: 0, max: 0 }
		let min = Infinity, max = -Infinity, sum = 0
		for (const v of values) { if (v < min) min = v; if (v > max) max = v; sum += v }
		const mean = sum / values.length
		const std = Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length)
		return { mean, std, min, max }
	}

	private _prepareProbabilityArray(rawProbabilities: number[] | null | undefined, labels: number[], expectedLength: number): number[] {
		const targetLength = labels.length || expectedLength
		if (!targetLength) return []
		const hasRaw = rawProbabilities && typeof rawProbabilities.length === 'number'
		const formatted = new Array<number>(targetLength)
		for (let i = 0; i < targetLength; i++) {
			let value: number
			if (hasRaw && rawProbabilities![i] !== undefined) value = rawProbabilities![i]
			else if (labels[i] === -1) value = 0.5
			else value = 1
			formatted[i] = this._formatProbability(value)
		}
		return formatted
	}

	private _resizeArray<T>(arr: T[], targetLength: number, fillValue: T): T[] {
		const result = new Array<T>(targetLength)
		for (let i = 0; i < targetLength; i++) result[i] = i < arr.length ? arr[i] : fillValue
		return result
	}

	private _formatProbability(value: unknown): number {
		const numeric = Number(value)
		if (!Number.isFinite(numeric)) return 0.0
		return Math.min(1, Math.max(0, numeric))
	}

	private _storeClusterKeywords(result: any): void {
		this.clusterKeywords = new Map()
		this.clusterKeywordScores = new Map()
		this.clusterKeywordsViz = new Map()
		if (!result) return

		const assign = <T>(target: Map<number, T>, entries: any, transform: (v: any) => T) => {
			if (!entries || typeof entries !== 'object') return
			for (const [key, value] of Object.entries(entries)) {
				const numKey = Number(key)
				if (!Number.isNaN(numKey)) target.set(numKey, transform(value))
			}
		}

		assign(this.clusterKeywords, result.cluster_keywords, v => Array.isArray(v) ? v.slice() : [])
		assign(this.clusterKeywordScores, result.cluster_keyword_scores, v => {
			if (!Array.isArray(v)) return []
			return v.map(item => item && typeof item === 'object'
				? { keyword: typeof item.keyword === 'string' ? item.keyword : '', score: typeof item.score === 'number' ? item.score : 0 }
				: { keyword: '', score: 0 })
		})
		assign(this.clusterKeywordsViz, result.cluster_keywords_viz, v => Array.isArray(v) ? v.slice() : [])
	}
}

export const clustering = new BrowserClustering()
