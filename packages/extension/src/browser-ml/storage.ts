import localforage from 'localforage'

interface EmbeddingsModes {
	retrieval: string
	clustering: string
}

interface NormalizedEmbeddings {
	retrieval: unknown
	clustering: unknown
	model: string
	dimension: number
	schema: string
	modes: EmbeddingsModes
	legacy: boolean
}

interface DatasetRecord {
	embeddings: NormalizedEmbeddings | null
	vectorIndex: unknown
	documents: unknown[]
	projection: unknown
	clusteringProjection: unknown
	clusters: unknown
	metadata: DatasetMeta | null
}

interface DatasetMeta {
	fileName?: string
	fileType?: string
	textColumn?: string
	numDocuments?: number
	embeddingModel?: string
	embeddingSchema?: string
	timestamp: number
}

interface StorageStats {
	numDatasets: number
	numEmbeddings: number
	numIndexes: number
	numDocuments: number
	numVisualizations: number
	estimatedSizeMB: string
	datasets: (DatasetMeta & { id: string })[]
}

export class BrowserStorage {
	private embeddingsStore: LocalForage
	private indexStore: LocalForage
	private documentsStore: LocalForage
	private visualizationStore: LocalForage
	private metadataStore: LocalForage

	constructor() {
		this.embeddingsStore = localforage.createInstance({ name: 'vectoria', storeName: 'embeddings' })
		this.indexStore       = localforage.createInstance({ name: 'vectoria', storeName: 'vectorIndex' })
		this.documentsStore   = localforage.createInstance({ name: 'vectoria', storeName: 'documents' })
		this.visualizationStore = localforage.createInstance({ name: 'vectoria', storeName: 'visualization' })
		this.metadataStore    = localforage.createInstance({ name: 'vectoria', storeName: 'metadata' })
	}

	private _inferVectorDimension(vectors: unknown): number {
		if (!vectors) return 0
		if (Array.isArray(vectors)) {
			if (!vectors.length) return 0
			const first = vectors[0]
			return first && typeof (first as any).length === 'number' ? (first as any).length : 0
		}
		if (ArrayBuffer.isView(vectors)) return (vectors as any).length || 0
		return 0
	}

	private _normalizeEmbeddingsPayload(raw: unknown): NormalizedEmbeddings | null {
		if (!raw) return null

		const wrapLegacy = (vectors: unknown, schema = 'single-embedding-legacy'): NormalizedEmbeddings => ({
			retrieval: vectors,
			clustering: vectors,
			model: 'unknown',
			dimension: this._inferVectorDimension(vectors),
			schema,
			modes: { retrieval: 'unspecified', clustering: 'unspecified' },
			legacy: schema !== 'dual-embedding-v1',
		})

		if (Array.isArray(raw) || ArrayBuffer.isView(raw)) return wrapLegacy(raw)

		if (typeof raw === 'object' && raw !== null) {
			const r = raw as Record<string, unknown>

			if (Array.isArray(r.retrieval) || Array.isArray(r.clustering) ||
				ArrayBuffer.isView(r.retrieval) || ArrayBuffer.isView(r.clustering)) {
				const retrieval = r.retrieval ?? r.passages ?? r.vectors ?? r.documents ?? null
				const clustering = r.clustering ?? r.queries ?? retrieval ?? null
				const schema = (r.schema as string) || (retrieval && clustering && retrieval !== clustering ? 'dual-embedding-v1' : 'single-embedding-legacy')
				const dimension = (r.dimension as number) || this._inferVectorDimension(retrieval) || this._inferVectorDimension(clustering)
				const modes = (r.modes as EmbeddingsModes) || {
					retrieval: schema === 'dual-embedding-v1' ? 'passage' : 'unspecified',
					clustering: schema === 'dual-embedding-v1' ? 'query' : 'unspecified',
				}
				return {
					retrieval: retrieval as unknown,
					clustering: (clustering ?? retrieval) as unknown,
					model: (r.model as string) || 'unknown',
					dimension,
					schema,
					modes,
					legacy: (r.legacy as boolean) ?? schema !== 'dual-embedding-v1',
				}
			}

			if (r.embeddings) return this._normalizeEmbeddingsPayload(r.embeddings)
		}

		return null
	}

	private _estimateEmbeddingBytes(embeddings: NormalizedEmbeddings | null): number {
		if (!embeddings) return 0
		const dim = embeddings.dimension || this._inferVectorDimension(embeddings.retrieval) || this._inferVectorDimension(embeddings.clustering) || 0
		if (!dim) return 0

		const seen = new Set<unknown>()
		let vectorCount = 0
		const consume = (v: unknown) => {
			if (!v || seen.has(v)) return
			seen.add(v)
			if (Array.isArray(v)) vectorCount += v.length
			else if (ArrayBuffer.isView(v)) vectorCount += 1
		}
		consume(embeddings.retrieval)
		consume(embeddings.clustering)
		return vectorCount * dim * 4
	}

	async saveDataset(datasetId: string, data: {
		embeddings?: unknown
		vectorIndex?: unknown
		documents?: unknown[]
		projection?: unknown
		clusteringProjection?: unknown
		clusters?: unknown
		fileName?: string
		fileType?: string
		textColumn?: string
	}): Promise<boolean> {
		const { embeddings, vectorIndex, documents = [], projection, clusteringProjection, clusters, fileName, fileType, textColumn } = data
		const normalizedEmbeddings = this._normalizeEmbeddingsPayload(embeddings)
		const now = Date.now()

		try {
			await Promise.all([
				this.embeddingsStore.setItem(datasetId, { embeddings: normalizedEmbeddings, timestamp: now }),
				this.indexStore.setItem(datasetId, { index: vectorIndex, timestamp: now }),
				this.documentsStore.setItem(datasetId, { documents, timestamp: now }),
				this.visualizationStore.setItem(datasetId, { projection, clusteringProjection, clusters, timestamp: now }),
				this.metadataStore.setItem(datasetId, {
					fileName, fileType, textColumn,
					numDocuments: documents.length,
					embeddingModel: normalizedEmbeddings?.model || 'unknown',
					embeddingSchema: normalizedEmbeddings?.schema || (normalizedEmbeddings ? 'single-embedding-legacy' : 'none'),
					timestamp: now,
				} satisfies DatasetMeta),
			])
			return true
		} catch (error) {
			await Promise.allSettled([
				this.embeddingsStore.removeItem(datasetId),
				this.indexStore.removeItem(datasetId),
				this.documentsStore.removeItem(datasetId),
				this.visualizationStore.removeItem(datasetId),
				this.metadataStore.removeItem(datasetId),
			])
			throw new Error(`Save failed: ${(error as Error).message}`)
		}
	}

	async loadDataset(datasetId: string): Promise<DatasetRecord> {
		const [embeddingsData, indexData, documentsData, visualizationData, metadata] = await Promise.all([
			this.embeddingsStore.getItem<{ embeddings: unknown }>(datasetId),
			this.indexStore.getItem<{ index: unknown }>(datasetId),
			this.documentsStore.getItem<{ documents: unknown[] }>(datasetId),
			this.visualizationStore.getItem<{ projection: unknown; clusteringProjection: unknown; clusters: unknown }>(datasetId),
			this.metadataStore.getItem<DatasetMeta>(datasetId),
		])

		if (!embeddingsData || !documentsData) throw new Error('Dataset not found')

		return {
			embeddings: this._normalizeEmbeddingsPayload(embeddingsData.embeddings),
			vectorIndex: indexData?.index,
			documents: documentsData.documents,
			projection: visualizationData?.projection,
			clusteringProjection: visualizationData?.clusteringProjection,
			clusters: visualizationData?.clusters,
			metadata,
		}
	}

	async hasDataset(datasetId: string): Promise<boolean> {
		return (await this.metadataStore.getItem(datasetId)) !== null
	}

	async listDatasets(): Promise<(DatasetMeta & { id: string })[]> {
		const keys = await this.metadataStore.keys()
		const results = await Promise.all(
			keys.map(async key => {
				const meta = await this.metadataStore.getItem<DatasetMeta>(key)
				return meta ? { id: key, ...meta } : null
			})
		)
		return (results.filter(Boolean) as (DatasetMeta & { id: string })[]).sort((a, b) => b.timestamp - a.timestamp)
	}

	async deleteDataset(datasetId: string): Promise<boolean> {
		await Promise.all([
			this.embeddingsStore.removeItem(datasetId),
			this.indexStore.removeItem(datasetId),
			this.documentsStore.removeItem(datasetId),
			this.visualizationStore.removeItem(datasetId),
			this.metadataStore.removeItem(datasetId),
		])
		return true
	}

	async clearAll(): Promise<void> {
		await Promise.all([
			this.embeddingsStore.clear(),
			this.indexStore.clear(),
			this.documentsStore.clear(),
			this.visualizationStore.clear(),
			this.metadataStore.clear(),
		])
	}

	async getStats(): Promise<StorageStats> {
		const [embKeys, idxKeys, docKeys, vizKeys, metaKeys] = await Promise.all([
			this.embeddingsStore.keys(),
			this.indexStore.keys(),
			this.documentsStore.keys(),
			this.visualizationStore.keys(),
			this.metadataStore.keys(),
		])

		const datasets = await this.listDatasets()
		let totalSize = 0
		for (const dataset of datasets) {
			const embData = await this.embeddingsStore.getItem<{ embeddings: unknown }>(dataset.id)
			if (embData?.embeddings) {
				totalSize += this._estimateEmbeddingBytes(this._normalizeEmbeddingsPayload(embData.embeddings))
			}
		}

		return {
			numDatasets: metaKeys.length,
			numEmbeddings: embKeys.length,
			numIndexes: idxKeys.length,
			numDocuments: docKeys.length,
			numVisualizations: vizKeys.length,
			estimatedSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
			datasets,
		}
	}

	async saveSettings(settings: Record<string, unknown>): Promise<void> {
		await this.metadataStore.setItem('__settings__', { ...settings, timestamp: Date.now() })
	}

	async loadSettings(): Promise<Record<string, unknown>> {
		return (await this.metadataStore.getItem<Record<string, unknown>>('__settings__')) ?? {}
	}

	async saveSession(sessionData: Record<string, unknown>): Promise<void> {
		await this.metadataStore.setItem('__current_session__', { ...sessionData, timestamp: Date.now() })
	}

	async loadSession(): Promise<Record<string, unknown> | null> {
		return this.metadataStore.getItem<Record<string, unknown>>('__current_session__')
	}

	async clearSession(): Promise<void> {
		await this.metadataStore.removeItem('__current_session__')
	}

	async exportDataset(datasetId: string): Promise<Blob> {
		const data = await this.loadDataset(datasetId)
		return new Blob([JSON.stringify({ version: '2.0', datasetId, ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
	}

	async importDataset(jsonData: string | Record<string, unknown>): Promise<string> {
		const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData
		if (data.version !== '2.0') console.warn('Warning: Importing data from different version')
		const datasetId = (data.datasetId as string) || `import_${Date.now()}`
		await this.saveDataset(datasetId, {
			embeddings: data.embeddings,
			vectorIndex: data.vectorIndex,
			documents: data.documents as unknown[],
			projection: data.projection,
			clusteringProjection: data.clusteringProjection,
			clusters: data.clusters,
			fileName: data.metadata?.fileName,
			fileType: data.metadata?.fileType,
			textColumn: data.metadata?.textColumn,
		})
		return datasetId
	}
}

export const storage = new BrowserStorage()
