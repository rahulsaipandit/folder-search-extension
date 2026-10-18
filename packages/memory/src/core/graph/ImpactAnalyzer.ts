import type { EdgeType, GraphEdge } from '../../types'
import { InProcessGraph } from './InProcessGraph'

export interface ImpactResult {
	rootEntityId: string
	impacted: {
		entityId: string
		distance: number        // graph hops from root
		impactScore: number     // 0–1, decays with distance and edge weight
		path: string[]          // entity IDs from root to this entity
	}[]
	totalImpactedCount: number
	criticalPath: string[]    // Highest-impact path (for dependency visualisation)
}

/** Edge types that carry transitive impact. */
const IMPACT_EDGE_TYPES = new Set<EdgeType>(['depends_on', 'references', 'derived_from', 'owns'])

const DEFAULT_DECAY = 0.85
const DEFAULT_MAX_DEPTH = 5
const MIN_SCORE = 0.05

/**
 * ImpactAnalyzer - transitive impact analysis on the knowledge graph.
 *
 * Follows depends_on, references, derived_from, owns edges.
 * Impact score decays per hop: score = edge_weight * parent_score * 0.85
 *
 * Phase 4 - graph analytics.
 */
export class ImpactAnalyzer {
	private graph: InProcessGraph

	constructor(graph: InProcessGraph) {
		this.graph = graph
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Compute the transitive impact of changing/removing an entity.
	 * Stops at maxDepth hops or score < 0.05.
	 */
	analyzeImpact(entityId: string, maxDepth = DEFAULT_MAX_DEPTH): ImpactResult {
		const allEdges = this.graph.serialize().edges
		const adj = this.buildImpactAdjacency(allEdges)

		// BFS with score tracking
		// Each queue item carries: currentId, path so far, score so far
		interface QueueItem { id: string; path: string[]; score: number; distance: number }

		const impacted = new Map<string, { distance: number; impactScore: number; path: string[] }>()
		const queue: QueueItem[] = [{ id: entityId, path: [entityId], score: 1.0, distance: 0 }]
		const visited = new Set<string>([entityId])

		while (queue.length > 0) {
			const item = queue.shift()!

			if (item.distance >= maxDepth) continue

			for (const { neighbour, weight } of (adj.get(item.id) ?? [])) {
				if (visited.has(neighbour)) continue
				visited.add(neighbour)

				const childScore = weight * item.score * DEFAULT_DECAY
				if (childScore < MIN_SCORE) continue

				const childPath = [...item.path, neighbour]
				const childDistance = item.distance + 1

				impacted.set(neighbour, {
					distance: childDistance,
					impactScore: childScore,
					path: childPath,
				})

				queue.push({ id: neighbour, path: childPath, score: childScore, distance: childDistance })
			}
		}

		const impactedArray = Array.from(impacted.entries()).map(([id, data]) => ({
			entityId: id,
			distance: data.distance,
			impactScore: data.impactScore,
			path: data.path,
		}))

		// Sort by impact score desc
		impactedArray.sort((a, b) => b.impactScore - a.impactScore)

		// Critical path = the path of the highest-impact entity
		const criticalPath = impactedArray.length > 0 ? impactedArray[0]!.path : [entityId]

		return {
			rootEntityId: entityId,
			impacted: impactedArray,
			totalImpactedCount: impactedArray.length,
			criticalPath,
		}
	}

	/**
	 * Find the critical (highest-impact) entities in the graph.
	 * Returns entities whose removal would impact the most other entities.
	 */
	findCriticalEntities(topK = 10): { entityId: string; impactScore: number; impactedCount: number }[] {
		const { entities } = this.graph.serialize()

		const results = entities.map((entity) => {
			const result = this.analyzeImpact(entity.id)
			const totalScore = result.impacted.reduce((sum, r) => sum + r.impactScore, 0)
			return {
				entityId: entity.id,
				impactScore: totalScore,
				impactedCount: result.totalImpactedCount,
			}
		})

		results.sort((a, b) => b.impactedCount - a.impactedCount || b.impactScore - a.impactScore)
		return results.slice(0, topK)
	}

	/**
	 * Check if entityA transitively depends on entityB.
	 * Uses BFS over depends_on and derived_from edges.
	 */
	dependsOn(entityAId: string, entityBId: string): boolean {
		const allEdges = this.graph.serialize().edges

		// Build dependency adjacency (depends_on + derived_from only)
		const depAdj = new Map<string, string[]>()
		for (const edge of allEdges) {
			if (edge.type !== 'depends_on' && edge.type !== 'derived_from') continue
			if (!depAdj.has(edge.from)) depAdj.set(edge.from, [])
			depAdj.get(edge.from)!.push(edge.to)
		}

		const visited = new Set<string>()
		const queue: string[] = [entityAId]

		while (queue.length > 0) {
			const current = queue.shift()!
			if (visited.has(current)) continue
			visited.add(current)

			for (const neighbour of (depAdj.get(current) ?? [])) {
				if (neighbour === entityBId) return true
				if (!visited.has(neighbour)) queue.push(neighbour)
			}
		}

		return false
	}

	// ── Private helpers ─────────────────────────────────────────────────────────

	/**
	 * Build a directed adjacency list for impact-carrying edges only.
	 */
	private buildImpactAdjacency(
		allEdges: GraphEdge[]
	): Map<string, { neighbour: string; weight: number }[]> {
		const adj = new Map<string, { neighbour: string; weight: number }[]>()

		for (const edge of allEdges) {
			if (!IMPACT_EDGE_TYPES.has(edge.type)) continue

			// Impact flows from the "depends on" target to the dependent
			// (changing B impacts A when A depends_on B)
			if (!adj.has(edge.to)) adj.set(edge.to, [])
			adj.get(edge.to)!.push({ neighbour: edge.from, weight: edge.weight })

			// For 'owns' and 'derived_from', also follow forward direction
			if (edge.type === 'owns' || edge.type === 'derived_from') {
				if (!adj.has(edge.from)) adj.set(edge.from, [])
				adj.get(edge.from)!.push({ neighbour: edge.to, weight: edge.weight })
			}
		}

		return adj
	}
}
