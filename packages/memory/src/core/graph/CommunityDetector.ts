import type { GraphEdge } from '../../types'
import { InProcessGraph } from './InProcessGraph'

export interface Community {
	id: number
	entityIds: string[]
	centroid: string        // The highest-degree entity in this community
	density: number         // avg edge weight within community / max possible
	label?: string          // Auto-generated from most common entity types
}

/**
 * CommunityDetector - Louvain-inspired greedy community detection.
 *
 * Operates on the InProcessGraph entity subgraph. Each entity begins in its
 * own singleton community; greedy merges continue while modularity increases.
 *
 * Phase 4 - graph analytics.
 */
export class CommunityDetector {
	private graph: InProcessGraph

	/** entityId → communityId */
	private assignment = new Map<string, number>()
	/** communityId → set of entityIds */
	private communities = new Map<number, Set<string>>()

	private nextCommunityId = 0
	private detected = false

	constructor(graph: InProcessGraph) {
		this.graph = graph
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Detect communities using greedy modularity optimisation.
	 * Each entity starts in its own community. Iteratively merge communities
	 * when merging increases modularity. Stop when no merge increases modularity.
	 * Returns communities sorted by size (largest first).
	 */
	detect(): Community[] {
		this.initialise()

		const allEdges = this.getAllEdges()
		const totalEdgeWeight = allEdges.reduce((sum, e) => sum + e.weight, 0)

		if (totalEdgeWeight === 0) {
			return this.buildResult()
		}

		let improved = true
		while (improved) {
			improved = false

			for (const entityId of this.assignment.keys()) {
				const currentCommunity = this.assignment.get(entityId)!
				const neighbours = this.getEntityNeighbours(entityId, allEdges)

				// Collect candidate communities from neighbours
				const candidateCommunities = new Set<number>()
				for (const nb of neighbours.keys()) {
					const nbCommunity = this.assignment.get(nb)
					if (nbCommunity !== undefined && nbCommunity !== currentCommunity) {
						candidateCommunities.add(nbCommunity)
					}
				}

				if (candidateCommunities.size === 0) continue

				const baseQ = this.computeModularity(allEdges, totalEdgeWeight)

				let bestQ = baseQ
				let bestCommunity = currentCommunity

				for (const candidateId of candidateCommunities) {
					// Temporarily move entity to candidate community
					this.moveEntity(entityId, currentCommunity, candidateId)
					const newQ = this.computeModularity(allEdges, totalEdgeWeight)
					if (newQ > bestQ) {
						bestQ = newQ
						bestCommunity = candidateId
					}
					// Revert
					this.moveEntity(entityId, candidateId, currentCommunity)
				}

				if (bestCommunity !== currentCommunity) {
					this.moveEntity(entityId, currentCommunity, bestCommunity)
					improved = true
				}
			}
		}

		// Remove empty communities
		for (const [id, members] of this.communities) {
			if (members.size === 0) this.communities.delete(id)
		}

		this.detected = true
		return this.buildResult()
	}

	/**
	 * Return the community ID for a given entity.
	 * Returns -1 if entity is not in any community.
	 */
	getCommunityId(entityId: string): number {
		if (!this.detected) this.detect()
		return this.assignment.get(entityId) ?? -1
	}

	/**
	 * Return entities sorted by betweenness centrality (approximation).
	 * Uses BFS from up to 10 random source entities.
	 */
	getBridgeEntities(topK = 10): { entityId: string; centrality: number }[] {
		const allEdges = this.getAllEdges()
		const entityIds = Array.from(this.assignment.keys())

		if (entityIds.length === 0) return []

		// Select source entities: all if <50, otherwise 10 random
		const sources = entityIds.length < 50
			? entityIds
			: sampleRandom(entityIds, 10)

		const passThroughCount = new Map<string, number>()
		for (const id of entityIds) passThroughCount.set(id, 0)

		for (const source of sources) {
			this.bfsShortestPaths(source, entityIds, allEdges, passThroughCount)
		}

		// Normalise to [0, 1]
		const maxCount = Math.max(...passThroughCount.values(), 1)
		const results = entityIds.map((id) => ({
			entityId: id,
			centrality: (passThroughCount.get(id) ?? 0) / maxCount,
		}))

		results.sort((a, b) => b.centrality - a.centrality)
		return results.slice(0, topK)
	}

	// ── Private helpers ─────────────────────────────────────────────────────────

	private initialise(): void {
		this.assignment.clear()
		this.communities.clear()
		this.nextCommunityId = 0
		this.detected = false

		const { entities } = this.graph.serialize()
		for (const entity of entities) {
			const cid = this.nextCommunityId++
			this.assignment.set(entity.id, cid)
			this.communities.set(cid, new Set([entity.id]))
		}
	}

	private getAllEdges(): GraphEdge[] {
		// Use serialized edges to get all edges
		return this.graph.serialize().edges
	}

	private getEntityNeighbours(
		entityId: string,
		allEdges: GraphEdge[]
	): Map<string, number> {
		const neighbours = new Map<string, number>()
		for (const edge of allEdges) {
			if (edge.from === entityId) {
				neighbours.set(edge.to, (neighbours.get(edge.to) ?? 0) + edge.weight)
			} else if (edge.to === entityId) {
				neighbours.set(edge.from, (neighbours.get(edge.from) ?? 0) + edge.weight)
			}
		}
		return neighbours
	}

	private moveEntity(entityId: string, fromCommunity: number, toCommunity: number): void {
		this.assignment.set(entityId, toCommunity)
		this.communities.get(fromCommunity)?.delete(entityId)
		if (!this.communities.has(toCommunity)) {
			this.communities.set(toCommunity, new Set())
		}
		this.communities.get(toCommunity)!.add(entityId)
	}

	/**
	 * Modularity Q = Σ_c [ (edges_within_c / total_edges) - (degree_c / 2*total_edges)^2 ]
	 */
	private computeModularity(allEdges: GraphEdge[], totalEdgeWeight: number): number {
		if (totalEdgeWeight === 0) return 0

		// Build degree map
		const degree = new Map<string, number>()
		for (const edge of allEdges) {
			degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.weight)
			degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.weight)
		}

		let Q = 0
		for (const members of this.communities.values()) {
			if (members.size === 0) continue

			let edgesWithin = 0
			let communityDegree = 0

			for (const member of members) {
				communityDegree += degree.get(member) ?? 0
			}

			for (const edge of allEdges) {
				if (members.has(edge.from) && members.has(edge.to)) {
					edgesWithin += edge.weight
				}
			}

			const eC = edgesWithin / totalEdgeWeight
			const aC = communityDegree / (2 * totalEdgeWeight)
			Q += eC - aC * aC
		}

		return Q
	}

	private buildResult(): Community[] {
		const allEdges = this.getAllEdges()
		const { entities } = this.graph.serialize()

		// Build entity type map
		const entityTypeMap = new Map<string, string>()
		for (const e of entities) {
			entityTypeMap.set(e.id, e.type)
		}

		// Compute degree per entity
		const degree = new Map<string, number>()
		for (const edge of allEdges) {
			degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
			degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
		}

		const result: Community[] = []

		for (const [communityId, members] of this.communities) {
			if (members.size === 0) continue

			const memberArray = Array.from(members)

			// Centroid = highest-degree entity
			memberArray.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
			const centroid = memberArray[0]!

			// Density: avg edge weight within community / max possible
			const memberSet = new Set(memberArray)
			let edgeWeightSum = 0
			let edgeCount = 0
			for (const edge of allEdges) {
				if (memberSet.has(edge.from) && memberSet.has(edge.to)) {
					edgeWeightSum += edge.weight
					edgeCount++
				}
			}
			const maxPossibleEdges = memberArray.length * (memberArray.length - 1)
			const avgWeight = edgeCount > 0 ? edgeWeightSum / edgeCount : 0
			const density = maxPossibleEdges > 0 ? (edgeWeightSum / maxPossibleEdges) : 0

			// Label = most common entity type
			const typeCounts = new Map<string, number>()
			for (const id of memberArray) {
				const t = entityTypeMap.get(id) ?? 'other'
				typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
			}
			let label: string | undefined
			let maxCount = 0
			for (const [type, count] of typeCounts) {
				if (count > maxCount) { maxCount = count; label = type }
			}

			result.push({
				id: communityId,
				entityIds: memberArray,
				centroid,
				density,
				label,
			})

			void avgWeight // density already accounts for weight
		}

		// Sort by size descending
		result.sort((a, b) => b.entityIds.length - a.entityIds.length)
		return result
	}

	/**
	 * BFS from a source node; accumulates pass-through counts into the provided map.
	 * Uses an approximation: for each target, count intermediate nodes on shortest path.
	 */
	private bfsShortestPaths(
		source: string,
		allEntityIds: string[],
		allEdges: GraphEdge[],
		passThroughCount: Map<string, number>
	): void {
		// Build adjacency for BFS
		const adj = new Map<string, string[]>()
		for (const edge of allEdges) {
			if (!adj.has(edge.from)) adj.set(edge.from, [])
			if (!adj.has(edge.to)) adj.set(edge.to, [])
			adj.get(edge.from)!.push(edge.to)
			adj.get(edge.to)!.push(edge.from)
		}

		// BFS to find shortest paths
		const dist = new Map<string, number>()
		const predecessors = new Map<string, string[]>()
		const queue: string[] = [source]
		dist.set(source, 0)

		while (queue.length > 0) {
			const node = queue.shift()!
			const nodeDist = dist.get(node)!
			for (const neighbour of (adj.get(node) ?? [])) {
				if (!dist.has(neighbour)) {
					dist.set(neighbour, nodeDist + 1)
					predecessors.set(neighbour, [node])
					queue.push(neighbour)
				} else if (dist.get(neighbour) === nodeDist + 1) {
					predecessors.get(neighbour)!.push(node)
				}
			}
		}

		// For each reachable entity, trace back and increment intermediate nodes
		for (const target of allEntityIds) {
			if (target === source || !dist.has(target)) continue

			// Backtrack along predecessors and count intermediate nodes
			const intermediates = new Set<string>()
			const stack: string[] = [target]

			while (stack.length > 0) {
				const node = stack.pop()!
				for (const pred of (predecessors.get(node) ?? [])) {
					if (pred !== source) {
						intermediates.add(pred)
						stack.push(pred)
					}
				}
			}

			for (const intermediate of intermediates) {
				passThroughCount.set(intermediate, (passThroughCount.get(intermediate) ?? 0) + 1)
			}
		}
	}
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sampleRandom<T>(arr: T[], n: number): T[] {
	const copy = [...arr]
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		const tmp = copy[i]!
		copy[i] = copy[j]!
		copy[j] = tmp
	}
	return copy.slice(0, n)
}
