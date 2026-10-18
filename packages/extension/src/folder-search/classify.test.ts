import { describe, expect, it } from 'vitest'

import {
	DEFAULT_CAPS,
	DEFAULT_KINDS,
	broadFolderWarning,
	classifyFile,
	directorySkipReason,
	fileSkipReason,
	globMatches,
} from './classify'

const kinds = { ...DEFAULT_KINDS, audio: true, video: true }
const skip = (name: string, size = 1000, enabled = kinds, excludes: string[] = []) =>
	fileSkipReason({ name, size, kind: classifyFile(name) }, DEFAULT_CAPS, excludes, enabled)

describe('classifyFile', () => {
	it('routes by extension, case-insensitively', () => {
		expect(classifyFile('IMG_001.JPG')).toBe('image')
		expect(classifyFile('report.pdf')).toBe('document')
		expect(classifyFile('song.mp3')).toBe('audio')
		expect(classifyFile('clip.mov')).toBe('video')
		expect(classifyFile('archive.zip')).toBe('other')
	})

	it('falls back to MIME only for extensionless files', () => {
		expect(classifyFile('README', 'text/plain')).toBe('document')
		expect(classifyFile('photo', 'image/png')).toBe('image')
		expect(classifyFile('data.bin', 'text/plain')).toBe('other')
	})
})

describe('fileSkipReason', () => {
	it('indexes ordinary files', () => {
		expect(skip('notes.md')).toBeNull()
		expect(skip('holiday.png')).toBeNull()
	})

	it('never embeds secrets, even when hidden', () => {
		expect(skip('.env')).toBe('sensitive')
		expect(skip('.env.production')).toBe('sensitive')
		expect(skip('id_rsa')).toBe('sensitive')
		expect(skip('server.pem')).toBe('sensitive')
		expect(skip('vault.kdbx')).toBe('sensitive')
		expect(skip('passwords.csv')).toBe('sensitive')
	})

	it('skips junk, hidden and unsupported files with distinct reasons', () => {
		expect(skip('Thumbs.db')).toBe('junk')
		expect(skip('.gitignore')).toBe('hidden')
		expect(skip('budget.xlsx')).toBe('unsupported')
		expect(skip('legacy.doc')).toBe('unsupported')
		expect(skip('app.ts')).toBe('unsupported')
		expect(skip('empty.txt', 0)).toBe('empty')
	})

	it('applies size caps per kind', () => {
		expect(skip('big.pdf', DEFAULT_CAPS.documentBytes + 1)).toBe('too-large')
		expect(skip('big.png', DEFAULT_CAPS.imageBytes + 1)).toBe('too-large')
		expect(skip('big.png', DEFAULT_CAPS.imageBytes)).toBeNull()
	})

	it('respects disabled kinds and user excludes', () => {
		expect(skip('a.png', 10, { ...kinds, images: false })).toBe('kind-disabled')
		expect(skip('a.mp3', 10, { ...kinds, audio: false })).toBe('kind-disabled')
		expect(skip('draft-v2.docx', 10, kinds, ['draft-*'])).toBe('excluded')
	})
})

describe('directorySkipReason', () => {
	it('blocks hidden, cache and credential directories but not ordinary names', () => {
		expect(directorySkipReason('.git', [])).toBe('hidden')
		expect(directorySkipReason('node_modules', [])).toBe('junk')
		expect(directorySkipReason('.ssh', [])).toBe('hidden')
		expect(directorySkipReason('User Data', [])).toBe('sensitive')
		expect(directorySkipReason('Default', [])).toBeNull()
		expect(directorySkipReason('Holiday 2024', [])).toBeNull()
		expect(directorySkipReason('Archive', ['arch*'])).toBe('excluded')
	})
})

describe('globMatches', () => {
	it('treats regex metacharacters literally', () => {
		expect(globMatches('a+b.txt', 'a+b.txt')).toBe(true)
		expect(globMatches('a+b.txt', 'aab.txt')).toBe(false)
		expect(globMatches('*.tmp', 'x.TMP')).toBe(true)
		expect(globMatches('', 'x')).toBe(false)
	})
})

describe('broadFolderWarning', () => {
	it('flags drive roots, home folders and huge trees', () => {
		expect(broadFolderWarning('C:\\', 10)).toBeTruthy()
		expect(broadFolderWarning('Users', 10)).toBeTruthy()
		expect(broadFolderWarning('Photos', 250_000)).toMatch(/250k/)
		expect(broadFolderWarning('Photos', 5_000)).toBeNull()
	})
})
