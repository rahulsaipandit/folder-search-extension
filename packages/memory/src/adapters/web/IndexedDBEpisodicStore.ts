/**
 * IndexedDB-backed episodic memory store.
 *
 * Owns the `smriti-episodic` database (episodes, turns, mutation_events).
 * Phase 4 migration from packages/extension/src/memory/storage/repositories.ts
 * (TurnRepo, EpisodeRepo, MutationEventRepo).
 *
 * Implements IEpisodicDataSource for RetrievalEngine injection.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { EpisodeRecord, OutcomeType, TurnRecord, MutationEvent, MutationType } from '../../types'
import type { IEpisodicDataSource } from '../../core/retrieval/RetrievalEngine'
import { nextId } from '../../utils/nextId'

const DB_NAME = 'smriti-episodic'
const DB_VERSION = 1
const WORKER_ID = 'episodic-store'

interface EpisodicDBSchema extends DBSchema {
	episodes: {
		key: string
		value: EpisodeRecord
		indexes: { 'by-timestamp': number; 'by-outcome': string; 'by-salience': number; 'by-sessionId': string }
	}
	turns: {
		key: string
		value: TurnRecord & { version: number; lastMutatedBy: string; lastMutatedAt: number }
		indexes: { 'by-sessionId': string; 'by-timestamp': number }
	}
	mutation_events: {
		key: string
		value: MutationEvent
		indexes: { 'by-timestamp': number; 'by-store': string }
	}
}

let _db: IDBPDatabase<EpisodicDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<EpisodicDBSchema>> {
	if (_db) return _db
	_db = await openDB<EpisodicDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			const eps = db.createObjectStore('episodes', { keyPath: 'id' })
			eps.createIndex('by-timestamp', 'timestamp')
			eps.createIndex('by-outcome', 'outcome')
			eps.createIndex('by-salience', 'salience')
			eps.createIndex('by-sessionId', 'sessionId')

			const turns = db.createObjectStore('turns', { keyPath: 'id' })
			turns.createIndex('by-sessionId', 'sessionId')
			turns.createIndex('by-timestamp', 'timestamp')

			const mut = db.createObjectStore('mutation_events', { keyPath: 'id' })
			mut.createIndex('by-timestamp', 'timestamp')
			mut.createIndex('by-store', 'storeName')
		},
	})
	return _db
}

async function logMutation(storeName: string, recordIds: string[], mutationType: MutationType, summary: string): Promise<void> {
	const db = await getDB()
	await db.put('mutation_events', {
		id: nextId('mevt'),
		timestamp: Date.now(),
		workerId: WORKER_ID,
		storeName,
		recordIds,
		mutationType,
		summary,
	})
}

// ── Episode repo ──────────────────────────────────────────────────────────────

export const EpisodicStore = {
	async createEpisode(record: EpisodeRecord): Promise<EpisodeRecord> {
		const db = await getDB()
		const stamped: EpisodeRecord = { ...record, version: record.version ?? 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() }
		await db.put('episodes', stamped)
		await logMutation('episodes', [record.id], 'create', `Episode ${record.id.slice(0, 8)}`)
		return stamped
	},

	async getEpisode(id: string): Promise<EpisodeRecord | undefined> {
		return (await getDB()).get('episodes', id)
	},

	async updateEpisode(id: string, updates: Partial<EpisodeRecord>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('episodes', id)
		if (!existing) return
		await db.put('episodes', { ...existing, ...updates, version: existing.version + 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() })
		await logMutation('episodes', [id], 'update', `Updated episode ${id.slice(0, 8)}`)
	},

	async getRecentEpisodes(limit: number): Promise<EpisodeRecord[]> {
		const db = await getDB()
		const all = await db.getAllFromIndex('episodes', 'by-timestamp')
		return all.reverse().slice(0, limit)
	},

	async getEpisodesBySalience(threshold: number): Promise<EpisodeRecord[]> {
		const db = await getDB()
		const all = await db.getAllFromIndex('episodes', 'by-salience')
		return all.filter(e => e.salience >= threshold)
	},

	async getEpisodesByOutcome(outcome: OutcomeType): Promise<EpisodeRecord[]> {
		return (await getDB()).getAllFromIndex('episodes', 'by-outcome', outcome)
	},

	async getEpisodesBySession(sessionId: string): Promise<EpisodeRecord[]> {
		return (await getDB()).getAllFromIndex('episodes', 'by-sessionId', sessionId)
	},

	async deleteEpisode(id: string): Promise<void> {
		const db = await getDB()
		await db.delete('episodes', id)
		await logMutation('episodes', [id], 'delete', `Deleted episode ${id.slice(0, 8)}`)
	},
} satisfies IEpisodicDataSource & {
	createEpisode(r: EpisodeRecord): Promise<EpisodeRecord>
	getEpisode(id: string): Promise<EpisodeRecord | undefined>
	updateEpisode(id: string, u: Partial<EpisodeRecord>): Promise<void>
	getEpisodesByOutcome(o: OutcomeType): Promise<EpisodeRecord[]>
	getEpisodesBySession(s: string): Promise<EpisodeRecord[]>
	deleteEpisode(id: string): Promise<void>
}

// ── Turn repo ─────────────────────────────────────────────────────────────────

export const TurnStore = {
	async createTurn(record: TurnRecord): Promise<TurnRecord> {
		const db = await getDB()
		const stamped = { ...record, version: 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() }
		await db.put('turns', stamped)
		await logMutation('turns', [record.id], 'create', `Turn ${record.id.slice(0, 8)}`)
		return record
	},

	async getTurn(id: string): Promise<TurnRecord | undefined> {
		return (await getDB()).get('turns', id)
	},

	async getTurnsBySession(sessionId: string): Promise<TurnRecord[]> {
		return (await getDB()).getAllFromIndex('turns', 'by-sessionId', sessionId)
	},

	async deleteTurn(id: string): Promise<void> {
		const db = await getDB()
		await db.delete('turns', id)
		await logMutation('turns', [id], 'delete', `Deleted turn ${id.slice(0, 8)}`)
	},
}

// ── Mutation event repo (for CacheConsistencyManager) ────────────────────────

export const MutationEventStore = {
	async pollSince(sinceTimestamp: number): Promise<MutationEvent[]> {
		const db = await getDB()
		const all = await db.getAllFromIndex('mutation_events', 'by-timestamp')
		return all.filter(e => e.timestamp > sinceTimestamp)
	},
}

// ── Class façade (implements IEpisodicDataSource) ─────────────────────────────

export class IndexedDBEpisodicStore implements IEpisodicDataSource {
	readonly episodes = EpisodicStore
	readonly turns = TurnStore
	readonly mutationEvents = MutationEventStore

	getFacts() { return Promise.resolve([]) } // Satisfies IEpisodicDataSource shape
	getEntities() { return Promise.resolve([]) }

	getRecentEpisodes(limit: number) { return EpisodicStore.getRecentEpisodes(limit) }
	getEpisodesBySalience(threshold: number) { return EpisodicStore.getEpisodesBySalience(threshold) }
}
