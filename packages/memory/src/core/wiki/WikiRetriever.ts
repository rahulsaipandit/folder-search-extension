import type { GraphNodeRecord, StoredGraphEdge, WikiPage } from '../../types'
import type { IGraphOps, IWikiStore } from './WikiIngestionJob'

export class WikiRetriever {
	private graph: IGraphOps
	private wikiPages: IWikiStore

	constructor(graph: IGraphOps, wikiPages: IWikiStore) {
		this.graph = graph
		this.wikiPages = wikiPages
	}

	async search(query: string, maxDepth = 2): Promise<{
		seedPages: GraphNodeRecord[]
		relatedPages: GraphNodeRecord[]
		traversalPath: string[]
	}> {
		const allPages = await this.wikiPages.getAll()
		const queryLower = query.toLowerCase()
		const matchingPages = allPages.filter(p => p.title.toLowerCase().includes(queryLower))

		const seedNodes: GraphNodeRecord[] = []
		for (const page of matchingPages) {
			const node = await this.graph.getNode(`wiki_${page.slug}`)
			if (node && 'kind' in node) seedNodes.push(node as GraphNodeRecord)
		}

		const visited = new Set<string>()
		const relatedNodes: GraphNodeRecord[] = []
		const traversalPath: string[] = []

		for (const seed of seedNodes) {
			await this._traverseFrom(seed.id, maxDepth, visited, relatedNodes, traversalPath)
		}

		const seedIds = new Set(seedNodes.map(s => s.id))
		return { seedPages: seedNodes, relatedPages: relatedNodes.filter(n => !seedIds.has(n.id)), traversalPath }
	}

	async getNeighbors(pageSlug: string, edgeTypes?: string[]): Promise<{ incoming: StoredGraphEdge[]; outgoing: StoredGraphEdge[] }> {
		const nodeId = `wiki_${pageSlug}`
		const [outgoing, incoming] = await Promise.all([this.graph.getEdgesFrom(nodeId), this.graph.getEdgesTo(nodeId)])
		const filter = (edges: StoredGraphEdge[]) => edgeTypes ? edges.filter(e => edgeTypes.includes(e.type)) : edges
		return { incoming: filter(incoming), outgoing: filter(outgoing) }
	}

	private async _traverseFrom(nodeId: string, depth: number, visited: Set<string>, results: GraphNodeRecord[], path: string[]): Promise<void> {
		if (depth <= 0 || visited.has(nodeId)) return
		visited.add(nodeId)
		path.push(nodeId)

		const edges = await this.graph.getEdgesFrom(nodeId)
		const sorted = edges.filter(e => e.type === 'wikilink' || e.weight > 0.5).sort((a, b) => b.weight - a.weight)

		for (const edge of sorted.slice(0, 5)) {
			const target = await this.graph.getNode(edge.to)
			if (target && 'kind' in target && !visited.has(target.id)) {
				results.push(target as GraphNodeRecord)
				await this._traverseFrom(target.id, depth - 1, visited, results, path)
			}
		}
	}
}
