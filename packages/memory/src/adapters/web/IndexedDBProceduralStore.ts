/**
 * IndexedDB-backed IProceduralStore for browser environments.
 *
 * Uses a dedicated `smriti-procedural` database so it does not conflict with
 * the main `smriti-db` schema while the extension migrates incrementally.
 * Phase 4: merge into the main IDB schema and remove the separate DB.
 *
 * Phase 3 migration from packages/extension/src/memory/storage/repositories.ts
 * (ProcedureRepo, ProcedureVersionRepo).
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { IProceduralStore } from '../../interfaces/IProceduralStore'
import type {
	ProcedureRecord,
	ProcedureVersionRecord,
	ProcedureStep,
} from '../../types'

interface ProceduralDBSchema extends DBSchema {
	procedures: {
		key: string
		value: ProcedureRecord & { version: number; lastMutatedBy: string; lastMutatedAt: number }
		indexes: { 'by-name': string; 'by-domain': string; 'by-status': string }
	}
	procedure_versions: {
		key: string
		value: ProcedureVersionRecord & { version: number; lastMutatedBy: string; lastMutatedAt: number }
		indexes: { 'by-procedureId': string; 'by-status': string }
	}
}

const DB_NAME = 'smriti-procedural'
const DB_VERSION = 1
const WORKER_ID = 'procedural-store'

let _db: IDBPDatabase<ProceduralDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<ProceduralDBSchema>> {
	if (_db) return _db
	_db = await openDB<ProceduralDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			const procStore = db.createObjectStore('procedures', { keyPath: 'id' })
			procStore.createIndex('by-name', 'name')
			procStore.createIndex('by-domain', 'domain')
			procStore.createIndex('by-status', 'status')

			const verStore = db.createObjectStore('procedure_versions', { keyPath: 'id' })
			verStore.createIndex('by-procedureId', 'procedureId')
			verStore.createIndex('by-status', 'status')
		},
	})
	return _db
}

function stamp<T extends { id: string }>(record: T) {
	return { ...record, version: 1, lastMutatedBy: WORKER_ID, lastMutatedAt: Date.now() }
}

function bump<T extends { version: number }>(record: T) {
	return { ...record, version: record.version + 1, lastMutatedAt: Date.now() }
}

export class IndexedDBProceduralStore implements IProceduralStore {
	async initialize(): Promise<void> { await getDB() }
	async close(): Promise<void> { _db?.close(); _db = null }

	// ── Procedure CRUD ────────────────────────────────────────────────────────

	async createProcedure(params: Parameters<IProceduralStore['createProcedure']>[0]): Promise<ProcedureRecord> {
		const db = await getDB()
		const now = Date.now()
		const record: ProcedureRecord = {
			...params,
			createdAt: now,
			updatedAt: now,
			version: 1,
			lastMutatedBy: WORKER_ID,
			lastMutatedAt: now,
		}
		await db.put('procedures', stamp(record))
		return record
	}

	async getProcedure(id: string): Promise<ProcedureRecord | null> {
		const db = await getDB()
		return (await db.get('procedures', id)) ?? null
	}

	async getProcedureByName(name: string): Promise<ProcedureRecord | null> {
		const db = await getDB()
		const all = await db.getAllFromIndex('procedures', 'by-name', name)
		return all[0] ?? null
	}

	async getProceduresByDomain(domain: string): Promise<ProcedureRecord[]> {
		const db = await getDB()
		return db.getAllFromIndex('procedures', 'by-domain', domain)
	}

	async getAllProcedures(): Promise<ProcedureRecord[]> {
		const db = await getDB()
		return db.getAll('procedures')
	}

	async updateProcedure(id: string, partial: Partial<ProcedureRecord>): Promise<void> {
		const db = await getDB()
		const existing = await db.get('procedures', id)
		if (!existing) return
		await db.put('procedures', bump({ ...existing, ...partial, updatedAt: Date.now() }))
	}

	// ── Version CRUD ──────────────────────────────────────────────────────────

	async createVersion(params: Parameters<IProceduralStore['createVersion']>[0]): Promise<ProcedureVersionRecord> {
		const db = await getDB()
		const now = Date.now()
		const record: ProcedureVersionRecord = {
			...params,
			createdAt: now,
			successCount: 0,
			failureCount: 0,
			version: 1,
			lastMutatedBy: WORKER_ID,
			lastMutatedAt: now,
		}
		await db.put('procedure_versions', stamp(record))
		return record
	}

	async getVersion(id: string): Promise<ProcedureVersionRecord | null> {
		const db = await getDB()
		return (await db.get('procedure_versions', id)) ?? null
	}

	async getLatestVersion(procedureId: string): Promise<ProcedureVersionRecord | null> {
		const versions = await this.getVersionHistory(procedureId)
		return versions.sort((a, b) => b.version - a.version)[0] ?? null
	}

	async getVersionHistory(procedureId: string): Promise<ProcedureVersionRecord[]> {
		const db = await getDB()
		return db.getAllFromIndex('procedure_versions', 'by-procedureId', procedureId)
	}
}
