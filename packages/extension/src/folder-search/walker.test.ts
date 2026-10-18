import { describe, expect, it } from 'vitest'

import { DEFAULT_CAPS, DEFAULT_KINDS } from './classify'
import { type FsDirHandle, type FsFileHandle, type WalkEvent, walk } from './walker'

const file = (name: string, size = 100, type = ''): FsFileHandle => ({
	kind: 'file',
	name,
	getFile: async () => ({ size, lastModified: 1, type, name }),
})
const dir = (name: string, children: (FsFileHandle | FsDirHandle)[]): FsDirHandle => ({
	kind: 'directory',
	name,
	values: async function* () {
		yield* children
	},
})

async function collect(root: FsDirHandle, extra = {}): Promise<WalkEvent[]> {
	const out: WalkEvent[] = []
	for await (const e of walk(root, { excludes: [], caps: DEFAULT_CAPS, kinds: DEFAULT_KINDS, ...extra })) out.push(e)
	return out
}

describe('walk', () => {
	it('recurses with posix relative paths and flags per-file skip reasons', async () => {
		const root = dir('Photos', [
			file('b.png'),
			dir('trip', [file('a.pdf'), file('.env'), file('notes.docx')]),
			file('app.ts'),
		])
		const files = (await collect(root)).filter(e => e.type === 'file') as Extract<WalkEvent, { type: 'file' }>[]
		expect(files.map(f => [f.relPath, f.skip])).toEqual([
			['app.ts', 'unsupported'],
			['b.png', null],
			['trip/.env', 'sensitive'],
			['trip/a.pdf', null],
			['trip/notes.docx', null],
		])
	})

	it('reports skipped directories without descending into them', async () => {
		const root = dir('r', [dir('node_modules', [file('x.txt')]), dir('.git', [file('y.txt')]), dir('ok', [file('z.txt')])])
		const events = await collect(root)
		expect(events.filter(e => e.type === 'skipped-dir').map(e => (e as any).relPath)).toEqual(['.git', 'node_modules'])
		expect(events.filter(e => e.type === 'file').map(e => (e as any).relPath)).toEqual(['ok/z.txt'])
	})

	it('keeps going after an unreadable entry and surfaces the error', async () => {
		const bad: FsFileHandle = { kind: 'file', name: 'locked.pdf', getFile: async () => { throw new Error('NotReadableError') } }
		const events = await collect(dir('r', [bad, file('fine.txt')]))
		expect(events.find(e => e.type === 'error')).toMatchObject({ relPath: 'locked.pdf', message: 'NotReadableError' })
		expect(events.some(e => e.type === 'file' && e.relPath === 'fine.txt')).toBe(true)
	})

	it('stops at the depth limit instead of looping forever on a cyclic tree', async () => {
		const loop: FsDirHandle = { kind: 'directory', name: 'loop', values: async function* () { yield loop } }
		const events = await collect(dir('r', [loop]), { maxDepth: 5 })
		expect(events.at(-1)).toMatchObject({ type: 'error' })
		expect((events.at(-1) as any).message).toMatch(/deeper than 5/)
	})

	it('honours an abort signal', async () => {
		const ac = new AbortController()
		ac.abort()
		expect(await collect(dir('r', [file('a.txt')]), { signal: ac.signal })).toEqual([])
	})
})
