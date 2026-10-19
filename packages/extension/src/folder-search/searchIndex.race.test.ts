import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChunkRecord, FileRecord } from './types'

const DIM = 4
const vec = (n: number) => new Float32Array(DIM).fill(n)
const chunk = (fileId: string, idx: number): ChunkRecord => ({
	chunkId: `${fileId}#${idx}`, fileId, folderId: 'f', chunkIdx: idx, text: 't', offset: 0, source: 'text', embedding: vec(1),
})
const fileRec = (relPath: string): FileRecord => ({
	fileId: `f:${relPath}`, folderId: 'f', relPath, size: 1, mtime: 1, kind: 'document', mime: '', indexState: 'indexed',
})

// A scan that can be held open, so updates can arrive while the folder is "loading".
let release: () => void
let stored: ChunkRecord[]
vi.mock('./db', () => ({
	getFiles: async () => [],
	scanChunks: async (_folder: string, cb: (c: ChunkRecord) => void) => {
		const rows = [...stored]
		await new Promise<void>(r => (release = r))
		rows.forEach(cb)
	},
	scanImageVectors: async () => undefined,
	scanMediaUnits: async () => undefined,
	getChunk: async () => undefined,
	getPostings: async () => new Map(),
}))
vi.mock('@/browser-ml/gemma-embeddings', () => ({ gemma: {} }))

const { SearchIndex } = await import('./searchIndex')

describe('SearchIndex load race', () => {
	beforeEach(() => {
		stored = [chunk('f:old.md', 0)]
	})

	it('keeps rows indexed while the folder is loading, and never double-counts rows the scan also saw', async () => {
		const index = new SearchIndex(DIM)
		const loading = index.stats('f')
		await Promise.resolve()
		// Arrives mid-scan: one brand-new file, and a re-note of a row the scan will also read.
		index.noteFile(fileRec('new.md'))
		index.noteChunks('f', [chunk('f:new.md', 0), chunk('f:old.md', 0)])
		release()
		expect(await loading).toMatchObject({ chunks: 2 })
	})

	it('replays removals after the scan too', async () => {
		const index = new SearchIndex(DIM)
		const loading = index.stats('f')
		await Promise.resolve()
		index.forgetFile('f', 'f:old.md')
		release()
		expect(await loading).toMatchObject({ chunks: 0 })
	})

	it('starts over when the folder is invalidated mid-load instead of publishing stale data', async () => {
		const index = new SearchIndex(DIM)
		const loading = index.stats('f')
		await Promise.resolve()
		stored = []
		index.invalidate('f')
		release() // first scan finishes (stale); the retry then reads the now-empty store
		await new Promise(r => setTimeout(r, 0))
		release()
		expect(await loading).toMatchObject({ chunks: 0 })
	})
})
