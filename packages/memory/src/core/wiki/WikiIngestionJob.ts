/**
 * Wiki ingestion pipeline.
 * Phase 4 - ported from packages/extension/src/memory/wiki/WikiIngestionJob.ts.
 *
 * Depends on IGraphOps and IWikiStore interfaces so it works with any backend.
 */

import type { WikiPage, WikiKnowledgeBaseConfig, NodeKind, GraphEdgeType, StoredGraphEdge } from '../../types'
import type { IInferenceAdapter } from '../inference/IInferenceAdapter'
import { WikiEdgeWeights } from './wikiEdgeWeights'

// ── Injected interfaces ───────────────────────────────────────────────────────

export interface IGraphOps {
	upsertNode(params: { id: string; kind: NodeKind; title: string; content?: string; sourceIds?: string[]; tags?: string[] }): Promise<void>
	createEdge(params: { from: string; to: string; type: GraphEdgeType; weight?: number; evidence?: string[] }): Promise<StoredGraphEdge>
	getNode(id: string): Promise<{ id: string } | undefined>
	getEdgesFrom(id: string): Promise<StoredGraphEdge[]>
	getEdgesTo(id: string): Promise<StoredGraphEdge[]>
}

export interface IWikiStore {
	getAll(): Promise<WikiPage[]>
	get(id: string): Promise<WikiPage | undefined>
	update(id: string, updates: Partial<WikiPage>): Promise<void>
}

export interface IWikiRawStore {
	get(id: string): Promise<{ processedAt?: number; processedIntoPageIds: string[] } | undefined>
	update(id: string, updates: { processedAt: number; processedIntoPageIds: string[] }): Promise<void>
}

// ── Job ────────────────────────────────────────────────────────────────────────

export class WikiIngestionJob {
	private edgeWeights: WikiEdgeWeights
	private graph: IGraphOps
	private inference: IInferenceAdapter
	private wikiPages: IWikiStore
	private wikiRaw: IWikiRawStore

	constructor(graph: IGraphOps, inference: IInferenceAdapter, wikiPages: IWikiStore, wikiRaw: IWikiRawStore, config: WikiKnowledgeBaseConfig) {
		this.graph = graph
		this.inference = inference
		this.wikiPages = wikiPages
		this.wikiRaw = wikiRaw
		this.edgeWeights = new WikiEdgeWeights(config)
	}

	async run(rawIds: string[]): Promise<void> {
		const allPages = await this.wikiPages.getAll()
		const pageByRawId = new Map<string, WikiPage>()
		for (const page of allPages) {
			for (const rawId of page.sourceRawIds) pageByRawId.set(rawId, page)
		}

		for (const rawId of rawIds) {
			const page = pageByRawId.get(rawId)
			if (!page) continue

			await this._ingestPage(page)

			const raw = await this.wikiRaw.get(rawId)
			if (raw) {
				await this.wikiRaw.update(rawId, {
					processedAt: Date.now(),
					processedIntoPageIds: [...raw.processedIntoPageIds, page.id],
				})
			}
		}
	}

	private async _ingestPage(page: WikiPage): Promise<void> {
		await this._createCanonicalNode(page)
		await this._createWikilinkEdges(page)
		await this._computeInferredEdges(page)
	}

	private async _createCanonicalNode(page: WikiPage): Promise<void> {
		const nodeId = `wiki_${page.slug}`
		await this.graph.upsertNode({ id: nodeId, kind: 'fact', title: page.title, content: page.body, sourceIds: [page.id, ...page.sourceRawIds], tags: ['wiki_page'] })

		const { entities } = await this.inference.extractEntities(page.body)
		for (const name of entities.slice(0, 10)) {
			const entityNodeId = `entity_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
			await this.graph.upsertNode({ id: entityNodeId, kind: 'entity', title: name, sourceIds: [page.id], tags: ['wiki_extracted'] })
			await this.graph.createEdge({ from: nodeId, to: entityNodeId, type: 'about', weight: 1.0, evidence: ['wiki_extraction'] })
		}

		await this.wikiPages.update(page.id, { smritiNodeId: nodeId })
	}

	private async _createWikilinkEdges(page: WikiPage): Promise<void> {
		const fromNodeId = `wiki_${page.slug}`
		for (const linkedSlug of page.wikilinks) {
			const toNodeId = `wiki_${linkedSlug}`
			if (!(await this.graph.getNode(toNodeId))) continue
			const edges = await this.graph.getEdgesFrom(fromNodeId)
			if (edges.some(e => e.to === toNodeId && e.type === 'wikilink')) continue
			await this.graph.createEdge({ from: fromNodeId, to: toNodeId, type: 'wikilink', weight: 1.0, evidence: ['explicit_wikilink'] })
		}
	}

	private async _computeInferredEdges(page: WikiPage): Promise<void> {
		const fromNodeId = `wiki_${page.slug}`
		const allWikiPages = await this.wikiPages.getAll()

		const edgeCache = new Map<string, StoredGraphEdge[]>()
		await Promise.all(allWikiPages.map(async p => {
			const nodeId = `wiki_${p.slug}`
			edgeCache.set(nodeId, await this.graph.getEdgesFrom(nodeId))
		}))

		const outDegrees = new Map<string, number>()
		for (const [nid, edges] of edgeCache) outDegrees.set(nid, edges.filter(e => e.type === 'wikilink').length)

		for (const other of allWikiPages) {
			if (other.id === page.id) continue
			const toNodeId = `wiki_${other.slug}`
			const sharedSourceCount = page.sourceRawIds.filter(id => other.sourceRawIds.includes(id)).length
			const commonNeighbors = this._commonNeighborsCached(fromNodeId, toNodeId, edgeCache)
			const adamicAdar = await this.edgeWeights.calculateAdamicAdar(commonNeighbors, async nid => outDegrees.get(nid) ?? 0)
			const isSameWeek = this.edgeWeights.isSameWeek(page.updatedAt, other.updatedAt)
			const weight = this.edgeWeights.calculateStructuralWeight(0, sharedSourceCount, adamicAdar, isSameWeek)
			const edgeType: GraphEdgeType = sharedSourceCount > 0 ? 'shared_source' : 'common_neighbor'

			const existingEdges = edgeCache.get(fromNodeId) ?? []
			if (weight > 0 && !existingEdges.some(e => e.to === toNodeId && e.type === edgeType)) {
				await this.graph.createEdge({ from: fromNodeId, to: toNodeId, type: edgeType, weight, evidence: sharedSourceCount > 0 ? ['shared_source'] : ['adamic_adar'] })
			}
		}
	}

	private _commonNeighborsCached(nodeA: string, nodeB: string, cache: Map<string, StoredGraphEdge[]>): string[] {
		const a = new Set((cache.get(nodeA) ?? []).filter(e => e.type === 'wikilink').map(e => e.to))
		const b = new Set((cache.get(nodeB) ?? []).filter(e => e.type === 'wikilink').map(e => e.to))
		return [...a].filter(n => b.has(n))
	}
}
