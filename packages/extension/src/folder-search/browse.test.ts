import { describe, expect, it } from 'vitest'

import { browsableFiles, fileExt, filesKey, sortFiles } from './browse'
import type { FileRecord } from './types'

function rec(relPath: string, over: Partial<FileRecord> = {}): FileRecord {
	return {
		fileId: `f:${relPath}`,
		folderId: 'f',
		relPath,
		size: 1,
		mtime: 1,
		kind: 'document',
		mime: '',
		indexState: 'indexed',
		...over,
	}
}

describe('browsableFiles', () => {
	const files = [
		rec('a.txt'),
		rec('b.png', { kind: 'image' }),
		rec('c.mp4', { kind: 'video' }),
		rec('d.pdf', { indexState: 'skipped' }),
		rec('e.bin', { kind: 'other' }),
	]
	it('only lists indexed files of the chosen kind', () => {
		expect(browsableFiles(files, 'documents').map(f => f.relPath)).toEqual(['a.txt'])
		expect(browsableFiles(files, 'images').map(f => f.relPath)).toEqual(['b.png'])
		expect(browsableFiles(files, 'audio-video').map(f => f.relPath)).toEqual(['c.mp4'])
	})
	it('"all" never lists skipped or unsupported files', () => {
		expect(browsableFiles(files, 'all').map(f => f.relPath)).toEqual(['a.txt', 'b.png', 'c.mp4'])
	})
})

describe('sortFiles', () => {
	it('sorts names naturally, not lexically', () => {
		const out = sortFiles([rec('img10.txt'), rec('img2.txt')], { key: 'name', dir: 'asc' })
		expect(out.map(f => f.relPath)).toEqual(['img2.txt', 'img10.txt'])
	})
	it('sorts by name within sub-folders, and ties fall back to path', () => {
		const out = sortFiles([rec('z/a.txt'), rec('a/a.txt')], { key: 'name', dir: 'desc' })
		expect(out.map(f => f.relPath)).toEqual(['a/a.txt', 'z/a.txt'])
	})
	it('sorts by modified date descending', () => {
		const out = sortFiles([rec('old', { mtime: 1 }), rec('new', { mtime: 9 })], { key: 'mtime', dir: 'desc' })
		expect(out.map(f => f.relPath)).toEqual(['new', 'old'])
	})
})

describe('fileExt', () => {
	it('treats dotfiles and extensionless names as having no type', () => {
		expect(fileExt('x/.gitignore')).toBe('')
		expect(fileExt('x/README')).toBe('')
		expect(fileExt('x/Notes.final.md')).toBe('MD')
	})
})

describe('filesKey', () => {
	it('is the same for a new array with the same files, and changes when a file changes', () => {
		const a = [rec('a.txt'), rec('b.txt')]
		expect(filesKey([...a.map(f => ({ ...f }))])).toBe(filesKey(a))
		expect(filesKey([a[0]!, { ...a[1]!, mtime: 2 }])).not.toBe(filesKey(a))
		expect(filesKey([a[0]!])).not.toBe(filesKey(a))
	})
	it('ignores details learned later, so filling them in does not reset the wall', () => {
		const a = [rec('a.mp3', { kind: 'audio' })]
		expect(filesKey([{ ...a[0]!, duration: 12, waveform: [1] }])).toBe(filesKey(a))
	})
})
