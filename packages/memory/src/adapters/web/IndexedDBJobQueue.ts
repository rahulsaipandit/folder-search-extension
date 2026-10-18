/**
 * IndexedDB-backed job queue and snapshot store.
 *
 * Owns the `smriti-jobs` database (jobs, snapshots).
 * Phase 4 migration from extension storage/repositories.ts
 * (JobRepo, SnapshotRepo).
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ConsolidationJob, ConsolidationStatus, StateSnapshot } from '../../types'

const DB_NAME = 'smriti-jobs'
const DB_VERSION = 1

interface JobsDBSchema extends DBSchema {
	jobs: {
		key: string
		value: ConsolidationJob
		indexes: { 'by-status': string; 'by-priority': number; 'by-type': string }
	}
	snapshots: {
		key: string
		value: StateSnapshot
		indexes: { 'by-timestamp': number }
	}
}

let _db: IDBPDatabase<JobsDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<JobsDBSchema>> {
	if (_db) return _db
	_db = await openDB<JobsDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			const jobs = db.createObjectStore('jobs', { keyPath: 'id' })
			jobs.createIndex('by-status', 'status')
			jobs.createIndex('by-priority', 'priority')
			jobs.createIndex('by-type', 'type')

			const snaps = db.createObjectStore('snapshots', { keyPath: 'id' })
			snaps.createIndex('by-timestamp', 'timestamp')
		},
	})
	return _db
}

// ── Job queue ─────────────────────────────────────────────────────────────────

export const JobQueueStore = {
	async create(job: ConsolidationJob): Promise<ConsolidationJob> {
		await (await getDB()).put('jobs', job)
		return job
	},

	async get(id: string): Promise<ConsolidationJob | undefined> {
		return (await getDB()).get('jobs', id)
	},

	async update(id: string, updates: Partial<ConsolidationJob>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('jobs', id)
		if (!existing) return
		await db.put('jobs', { ...existing, ...updates })
	},

	async getPending(): Promise<ConsolidationJob[]> {
		const db = await getDB()
		const pending = await db.getAllFromIndex('jobs', 'by-status', 'pending')
		const retry = await db.getAllFromIndex('jobs', 'by-status', 'retry')
		return [...pending, ...retry].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
	},

	async getByStatus(status: ConsolidationStatus): Promise<ConsolidationJob[]> {
		return (await getDB()).getAllFromIndex('jobs', 'by-status', status)
	},

	async delete(id: string): Promise<void> {
		await (await getDB()).delete('jobs', id)
	},
}

// ── Snapshot store ────────────────────────────────────────────────────────────

export const SnapshotStore = {
	async save(snapshot: StateSnapshot): Promise<void> {
		await (await getDB()).put('snapshots', snapshot)
	},

	async get(id: string): Promise<StateSnapshot | undefined> {
		return (await getDB()).get('snapshots', id)
	},

	async getLatest(): Promise<StateSnapshot | undefined> {
		const all = await (await getDB()).getAllFromIndex('snapshots', 'by-timestamp')
		return all.length > 0 ? all[all.length - 1] : undefined
	},

	async prune(keepCount: number): Promise<void> {
		const db = await getDB()
		const all = await db.getAllFromIndex('snapshots', 'by-timestamp')
		if (all.length <= keepCount) return
		const toDelete = all.slice(0, all.length - keepCount)
		await Promise.all(toDelete.map(s => db.delete('snapshots', s.id)))
	},
}

// ── Class façade ──────────────────────────────────────────────────────────────

export class IndexedDBJobQueue {
	readonly jobs = JobQueueStore
	readonly snapshots = SnapshotStore
}
