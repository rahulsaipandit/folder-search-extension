import { describe, expect, it } from 'vitest'

import { RemovalContext } from './removal'
import type { FileRecord } from './types'

const file = (relPath: string, duplicateOf?: string): FileRecord => ({
	fileId: `f:${relPath}`, folderId: 'f', relPath, size: 1, mtime: 1, kind: 'image', mime: '', indexState: 'indexed', duplicateOf,
})

describe('RemovalContext', () => {
	const inventory = [file('a.png'), file('b.png', 'f:a.png'), file('c.png', 'f:a.png'), file('d.png')]

	it('lists the duplicates that shared a removed file’s vectors', () => {
		const ctx = new RemovalContext(inventory)
		expect(ctx.dependentsOf('f:a.png').map(f => f.relPath)).toEqual(['b.png', 'c.png'])
		expect(ctx.dependentsOf('f:d.png')).toEqual([])
	})

	it('does not resurrect a duplicate that was already removed in the same pass', () => {
		const ctx = new RemovalContext(inventory)
		ctx.markRemoved('f:b.png')
		expect(ctx.dependentsOf('f:a.png').map(f => f.relPath)).toEqual(['c.png'])
	})
})
