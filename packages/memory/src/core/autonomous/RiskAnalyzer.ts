import type { IBrainEngine } from '../../interfaces/IBrainEngine'
import type { MemoryEntry } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import { ImpactAnalyzer } from '../graph/ImpactAnalyzer'

export interface RiskItem {
	type: 'bottleneck_entity' | 'obsolete_reference' | 'conflicted_critical' | 'coverage_gap'
	entityId?: string
	entryIds?: string[]
	riskScore: number         // 0–1
	description: string
	recommendation: string
}

export interface RiskReport {
	items: RiskItem[]
	overallRisk: 'low' | 'medium' | 'high' | 'critical'
	generatedAt: string
	entriesScanned: number
	topRiskEntityId?: string
}

/**
 * RiskAnalyzer - Phase 5 risk surface detection.
 *
 * Scans memory entries and the knowledge graph to detect:
 * - Bottleneck entities (referenced by >20% of entries, no redundant links)
 * - Obsolete references (entries pointing to deprecated/deleted entities)
 * - Conflicted critical facts (reverify_fact policy + high retrieval count)
 * - Coverage gaps (entity clusters with no artifact entry)
 *
 * Design: Section 5 (Autonomous Cognition) of designCognitiveBrain.md
 */
export class RiskAnalyzer {
	private brain: IBrainEngine
	private graph: InProcessGraph
	private impactAnalyzer: ImpactAnalyzer

	constructor(brain: IBrainEngine, graph: InProcessGraph, impactAnalyzer: ImpactAnalyzer) {
		this.brain = brain
		this.graph = graph
		this.impactAnalyzer = impactAnalyzer
	}

	/**
	 * Generate a full risk report by scanning memory entries and the knowledge graph.
	 */
	async analyze(entries: MemoryEntry[]): Promise<RiskReport> {
		const { entities } = this.graph.serialize()
		const entriesScanned = entries.length

		const riskItems: RiskItem[] = []

		// Run all risk checks in parallel
		const [bottlenecks, obsolete, conflicted, gaps] = await Promise.all([
			this.detectBottleneckEntities(entries, entities),
			this.detectObsoleteReferences(entries, entities),
			this.detectConflictedCritical(entries),
			this.detectCoverageGaps(entries, entities),
		])

		riskItems.push(...bottlenecks, ...obsolete, ...conflicted, ...gaps)

		// Sort by risk score descending
		riskItems.sort((a, b) => b.riskScore - a.riskScore)

		const overallRisk = this.computeOverallRisk(riskItems)
		const topRiskEntityId = riskItems.find((r) => r.entityId)?.entityId

		return {
			items: riskItems,
			overallRisk,
			generatedAt: new Date().toISOString(),
			entriesScanned,
			topRiskEntityId,
		}
	}

	// ── Risk detectors ──────────────────────────────────────────────────────────

	/**
	 * Bottleneck entity: referenced by >20% of entries AND has no redundant knowledge.
	 * No redundant = no other entity that `references` it or is `related_to` it.
	 */
	private async detectBottleneckEntities(
		entries: MemoryEntry[],
		entities: { id: string; name: string; type: string }[]
	): Promise<RiskItem[]> {
		if (entries.length === 0 || entities.length === 0) return []

		const threshold = 0.20
		const minReferenceCount = Math.max(2, Math.ceil(entries.length * threshold))

		// Count how many entries reference each entity
		const referenceCounts = new Map<string, number>()
		for (const entry of entries) {
			const refs = new Set<string>()
			// Check entities field
			for (const eid of (entry.entities ?? [])) {
				refs.add(eid)
			}
			// Check relations
			for (const rel of (entry.relations ?? [])) {
				refs.add(rel.targetId)
			}
			for (const eid of refs) {
				referenceCounts.set(eid, (referenceCounts.get(eid) ?? 0) + 1)
			}
		}

		const items: RiskItem[] = []

		for (const entity of entities) {
			const refCount = referenceCounts.get(entity.id) ?? 0
			if (refCount < minReferenceCount) continue

			// Check for redundant knowledge: other entities that reference or relate to this one
			const edges = this.graph.getEdges(entity.id)
			const hasRedundancy = edges.some(
				(e) => e.type === 'references' || (e as { type: string }).type === 'related_to'
			)

			if (!hasRedundancy) {
				const refPct = Math.round((refCount / entries.length) * 100)
				const riskScore = Math.min(1, (refCount / entries.length) * 2)

				items.push({
					type: 'bottleneck_entity',
					entityId: entity.id,
					riskScore,
					description:
						`Entity "${entity.name}" is referenced by ${refPct}% of entries (${refCount}/${entries.length}) ` +
						`and has no redundant cross-links. Its removal or corruption would have wide impact.`,
					recommendation:
						`Create redundant knowledge links for "${entity.name}": add related entities or ` +
						`synthesize a dedicated vault artifact documenting this concept.`,
				})
			}
		}

		return items
	}

	/**
	 * Obsolete reference: entry references an entity whose lifecycle is 'deprecated' or 'deleted'.
	 */
	private async detectObsoleteReferences(
		entries: MemoryEntry[],
		entities: { id: string; name: string; type: string; metadata?: Record<string, unknown> }[]
	): Promise<RiskItem[]> {
		// Build map of entity id → lifecycle state
		const entityLifecycle = new Map<string, string>()
		for (const entity of entities) {
			const lifecycle = entity.metadata?.lifecycleState as string | undefined
			if (lifecycle === 'deprecated' || lifecycle === 'deleted') {
				entityLifecycle.set(entity.id, lifecycle)
			}
		}

		// Also check graph entities via getEntity
		for (const entity of entities) {
			const graphEntity = this.graph.getEntity(entity.id)
			if (graphEntity?.metadata?.lifecycleState === 'deprecated' ||
				graphEntity?.metadata?.lifecycleState === 'deleted') {
				entityLifecycle.set(entity.id, graphEntity.metadata.lifecycleState as string)
			}
		}

		if (entityLifecycle.size === 0) return []

		const items: RiskItem[] = []
		const obsoleteByEntity = new Map<string, string[]>()

		for (const entry of entries) {
			for (const eid of (entry.entities ?? [])) {
				if (entityLifecycle.has(eid)) {
					if (!obsoleteByEntity.has(eid)) obsoleteByEntity.set(eid, [])
					obsoleteByEntity.get(eid)!.push(entry.id)
				}
			}
		}

		for (const [entityId, entryIds] of obsoleteByEntity) {
			const lifecycle = entityLifecycle.get(entityId)!
			const entity = this.graph.getEntity(entityId)
			const entityName = entity?.name ?? entityId
			const riskScore = Math.min(1, 0.4 + (entryIds.length / entries.length) * 0.6)

			items.push({
				type: 'obsolete_reference',
				entityId,
				entryIds,
				riskScore,
				description:
					`${entryIds.length} entr${entryIds.length === 1 ? 'y references' : 'ies reference'} ` +
					`entity "${entityName}" which is ${lifecycle}. These entries may contain stale information.`,
				recommendation:
					`Review entries referencing "${entityName}" and update or archive them. ` +
					`Consider marking these entries with retentionPolicy: "reverify_fact".`,
			})
		}

		return items
	}

	/**
	 * Conflicted critical: entry with retentionPolicy === 'reverify_fact' AND retrievalCount > 5.
	 */
	private async detectConflictedCritical(entries: MemoryEntry[]): Promise<RiskItem[]> {
		const conflicted = entries.filter(
			(e) => e.retentionPolicy === 'reverify_fact' && (e.retrievalCount ?? 0) > 5
		)

		if (conflicted.length === 0) return []

		const items: RiskItem[] = []

		for (const entry of conflicted) {
			const retrievalCount = entry.retrievalCount ?? 0
			// Higher retrieval count = higher risk (people are acting on unverified facts)
			const riskScore = Math.min(1, 0.5 + Math.log2(retrievalCount) * 0.1)

			items.push({
				type: 'conflicted_critical',
				entryIds: [entry.id],
				riskScore,
				description:
					`Entry "${entry.title ?? entry.id}" requires fact verification ` +
					`(retentionPolicy: reverify_fact) but has been retrieved ${retrievalCount} times. ` +
					`Unverified facts are being actively used in agent reasoning.`,
				recommendation:
					`Immediately verify the facts in entry "${entry.title ?? entry.id}". ` +
					`Update confidence score or synthesize a verified vault artifact to replace it.`,
			})
		}

		return items
	}

	/**
	 * Coverage gap: entity cluster with no corresponding artifact entry.
	 * Uses graph traversal to find clusters; checks if any cluster member
	 * is mentioned in an artifact-type entry.
	 */
	private async detectCoverageGaps(
		entries: MemoryEntry[],
		entities: { id: string; name: string; type: string }[]
	): Promise<RiskItem[]> {
		if (entities.length === 0) return []

		// Build set of entity IDs that appear in artifact entries
		const coveredEntityIds = new Set<string>()
		const artifactEntries = entries.filter((e) => e.type === 'artifact')

		for (const artifact of artifactEntries) {
			for (const eid of (artifact.entities ?? [])) {
				coveredEntityIds.add(eid)
			}
			// Also check relations
			for (const rel of (artifact.relations ?? [])) {
				coveredEntityIds.add(rel.targetId)
			}
		}

		const items: RiskItem[] = []

		// Find entity clusters via graph traversal (2-hop neighbourhoods)
		const visited = new Set<string>()

		for (const entity of entities) {
			if (visited.has(entity.id)) continue

			// Get 2-hop cluster
			const clusterIds = this.graph.expandNeighbors(entity.id, 2)
			const cluster = [entity.id, ...clusterIds]

			for (const id of cluster) visited.add(id)

			if (cluster.length < 2) continue

			// Check if any entity in the cluster is covered by an artifact
			const hasArtifact = cluster.some((id) => coveredEntityIds.has(id))

			if (!hasArtifact) {
				// Compute cluster significance: how many entries mention these entities
				let mentionCount = 0
				const clusterSet = new Set(cluster)
				for (const entry of entries) {
					if (entry.entities?.some((eid) => clusterSet.has(eid))) {
						mentionCount++
					}
				}

				if (mentionCount < 2) continue // Ignore very low-signal clusters

				const riskScore = Math.min(1, 0.2 + (mentionCount / entries.length) * 0.8)
				const clusterNames = cluster
					.slice(0, 3)
					.map((id) => this.graph.getEntity(id)?.name ?? id)
					.join(', ')

				items.push({
					type: 'coverage_gap',
					entityId: entity.id,
					riskScore,
					description:
						`Entity cluster around "${entity.name}" (${cluster.length} entities: ${clusterNames}…) ` +
						`is mentioned in ${mentionCount} entries but has no vault artifact. ` +
						`Knowledge about this cluster exists only in episodic memory.`,
					recommendation:
						`Synthesize a vault artifact for the "${entity.name}" cluster. ` +
						`This will preserve the knowledge and enable cross-session retrieval.`,
				})
			}
		}

		return items
	}

	// ── Risk aggregation ────────────────────────────────────────────────────────

	private computeOverallRisk(items: RiskItem[]): 'low' | 'medium' | 'high' | 'critical' {
		if (items.length === 0) return 'low'

		const maxScore = Math.max(...items.map((r) => r.riskScore))
		const highRiskCount = items.filter((r) => r.riskScore >= 0.7).length

		if (maxScore >= 0.9 || highRiskCount >= 3) return 'critical'
		if (maxScore >= 0.7 || highRiskCount >= 1) return 'high'
		if (maxScore >= 0.4 || items.length >= 3) return 'medium'
		return 'low'
	}
}
