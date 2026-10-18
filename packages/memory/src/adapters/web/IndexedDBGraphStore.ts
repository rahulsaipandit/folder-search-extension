/**
 * IndexedDB-backed graph store.
 *
 * Owns the `smriti-graph` database (graph_nodes, graph_edges).
 * Phase 4 migration from packages/extension/src/memory/graphStore.ts +
 * extension storage/repositories.ts (GraphNodeRepo, GraphEdgeRepo).
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { GraphNodeRecord, StoredGraphEdge, GraphEdgeType, NodeKind } from '../../types'
import { nextId } from '../../utils/nextId'

const DB_NAME = 'smriti-graph'
const DB_VERSION = 1
const WORKER_ID = 'graph-store'

interface GraphDBSchema extends DBSchema {
	graph_nodes: {
		key: string
		value: GraphNodeRecord
		indexes: { 'by-kind': string; 'by-tag': string }
	}
	graph_edges: {
		key: string
		value: StoredGraphEdge
		indexes: { 'by-from': string; 'by-to': string; 'by-type': string }
	}
}

let _db: IDBPDatabase<GraphDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<GraphDBSchema>> {
	if (_db) return _db
	_db = await openDB<GraphDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			const nodes = db.createObjectStore('graph_nodes', { keyPath: 'id' })
			nodes.createIndex('by-kind', 'kind')
			nodes.createIndex('by-tag', 'tags', { multiEntry: true })

			const edges = db.createObjectStore('graph_edges', { keyPath: 'id' })
			edges.createIndex('by-from', 'from')
			edges.createIndex('by-to', 'to')
			edges.createIndex('by-type', 'type')
		},
	})
	return _db
}

function stampNode(record: Omit<GraphNodeRecord, 'version' | 'lastMutatedBy' | 'lastMutatedAt'> & { id: string; version?: number }): GraphNodeRecord {
	return { ...record, version: record.version ?? 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() } as GraphNodeRecord
}

export class IndexedDBGraphStore {
	// ── Node operations ───────────────────────────────────────────────────────

	async upsertNode(params: {
		id: string
		kind: NodeKind
		title: string
		content?: string
		sourceIds?: string[]
		tags?: string[]
		metadata?: Record<string, unknown>
	}): Promise<void> {
		const db = await getDB()
		const existing = await db.get('graph_nodes', params.id)
		const node: GraphNodeRecord = stampNode({
			id: params.id,
			kind: params.kind,
			title: params.title,
			content: params.content,
			sourceIds: params.sourceIds ?? [],
			tags: params.tags ?? [],
			metadata: params.metadata,
			createdAt: existing?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			version: (existing?.version ?? 0) + 1,
		})
		await db.put('graph_nodes', node)
	}

	async getNode(id: string): Promise<GraphNodeRecord | undefined> {
		return (await getDB()).get('graph_nodes', id)
	}

	async getNodesByKind(kind: NodeKind): Promise<GraphNodeRecord[]> {
		return (await getDB()).getAllFromIndex('graph_nodes', 'by-kind', kind)
	}

	async getAllNodes(): Promise<GraphNodeRecord[]> {
		return (await getDB()).getAll('graph_nodes')
	}

	async deleteNode(id: string): Promise<void> {
		await (await getDB()).delete('graph_nodes', id)
	}

	// ── Edge operations ───────────────────────────────────────────────────────

	async createEdge(params: {
		from: string
		to: string
		type: GraphEdgeType
		weight?: number
		evidence?: string[]
	}): Promise<StoredGraphEdge> {
		const db = await getDB()
		const edge: StoredGraphEdge = {
			id: nextId('edge'),
			from: params.from,
			to: params.to,
			type: params.type,
			weight: params.weight ?? 1.0,
			evidence: params.evidence ?? [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			version: 1,
			lastMutatedBy: WORKER_ID,
			lastMutatedAt: Date.now(),
		}
		await db.put('graph_edges', edge)
		return edge
	}

	async getEdgesFrom(nodeId: string): Promise<StoredGraphEdge[]> {
		return (await getDB()).getAllFromIndex('graph_edges', 'by-from', nodeId)
	}

	async getEdgesTo(nodeId: string): Promise<StoredGraphEdge[]> {
		return (await getDB()).getAllFromIndex('graph_edges', 'by-to', nodeId)
	}

	async getEdgesByType(type: GraphEdgeType): Promise<StoredGraphEdge[]> {
		return (await getDB()).getAllFromIndex('graph_edges', 'by-type', type)
	}

	async getAllEdges(): Promise<StoredGraphEdge[]> {
		return (await getDB()).getAll('graph_edges')
	}

	async deleteEdge(id: string): Promise<void> {
		await (await getDB()).delete('graph_edges', id)
	}

	async deleteEdgesFrom(nodeId: string): Promise<void> {
		const edges = await this.getEdgesFrom(nodeId)
		const db = await getDB()
		await Promise.all(edges.map(e => db.delete('graph_edges', e.id)))
	}

	// ── Graph algorithms ──────────────────────────────────────────────────────

	async computeInferredEdges(): Promise<number> {
		let created = 0
		const nodes = await this.getAllNodes()

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const shared = nodes[i].sourceIds.filter(s => nodes[j].sourceIds.includes(s))
				if (shared.length > 0) {
					await this.createEdge({ from: nodes[i].id, to: nodes[j].id, type: 'shared_source', weight: Math.min(1, shared.length / 3), evidence: shared })
					created++
				}

				const neighborsI = new Set((await this.getEdgesFrom(nodes[i].id)).map(e => e.to))
				const neighborsJ = new Set((await this.getEdgesFrom(nodes[j].id)).map(e => e.to))
				const common = [...neighborsI].filter(n => neighborsJ.has(n))
				if (common.length > 0) {
					let aa = 0
					for (const n of common) {
						const deg = (await this.getEdgesFrom(n)).length
						aa += deg > 0 ? 1 / Math.log(deg + 1) : 0
					}
					await this.createEdge({ from: nodes[i].id, to: nodes[j].id, type: 'common_neighbor', weight: Math.min(1, aa), evidence: common })
					created++
				}
			}
		}
		return created
	}

	async detectCommunities(): Promise<Map<string, string[]>> {
		const visited = new Set<string>()
		const communities = new Map<string, string[]>()
		const nodes = await this.getAllNodes()

		for (const node of nodes) {
			if (visited.has(node.id)) continue
			const component: string[] = []
			const queue = [node.id]
			while (queue.length > 0) {
				const cur = queue.shift()!
				if (visited.has(cur)) continue
				visited.add(cur)
				component.push(cur)
				const neighbors = await this.getEdgesFrom(cur)
				for (const e of neighbors) { if (!visited.has(e.to)) queue.push(e.to) }
			}
			if (component.length > 1) communities.set(`cluster_${component[0].slice(0, 8)}`, component)
		}
		return communities
	}

	async computeEmbeddingEdges(embeddings: Map<string, number[]>, threshold = 0.85): Promise<number> {
		let created = 0
		const ids = [...embeddings.keys()]
		for (let i = 0; i < ids.length; i++) {
			const a = embeddings.get(ids[i])
			if (!a) continue
			const existingEdges = await this.getEdgesFrom(ids[i])
			const similarTargets = new Set(existingEdges.filter(e => e.type === 'similar_to').map(e => e.to))
			for (let j = i + 1; j < ids.length; j++) {
				const b = embeddings.get(ids[j])
				if (!b) continue
				const sim = cosineSimilarity(a, b)
				if (sim >= threshold && !similarTargets.has(ids[j])) {
					await this.createEdge({ from: ids[i], to: ids[j], type: 'similar_to', weight: sim, evidence: ['embedding_similarity'] })
					similarTargets.add(ids[j])
					created++
				}
			}
		}
		return created
	}

	async stats(): Promise<{ nodes: number; edges: number; communities: number }> {
		const [nodes, edges, communities] = await Promise.all([this.getAllNodes(), this.getAllEdges(), this.detectCommunities()])
		return { nodes: nodes.length, edges: edges.length, communities: communities.size }
	}
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0
	let dot = 0, n1 = 0, n2 = 0
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; n1 += a[i] * a[i]; n2 += b[i] * b[i] }
	const denom = Math.sqrt(n1) * Math.sqrt(n2)
	return denom === 0 ? 0 : dot / denom
}
