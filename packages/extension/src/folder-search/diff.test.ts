import { describe, expect, it } from 'vitest'

import { type KnownFile, diffScan } from './diff'

const known = (rows: KnownFile[]) => new Map(rows.map(r => [r.relPath, r]))
const f = (relPath: string, size = 1, mtime = 1) => ({ relPath, size, mtime })

describe('diffScan', () => {
	const inventory = known([
		{ ...f('same.txt'), indexState: 'indexed' },
		{ ...f('edited.txt'), indexState: 'indexed' },
		{ ...f('gone.txt'), indexState: 'indexed' },
		{ ...f('half.txt'), indexState: 'pending' },
		{ ...f('broken.txt'), indexState: 'error' },
	])
	const scanned = [f('same.txt'), f('edited.txt', 2), f('half.txt'), f('broken.txt'), f('new.txt')]

	it('classifies added, changed, resumable, unchanged and deleted files', () => {
		const d = diffScan(inventory, scanned)
		expect(d.added.map(x => x.relPath)).toEqual(['new.txt'])
		expect(d.changed.map(x => x.relPath)).toEqual(['edited.txt'])
		expect(d.resume.map(x => x.relPath)).toEqual(['half.txt'])
		expect(d.unchanged.map(x => x.relPath).sort()).toEqual(['broken.txt', 'same.txt'])
		expect(d.deleted).toEqual(['gone.txt'])
	})

	it('treats an mtime-only change as changed', () => {
		const d = diffScan(inventory, [f('same.txt', 1, 99)])
		expect(d.changed.map(x => x.relPath)).toEqual(['same.txt'])
	})

	it('retries previously failed files only when asked', () => {
		expect(diffScan(inventory, scanned, { retryErrors: true }).resume.map(x => x.relPath).sort()).toEqual([
			'broken.txt',
			'half.txt',
		])
	})
})
