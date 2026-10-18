/**
 * IndexedDB-backed semantic memory store.
 *
 * Owns the `smriti-semantic` database (entities, facts, meta_memory, tombstones,
 * wiki_pages, wiki_raw). Phase 4 migration from extension storage/repositories.ts
 * (EntityRepo, FactRepo, MetaMemoryRepo, TombstoneRepo, WikiPageRepo, WikiRawRepo).
 *
 * Implements ISemanticDataSource for RetrievalEngine injection.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
	EntityRecord,
	FactRecord,
	MetaMemoryRecord,
	WikiPage,
	WikiRawEntry,
} from '../../types'
import type { ISemanticDataSource } from '../../core/retrieval/RetrievalEngine'
import { nextId } from '../../utils/nextId'

const DB_NAME = 'smriti-semantic'
const DB_VERSION = 1
const WORKER_ID = 'semantic-store'

interface SemanticDBSchema extends DBSchema {
	entities: {
		key: string
		value: EntityRecord
		indexes: { 'by-name': string; 'by-type': string }
	}
	facts: {
		key: string
		value: FactRecord
		indexes: { 'by-entityId': string; 'by-confidence': number }
	}
	meta_memory: {
		key: [string, string]  // [subjectType, subjectId]
		value: MetaMemoryRecord
		indexes: { 'by-subjectId': string }
	}
	tombstones: {
		key: string
		value: { id: string; originalStore: string; reason: string; createdAt: number }
	}
	wiki_pages: {
		key: string
		value: WikiPage
		indexes: { 'by-slug': string; 'by-updatedAt': number }
	}
	wiki_raw: {
		key: string
		value: WikiRawEntry
		indexes: { 'by-capturedAt': number }
	}
}

let _db: IDBPDatabase<SemanticDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<SemanticDBSchema>> {
	if (_db) return _db
	_db = await openDB<SemanticDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			const ents = db.createObjectStore('entities', { keyPath: 'id' })
			ents.createIndex('by-name', 'name')
			ents.createIndex('by-type', 'entityType')

			const facts = db.createObjectStore('facts', { keyPath: 'id' })
			facts.createIndex('by-entityId', 'entityIds', { multiEntry: true })
			facts.createIndex('by-confidence', 'confidence')

			const meta = db.createObjectStore('meta_memory', { keyPath: ['subjectType', 'subjectId'] })
			meta.createIndex('by-subjectId', 'subjectId')

			db.createObjectStore('tombstones', { keyPath: 'id' })

			const wp = db.createObjectStore('wiki_pages', { keyPath: 'id' })
			wp.createIndex('by-slug', 'slug')
			wp.createIndex('by-updatedAt', 'updatedAt')

			const wr = db.createObjectStore('wiki_raw', { keyPath: 'id' })
			wr.createIndex('by-capturedAt', 'capturedAt')
		},
	})
	return _db
}

function stamp<T extends { id: string }>(record: T): T & { version: number; lastMutatedBy: string; lastMutatedAt: number } {
	return { ...record, version: 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() }
}

// ── Entity store ──────────────────────────────────────────────────────────────

export const EntityStore = {
	async create(record: EntityRecord): Promise<EntityRecord> {
		const db = await getDB()
		const stamped = stamp(record)
		await db.put('entities', stamped)
		return stamped
	},

	async get(id: string): Promise<EntityRecord | undefined> {
		return (await getDB()).get('entities', id)
	},

	async getByName(name: string): Promise<EntityRecord | undefined> {
		return (await getDB()).getFromIndex('entities', 'by-name', name)
	},

	async getAll(): Promise<EntityRecord[]> {
		return (await getDB()).getAll('entities')
	},

	nameSimilarity(a: string, b: string): number {
		const aL = a.toLowerCase(), bL = b.toLowerCase()
		if (aL === bL) return 1.0
		if (aL.includes(bL) || bL.includes(aL)) return 0.9
		const aW = new Set(aL.split(/\s+/)), bW = new Set(bL.split(/\s+/))
		const inter = [...aW].filter(w => bW.has(w)).length
		return inter / new Set([...aW, ...bW]).size
	},
}

// ── Fact store ────────────────────────────────────────────────────────────────

export const FactStore = {
	async create(record: FactRecord): Promise<FactRecord> {
		const db = await getDB()
		const stamped = stamp(record)
		await db.put('facts', stamped)
		return stamped
	},

	async get(id: string): Promise<FactRecord | undefined> {
		return (await getDB()).get('facts', id)
	},

	async update(id: string, updates: Partial<FactRecord>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('facts', id)
		if (!existing) return
		await db.put('facts', { ...existing, ...updates, version: existing.version + 1, lastMutatedAt: Date.now() })
	},

	async getByEntity(entityId: string): Promise<FactRecord[]> {
		return (await getDB()).getAllFromIndex('facts', 'by-entityId', entityId)
	},

	async getAll(): Promise<FactRecord[]> {
		return (await getDB()).getAll('facts')
	},
}

// ── Meta-memory store ─────────────────────────────────────────────────────────

export const MetaStore = {
	async get(subjectType: MetaMemoryRecord['subjectType'], subjectId: string): Promise<MetaMemoryRecord | undefined> {
		return (await getDB()).get('meta_memory', [subjectType, subjectId])
	},

	async upsert(record: MetaMemoryRecord): Promise<void> {
		await (await getDB()).put('meta_memory', record)
	},
}

// ── Tombstone store ───────────────────────────────────────────────────────────

export const TombstoneStore = {
	async create(id: string, originalStore: string, reason: string): Promise<void> {
		await (await getDB()).put('tombstones', { id: nextId('tomb'), originalStore, reason, createdAt: Date.now() })
	},
}

// ── Wiki page store ───────────────────────────────────────────────────────────

export const WikiPageStore = {
	async create(page: WikiPage): Promise<WikiPage> {
		await (await getDB()).put('wiki_pages', page)
		return page
	},

	async get(id: string): Promise<WikiPage | undefined> {
		return (await getDB()).get('wiki_pages', id)
	},

	async getBySlug(slug: string): Promise<WikiPage | undefined> {
		return (await getDB()).getFromIndex('wiki_pages', 'by-slug', slug)
	},

	async update(id: string, updates: Partial<WikiPage>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('wiki_pages', id)
		if (!existing) return
		await db.put('wiki_pages', { ...existing, ...updates })
	},

	async getAll(): Promise<WikiPage[]> {
		return (await getDB()).getAll('wiki_pages')
	},
}

// ── Wiki raw entry store ──────────────────────────────────────────────────────

export const WikiRawStore = {
	async create(entry: WikiRawEntry): Promise<WikiRawEntry> {
		await (await getDB()).put('wiki_raw', entry)
		return entry
	},

	async get(id: string): Promise<WikiRawEntry | undefined> {
		return (await getDB()).get('wiki_raw', id)
	},

	async update(id: string, updates: Partial<WikiRawEntry>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('wiki_raw', id)
		if (!existing) return
		await db.put('wiki_raw', { ...existing, ...updates })
	},
}

// ── Class façade (implements ISemanticDataSource) ─────────────────────────────

export class IndexedDBSemanticStore implements ISemanticDataSource {
	readonly entities = EntityStore
	readonly facts = FactStore
	readonly meta = MetaStore
	readonly tombstones = TombstoneStore
	readonly wikiPages = WikiPageStore
	readonly wikiRaw = WikiRawStore

	getFacts(): Promise<FactRecord[]> { return FactStore.getAll() }
	getEntities(): Promise<EntityRecord[]> { return EntityStore.getAll() }

	async createEntityDeduped(params: {
		name: string
		entityType: EntityRecord['entityType']
		aliases?: string[]
		description?: string
		tags?: string[]
	}): Promise<EntityRecord> {
		const existing = await EntityStore.getByName(params.name)
		if (existing) return existing

		const all = await EntityStore.getAll()
		for (const e of all) {
			if (e.aliases.some(a => a.toLowerCase() === params.name.toLowerCase())) return e
			if (EntityStore.nameSimilarity(e.name, params.name) > 0.85) return e
		}

		const record: EntityRecord = {
			id: nextId('ent'),
			version: 1,
			lastMutatedBy: WORKER_ID,
			lastMutatedAt: Date.now(),
			name: params.name,
			entityType: params.entityType,
			aliases: params.aliases ?? [],
			description: params.description,
			tags: params.tags ?? [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		await EntityStore.create(record)
		await MetaStore.upsert({
			subjectId: record.id,
			subjectType: 'entity',
			confidence: 0.5,
			freshness: 1.0,
			evidenceCount: 1,
			contradictionCount: 0,
			stability: 0.5,
			lastVerifiedAt: Date.now(),
		})
		return record
	}

	async createFact(params: {
		statement: string
		entityIds: string[]
		confidence?: number
		sourceIds?: string[]
	}): Promise<FactRecord> {
		const record: FactRecord = {
			id: nextId('fact'),
			version: 1,
			lastMutatedBy: WORKER_ID,
			lastMutatedAt: Date.now(),
			statement: params.statement,
			entityIds: params.entityIds,
			confidence: params.confidence ?? 0.5,
			evidenceCount: 1,
			sourceIds: params.sourceIds ?? [],
			contradictionIds: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		await FactStore.create(record)
		await MetaStore.upsert({
			subjectId: record.id,
			subjectType: 'fact',
			confidence: record.confidence,
			freshness: 1.0,
			evidenceCount: 1,
			contradictionCount: 0,
			stability: 0.5,
			lastVerifiedAt: Date.now(),
		})
		return record
	}
}
