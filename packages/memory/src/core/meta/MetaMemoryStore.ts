/**
 * Meta-Memory Store - tracks per-subject confidence, freshness, and stability.
 *
 * Phase 2 migration from packages/extension/src/memory/storage/repositories.ts
 * (MetaMemoryRepo). This in-process implementation works on all platforms.
 * An IDB-backed subclass lives in adapters/web/ (Phase 3).
 */

import type { MetaMemoryRecord } from '../../types'

export interface IMetaMemoryStore {
	upsert(record: MetaMemoryRecord): Promise<void>
	get(subjectType: MetaMemoryRecord['subjectType'], subjectId: string): Promise<MetaMemoryRecord | null>
	getByType(subjectType: MetaMemoryRecord['subjectType']): Promise<MetaMemoryRecord[]>
	/** Temporal decay - multiply confidence and freshness by (1 - factorPerDay * daysSinceVerified). */
	decay(factorPerDay?: number): Promise<void>
	getAll(): Promise<MetaMemoryRecord[]>
}

export class InMemoryMetaMemoryStore implements IMetaMemoryStore {
	// Composite key: `${subjectType}::${subjectId}`
	private store = new Map<string, MetaMemoryRecord>()

	private key(type: string, id: string): string { return `${type}::${id}` }

	async upsert(record: MetaMemoryRecord): Promise<void> {
		this.store.set(this.key(record.subjectType, record.subjectId), { ...record })
	}

	async get(subjectType: MetaMemoryRecord['subjectType'], subjectId: string): Promise<MetaMemoryRecord | null> {
		return this.store.get(this.key(subjectType, subjectId)) ?? null
	}

	async getByType(subjectType: MetaMemoryRecord['subjectType']): Promise<MetaMemoryRecord[]> {
		return Array.from(this.store.values()).filter(r => r.subjectType === subjectType)
	}

	async getAll(): Promise<MetaMemoryRecord[]> {
		return Array.from(this.store.values())
	}

	async decay(factorPerDay = 0.01): Promise<void> {
		const now = Date.now()
		for (const [key, record] of this.store) {
			const daysSince = record.lastVerifiedAt
				? (now - record.lastVerifiedAt) / 86_400_000
				: 30
			const factor = Math.max(0, 1 - factorPerDay * daysSince)
			this.store.set(key, {
				...record,
				confidence: Math.max(0.05, record.confidence * factor),
				freshness: Math.max(0, record.freshness * factor),
			})
		}
	}
}
