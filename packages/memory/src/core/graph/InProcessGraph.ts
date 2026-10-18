import type { EdgeType, Entity, GraphEdge, MemoryEntry } from '../../types'
import { extractEntityRefs } from '../pipeline/processors/T0EntityExtractor'

/**
 * In-process knowledge graph (Phase 1 - mobile/web).
 *
 * Uses an adjacency map backed by memory (not persisted across page reloads
 * unless the caller serializes/deserializes via the store).
 *
 * Desktop Phase 3 will replace this with Neo4j/Memgraph, but through the same interface.
 *
 * Graph building uses a 3-pass algorithm (Smriti design):
 *   Pass 1 - Entity co-occurrence: wire `mentions` edges for entities sharing an entry
 *   Pass 2 - Typed edge inference: promote co-occurrence ≥ 2 pairs to typed edges
 *   Pass 3 - Salience clustering: greedy cluster assignment by edge weight
 */

export class InProcessGraph {
	/** entityId → Entity */
	private entities = new Map<string, Entity>()
	/** "fromId:type:toId" → GraphEdge */
	private edges = new Map<string, GraphEdge>()
	/** entityId → Set<edgeKey> */
	private adjacency = new Map<string, Set<string>>()

	// ── 3-pass state ──────────────────────────────────────────────────────────

	/**
	 * Co-occurrence matrix: entityId → neighborEntityId → count.
	 * Populated by recordCoOccurrences (Pass 1).
	 */
	private coOccurrences = new Map<string, Map<string, number>>()

	/**
	 * Cluster assignments: entityId → clusterId.
	 * Populated by computeClusters (Pass 3).
	 */
	private clusterAssignments = new Map<string, number>()

	// ── Entity management ────────────────────────────────────────────────────

	upsertEntity(entity: Entity): void {
		this.entities.set(entity.id, { ...entity })
	}

	getEntity(id: string): Entity | undefined {
		return this.entities.get(id)
	}

	findEntityByName(name: string): Entity | undefined {
		const lower = name.toLowerCase()
		for (const entity of this.entities.values()) {
			if (
				entity.name.toLowerCase() === lower ||
				entity.aliases?.some((a) => a.toLowerCase() === lower)
			) {
				return entity
			}
		}
		return undefined
	}

	// ── Edge management ──────────────────────────────────────────────────────

	createEdge(from: string, type: EdgeType, to: string, weight = 1.0): GraphEdge {
		const key = `${from}:${type}:${to}`
		const existing = this.edges.get(key)
		if (existing) {
			// Strengthen existing edge
			existing.weight = Math.min(1.0, existing.weight + weight * 0.1)
			return existing
		}
		const edge: GraphEdge = { from, type, to, weight, createdAt: new Date().toISOString() }
		this.edges.set(key, edge)

		if (!this.adjacency.has(from)) this.adjacency.set(from, new Set())
		if (!this.adjacency.has(to)) this.adjacency.set(to, new Set())
		this.adjacency.get(from)!.add(key)
		this.adjacency.get(to)!.add(key)

		return edge
	}

	getEdges(nodeId: string, type?: EdgeType): GraphEdge[] {
		const keys = this.adjacency.get(nodeId) ?? new Set()
		const result: GraphEdge[] = []
		for (const key of keys) {
			const edge = this.edges.get(key)
			if (edge && (!type || edge.type === type)) {
				result.push(edge)
			}
		}
		return result
	}

	removeWeakEdges(minWeight = 0.1): number {
		let removed = 0
		for (const [key, edge] of this.edges) {
			if (edge.weight < minWeight) {
				this.edges.delete(key)
				this.adjacency.get(edge.from)?.delete(key)
				this.adjacency.get(edge.to)?.delete(key)
				removed++
			}
		}
		return removed
	}

	// ── Self-wiring on episodic writes ───────────────────────────────────────

	/**
	 * Called on every episodic memory write (T0 - zero LLM cost).
	 * Extracts entity references from content and wires 'mentions' edges.
	 */
	wireEntry(entry: MemoryEntry): void {
		const text = [entry.title ?? '', entry.content].join(' ')
		const refs = extractEntityRefs(text)

		const entityIds: string[] = []
		for (const ref of refs) {
			// Ensure entity node exists
			const entityId = slugify(ref.name)
			if (!this.entities.has(entityId)) {
				this.upsertEntity({
					id: entityId,
					name: ref.name,
					type: ref.type as Entity['type'],
				})
			}
			entityIds.push(entityId)
			// Wire 'mentions' edge
			this.createEdge(entry.id, 'mentions', entityId)
		}

		// Also record co-occurrences inline for incremental updates
		if (entityIds.length > 1) {
			this.recordCoOccurrences(entry.id, entityIds)
		}
	}

	// ── 3-pass graph building ─────────────────────────────────────────────────

	/**
	 * Run all 3 passes over a batch of entries. Call after bulk loading.
	 *
	 * Pass 1: entity co-occurrence per entry
	 * Pass 2: typed edge inference from accumulated co-occurrence
	 * Pass 3: salience-based cluster assignment
	 */
	buildGraph(entries: { id: string; entities: string[]; type: string }[]): void {
		// Pass 1
		for (const entry of entries) {
			const entityIds = entry.entities.map((name) => slugify(name))

			// Ensure entity nodes exist (we only have name, infer type from pass-1 data)
			for (let i = 0; i < entry.entities.length; i++) {
				const entityId = entityIds[i]!
				if (!this.entities.has(entityId)) {
					this.upsertEntity({
						id: entityId,
						name: entry.entities[i]!,
						type: inferEntityType(entry.entities[i]!),
					})
				}
				// Wire mentions edge from entry to entity
				this.createEdge(entry.id, 'mentions', entityId)
			}

			this.recordCoOccurrences(entry.id, entityIds)
		}

		// Pass 2
		this.inferTypedEdges()

		// Pass 3
		this.computeClusters()
	}

	/**
	 * Pass 1: record entity co-occurrences from a single entry.
	 * All entity pairs that appear together in the same entry get their co-occurrence
	 * count incremented.
	 */
	recordCoOccurrences(entryId: string, entityIds: string[]): void {
		// Create an explicit `mentions` edge to the entry so we can trace provenance
		for (const entityId of entityIds) {
			if (!this.entities.has(entityId)) {
				this.upsertEntity({ id: entityId, name: entityId, type: 'other' })
			}
		}

		// Record all pairwise co-occurrences
		for (let i = 0; i < entityIds.length; i++) {
			const a = entityIds[i]!
			if (!this.coOccurrences.has(a)) this.coOccurrences.set(a, new Map())
			const aMap = this.coOccurrences.get(a)!

			for (let j = i + 1; j < entityIds.length; j++) {
				const b = entityIds[j]!
				if (!this.coOccurrences.has(b)) this.coOccurrences.set(b, new Map())
				const bMap = this.coOccurrences.get(b)!

				// Increment both directions for O(1) lookup
				aMap.set(b, (aMap.get(b) ?? 0) + 1)
				bMap.set(a, (bMap.get(a) ?? 0) + 1)
			}
		}

		// Suppress unused-variable warning for entryId - it's part of the API contract
		void entryId
	}

	/**
	 * Pass 2: infer typed edges from accumulated co-occurrence data.
	 * For every entity pair with co-occurrence ≥ 2, create a typed edge based on
	 * entity types:
	 *   person + organization → works_at (0.6)
	 *   person + project      → owns (0.6)
	 *   project + system      → depends_on (0.5)
	 *   system + system       → depends_on (0.5)
	 *   person + person       → references (0.4)
	 */
	inferTypedEdges(): void {
		for (const [entityIdA, neighbors] of this.coOccurrences) {
			const entityA = this.entities.get(entityIdA)
			if (!entityA) continue

			for (const [entityIdB, count] of neighbors) {
				if (count < 2) continue
				if (entityIdA >= entityIdB) continue // process each pair once

				const entityB = this.entities.get(entityIdB)
				if (!entityB) continue

				const typedEdge = inferEdgeType(entityA.type, entityB.type)
				if (!typedEdge) continue

				const { edgeType, weight, fromId, toId } = resolveEdgeDirection(
					entityIdA, entityA.type,
					entityIdB, entityB.type,
					typedEdge.edgeType,
					typedEdge.weight
				)

				this.createEdge(fromId, edgeType, toId, weight)
			}
		}
	}

	/**
	 * Pass 3: compute salience-based clustering.
	 * Assigns cluster IDs to entities. Entities with edge weight > 0.5 to a
	 * cluster representative are in the same cluster.
	 *
	 * Returns a map of entityId → clusterId.
	 */
	computeClusters(): Map<string, number> {
		this.clusterAssignments.clear()

		// Score entities by degree (number of edges) - higher degree = better representative
		const degrees = new Map<string, number>()
		for (const entityId of this.entities.keys()) {
			const edgeCount = (this.adjacency.get(entityId) ?? new Set()).size
			degrees.set(entityId, edgeCount)
		}

		// Sort entities by degree descending to process high-degree nodes first
		const sortedEntityIds = Array.from(this.entities.keys()).sort(
			(a, b) => (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0)
		)

		let nextClusterId = 0

		for (const entityId of sortedEntityIds) {
			if (this.clusterAssignments.has(entityId)) continue

			// This entity becomes a cluster representative
			const clusterId = nextClusterId++
			this.clusterAssignments.set(entityId, clusterId)

			// Assign all neighbors with edge weight > 0.5 to this cluster
			for (const edge of this.getEdges(entityId)) {
				if (edge.weight <= 0.5) continue

				const neighborId = edge.from === entityId ? edge.to : edge.from
				// Only assign to entity nodes (not memory entry nodes)
				if (!this.entities.has(neighborId)) continue
				if (!this.clusterAssignments.has(neighborId)) {
					this.clusterAssignments.set(neighborId, clusterId)
				}
			}
		}

		return new Map(this.clusterAssignments)
	}

	/**
	 * Get all entities in the same cluster as the given entity.
	 * Returns entity IDs (not including the queried entity itself).
	 */
	getCluster(entityId: string): string[] {
		const clusterId = this.clusterAssignments.get(entityId)
		if (clusterId === undefined) return []

		const result: string[] = []
		for (const [id, cId] of this.clusterAssignments) {
			if (id !== entityId && cId === clusterId) {
				result.push(id)
			}
		}
		return result
	}

	// ── Traversal ────────────────────────────────────────────────────────────

	/**
	 * Expand neighbors of a node up to `depth` hops.
	 * Returns node IDs (both memory entries and entities).
	 */
	expandNeighbors(nodeId: string, depth = 2): string[] {
		const visited = new Set<string>()
		const queue: { id: string; d: number }[] = [{ id: nodeId, d: 0 }]

		while (queue.length > 0) {
			const item = queue.shift()!
			if (visited.has(item.id) || item.d > depth) continue
			visited.add(item.id)

			for (const edge of this.getEdges(item.id)) {
				const neighbor = edge.from === item.id ? edge.to : edge.from
				if (!visited.has(neighbor)) {
					queue.push({ id: neighbor, d: item.d + 1 })
				}
			}
		}

		visited.delete(nodeId)
		return Array.from(visited)
	}

	// ── Serialization ─────────────────────────────────────────────────────────

	serialize(): { entities: Entity[]; edges: GraphEdge[] } {
		return {
			entities: Array.from(this.entities.values()),
			edges: Array.from(this.edges.values()),
		}
	}

	deserialize(data: { entities: Entity[]; edges: GraphEdge[] }): void {
		this.entities.clear()
		this.edges.clear()
		this.adjacency.clear()
		this.coOccurrences.clear()
		this.clusterAssignments.clear()

		for (const entity of data.entities) {
			this.upsertEntity(entity)
		}
		for (const edge of data.edges) {
			this.createEdge(edge.from, edge.type, edge.to, edge.weight)
		}
	}

	get stats(): { entityCount: number; edgeCount: number } {
		return { entityCount: this.entities.size, edgeCount: this.edges.size }
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}

type EntityType = Entity['type']

/**
 * Given two entity types, return the preferred typed edge and its weight.
 * Returns null if no typed edge applies.
 */
function inferEdgeType(
	typeA: EntityType,
	typeB: EntityType
): { edgeType: EdgeType; weight: number; personFirst?: boolean } | null {
	const pair = [typeA, typeB].sort().join('+') as string

	const rules: Record<string, { edgeType: EdgeType; weight: number; personFirst?: boolean }> = {
		'organization+person': { edgeType: 'works_at', weight: 0.6, personFirst: true },
		'person+project':      { edgeType: 'owns',     weight: 0.6, personFirst: true },
		'project+system':      { edgeType: 'depends_on', weight: 0.5, personFirst: false },
		'system+system':       { edgeType: 'depends_on', weight: 0.5 },
		'person+person':       { edgeType: 'references', weight: 0.4 },
	}

	return rules[pair] ?? null
}

/**
 * Determine the canonical direction for a typed edge.
 * Some edges are directional (person → organization for works_at).
 */
function resolveEdgeDirection(
	idA: string,
	typeA: EntityType,
	idB: string,
	typeB: EntityType,
	edgeType: EdgeType,
	weight: number
): { fromId: string; toId: string; edgeType: EdgeType; weight: number } {
	// For works_at: person → organization
	if (edgeType === 'works_at') {
		const personId = typeA === 'person' ? idA : idB
		const orgId = typeA === 'organization' ? idA : idB
		return { fromId: personId, toId: orgId, edgeType, weight }
	}
	// For owns: person → project
	if (edgeType === 'owns') {
		const personId = typeA === 'person' ? idA : idB
		const projectId = typeA === 'project' ? idA : idB
		return { fromId: personId, toId: projectId, edgeType, weight }
	}
	// For depends_on: project → system, or system → system (alphabetical for determinism)
	if (edgeType === 'depends_on') {
		if (typeA === 'project' || (typeA === 'system' && idA <= idB)) {
			return { fromId: idA, toId: idB, edgeType, weight }
		}
		return { fromId: idB, toId: idA, edgeType, weight }
	}
	// Default: alphabetical order for determinism
	if (idA <= idB) {
		return { fromId: idA, toId: idB, edgeType, weight }
	}
	return { fromId: idB, toId: idA, edgeType, weight }
}

/**
 * Heuristic: infer entity type from the entity name when no explicit type is available.
 * Used when buildGraph receives entity names without type metadata.
 */
function inferEntityType(name: string): EntityType {
	// CamelCase → likely a system/tech term
	if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(name)) return 'system'
	// Contains @ → email / person
	if (name.includes('@')) return 'person'
	// All caps short → likely a system or concept
	if (/^[A-Z]{2,8}$/.test(name)) return 'concept'
	// Title-case multi-word → person or organization
	if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(name)) return 'person'
	return 'concept'
}
