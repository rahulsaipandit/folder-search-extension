/**
 * IndexedDB persistence for Folder Search (`folderSearch` database, design §3.4). Opened from both
 * the side panel (folder record + handle, status) and the offscreen document (indexing, search):
 * IndexedDB is shared across contexts of the extension origin.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import { termFrequencies } from './keywords'
import type {
	ChunkRecord,
	FileRecord,
	FolderRecord,
	ImageVectorRecord,
	MediaUnitRecord,
	MetaRecord,
	PostingRecord,
} from './types'

const DB_NAME = 'folderSearch'
const DB_VERSION = 1

interface FolderSearchSchema extends DBSchema {
	folders: { key: string; value: FolderRecord }
	files: {
		key: string
		value: FileRecord
		indexes: { byFolder: string; byHash: string }
	}
	chunks: {
		key: string
		value: ChunkRecord
		indexes: { byFile: string; byFolder: string }
	}
	imageVectors: { key: string; value: ImageVectorRecord; indexes: { byFolder: string } }
	mediaUnits: { key: string; value: MediaUnitRecord; indexes: { byFile: string; byFolder: string } }
	keywords: { key: string; value: PostingRecord; indexes: { byFolder: string } }
	meta: { key: string; value: MetaRecord }
}

type DB = IDBPDatabase<FolderSearchSchema>
let dbPromise: Promise<DB> | null = null

export function getDB(): Promise<DB> {
	dbPromise ??= openDB<FolderSearchSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			db.createObjectStore('folders', { keyPath: 'folderId' })
			const files = db.createObjectStore('files', { keyPath: 'fileId' })
			files.createIndex('byFolder', 'folderId')
			files.createIndex('byHash', 'contentHash')
			const chunks = db.createObjectStore('chunks', { keyPath: 'chunkId' })
			chunks.createIndex('byFile', 'fileId')
			chunks.createIndex('byFolder', 'folderId')
			db.createObjectStore('imageVectors', { keyPath: 'fileId' }).createIndex('byFolder', 'folderId')
			const units = db.createObjectStore('mediaUnits', { keyPath: 'unitId' })
			units.createIndex('byFile', 'fileId')
			units.createIndex('byFolder', 'folderId')
			db.createObjectStore('keywords', { keyPath: 'key' }).createIndex('byFolder', 'folderId')
			db.createObjectStore('meta', { keyPath: 'key' })
		},
		blocked() {
			console.warn('[folder-search] database upgrade blocked by another open tab')
		},
		terminated() {
			dbPromise = null
		},
	}).catch(e => {
		dbPromise = null
		throw e
	})
	return dbPromise
}

// ── folders ────────────────────────────────────────────────────────────────────────────────
export async function listFolders(): Promise<FolderRecord[]> {
	return (await getDB()).getAll('folders')
}
export async function getFolder(folderId: string): Promise<FolderRecord | undefined> {
	return (await getDB()).get('folders', folderId)
}
export async function putFolder(folder: FolderRecord): Promise<void> {
	await (await getDB()).put('folders', folder)
}

// ── files ──────────────────────────────────────────────────────────────────────────────────
export async function getFiles(folderId: string): Promise<FileRecord[]> {
	return (await getDB()).getAllFromIndex('files', 'byFolder', folderId)
}
export async function getFile(fileId: string): Promise<FileRecord | undefined> {
	return (await getDB()).get('files', fileId)
}
export async function putFiles(files: FileRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('files', 'readwrite')
	await Promise.all([...files.map(f => tx.store.put(f)), tx.done])
}
export async function filesByHash(hash: string): Promise<FileRecord[]> {
	return (await getDB()).getAllFromIndex('files', 'byHash', hash)
}

// ── vectors ────────────────────────────────────────────────────────────────────────────────
export async function putChunks(chunks: ChunkRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('chunks', 'readwrite')
	await Promise.all([...chunks.map(c => tx.store.put(c)), tx.done])
}
export async function getChunks(folderId: string): Promise<ChunkRecord[]> {
	return (await getDB()).getAllFromIndex('chunks', 'byFolder', folderId)
}
export async function getChunk(chunkId: string): Promise<ChunkRecord | undefined> {
	return (await getDB()).get('chunks', chunkId)
}
export async function getChunksByFile(fileId: string): Promise<ChunkRecord[]> {
	return (await getDB()).getAllFromIndex('chunks', 'byFile', fileId)
}
export async function putImageVector(rec: ImageVectorRecord): Promise<void> {
	await (await getDB()).put('imageVectors', rec)
}
export async function getImageVector(fileId: string): Promise<ImageVectorRecord | undefined> {
	return (await getDB()).get('imageVectors', fileId)
}
export async function getImageVectors(folderId: string): Promise<ImageVectorRecord[]> {
	return (await getDB()).getAllFromIndex('imageVectors', 'byFolder', folderId)
}
export async function putMediaUnits(units: MediaUnitRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('mediaUnits', 'readwrite')
	await Promise.all([...units.map(u => tx.store.put(u)), tx.done])
}
export async function getMediaUnits(folderId: string): Promise<MediaUnitRecord[]> {
	return (await getDB()).getAllFromIndex('mediaUnits', 'byFolder', folderId)
}

/** Streams records one at a time so loading a big index never materializes every chunk's text. */
export async function scanChunks(folderId: string, cb: (c: ChunkRecord) => void): Promise<void> {
	const tx = (await getDB()).transaction('chunks')
	for await (const cur of tx.store.index('byFolder').iterate(folderId)) cb(cur.value)
}
export async function scanImageVectors(folderId: string, cb: (v: ImageVectorRecord) => void): Promise<void> {
	const tx = (await getDB()).transaction('imageVectors')
	for await (const cur of tx.store.index('byFolder').iterate(folderId)) cb(cur.value)
}
export async function scanMediaUnits(folderId: string, cb: (u: MediaUnitRecord) => void): Promise<void> {
	const tx = (await getDB()).transaction('mediaUnits')
	for await (const cur of tx.store.index('byFolder').iterate(folderId)) cb(cur.value)
}
export async function countChunks(folderId: string): Promise<number> {
	return (await getDB()).countFromIndex('chunks', 'byFolder', folderId)
}
export async function getMediaUnit(unitId: string): Promise<MediaUnitRecord | undefined> {
	return (await getDB()).get('mediaUnits', unitId)
}

// ── keyword index ──────────────────────────────────────────────────────────────────────────
const postingKey = (folderId: string, term: string) => `${folderId}\u0000${term}`

/** Merges `chunkId → tf` additions into each term's postings, in one transaction. */
export async function mergePostings(
	folderId: string,
	additions: Map<string, Record<string, number>>
): Promise<void> {
	if (!additions.size) return
	const db = await getDB()
	const tx = db.transaction('keywords', 'readwrite')
	await Promise.all([
		...[...additions].map(async ([term, add]) => {
			const key = postingKey(folderId, term)
			const existing = await tx.store.get(key)
			await tx.store.put({
				key,
				folderId,
				term,
				postings: { ...(existing?.postings ?? {}), ...add },
			})
		}),
		tx.done,
	])
}

export async function getPostings(
	folderId: string,
	terms: string[]
): Promise<Map<string, Record<string, number>>> {
	const db = await getDB()
	const out = new Map<string, Record<string, number>>()
	await Promise.all(
		terms.map(async term => {
			const rec = await db.get('keywords', postingKey(folderId, term))
			if (rec) out.set(term, rec.postings)
		})
	)
	return out
}

// ── cascading delete ───────────────────────────────────────────────────────────────────────
/** Removes a file and everything derived from it, including its keyword postings. */
export async function deleteFileCascade(fileId: string): Promise<void> {
	const db = await getDB()
	const chunks = await db.getAllFromIndex('chunks', 'byFile', fileId)
	const folderId = chunks[0]?.folderId ?? (await db.get('files', fileId))?.folderId
	if (folderId) {
		const removals = new Map<string, Set<string>>()
		for (const c of chunks) {
			const text = c.text
			for (const term of termFrequencies(text).keys()) {
				const set = removals.get(term) ?? new Set<string>()
				set.add(c.chunkId)
				removals.set(term, set)
			}
		}
		const kwTx = db.transaction('keywords', 'readwrite')
		await Promise.all([
			...[...removals].map(async ([term, ids]) => {
				const key = postingKey(folderId, term)
				const rec = await kwTx.store.get(key)
				if (!rec) return
				for (const id of ids) delete rec.postings[id]
				if (Object.keys(rec.postings).length) await kwTx.store.put(rec)
				else await kwTx.store.delete(key)
			}),
			kwTx.done,
		])
		await removeFilenamePostings(folderId, fileId)
	}
	const tx = db.transaction(['chunks', 'imageVectors', 'mediaUnits', 'files'], 'readwrite')
	await Promise.all([
		...chunks.map(c => tx.objectStore('chunks').delete(c.chunkId)),
		tx.objectStore('imageVectors').delete(fileId),
		(async () => {
			const units = await tx.objectStore('mediaUnits').index('byFile').getAllKeys(fileId)
			await Promise.all(units.map(k => tx.objectStore('mediaUnits').delete(k)))
		})(),
		tx.objectStore('files').delete(fileId),
		tx.done,
	])
}

/** File-name postings are keyed `${fileId}#name`; remove them using the file's stored path. */
async function removeFilenamePostings(folderId: string, fileId: string): Promise<void> {
	const db = await getDB()
	const file = await db.get('files', fileId)
	if (!file) return
	const id = nameChunkId(fileId)
	const tx = db.transaction('keywords', 'readwrite')
	await Promise.all([
		...[...termFrequencies(file.relPath).keys()].map(async term => {
			const key = postingKey(folderId, term)
			const rec = await tx.store.get(key)
			if (!rec || !(id in rec.postings)) return
			delete rec.postings[id]
			if (Object.keys(rec.postings).length) await tx.store.put(rec)
			else await tx.store.delete(key)
		}),
		tx.done,
	])
}

export const nameChunkId = (fileId: string) => `${fileId}#name`
export const chunkIdOf = (fileId: string, idx: number) => `${fileId}#${idx}`
export const pageChunkId = (fileId: string, page: number) => `${fileId}#p${page}`
/** Suffix marking a video's soundtrack windows, so they never collide with segment ids at the same second. */
export const SOUNDTRACK_SUFFIX = 'a'
export const unitIdOf = (fileId: string, startSec: number, suffix = '') => `${fileId}@${startSec}${suffix}`

/** Drops one file's vectors/chunks but keeps its inventory row (used before re-indexing it). */
export async function clearFileDerived(fileId: string): Promise<void> {
	const file = await getFile(fileId)
	await deleteFileCascade(fileId)
	if (file) await putFiles([{ ...file, indexState: 'pending', error: undefined, units: undefined }])
}

/**
 * Deletes a folder's index (and the folder record unless `keepFolder`). Original files are never
 * touched.
 */
export async function deleteFolderData(folderId: string, opts: { keepFolder?: boolean } = {}): Promise<void> {
	const db = await getDB()
	const stores = ['files', 'chunks', 'imageVectors', 'mediaUnits', 'keywords'] as const
	const tx = db.transaction([...stores, 'folders'], 'readwrite')
	await Promise.all([
		...stores.map(async s => {
			const store = tx.objectStore(s)
			for (const k of await store.index('byFolder').getAllKeys(folderId)) await store.delete(k as string)
		}),
		opts.keepFolder ? Promise.resolve() : tx.objectStore('folders').delete(folderId),
		tx.done,
	])
}

// ── meta ───────────────────────────────────────────────────────────────────────────────────
export async function getMeta<T>(key: string): Promise<T | undefined> {
	return ((await (await getDB()).get('meta', key))?.value as T | undefined) ?? undefined
}
export async function setMeta(key: string, value: unknown): Promise<void> {
	await (await getDB()).put('meta', { key, value })
}
export async function deleteMeta(key: string): Promise<void> {
	await (await getDB()).delete('meta', key)
}
