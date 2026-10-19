// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileRecord } from '@/folder-search/types'

import { WallMedia } from './WallMedia'

const readWaveform = vi.hoisted(() => vi.fn(async (): Promise<{ duration: number; waveform: number[] }> => ({ duration: 3, waveform: [0.5, 1] })))
vi.mock('@/folder-search/mediaMeta', () => ({ readWaveform }))

function rec(kind: 'video' | 'audio', i: number, extra: Partial<FileRecord> = {}): FileRecord {
	return { fileId: `f:${kind}${i}`, folderId: 'f', relPath: `${kind}${i}`, size: 1, mtime: 1, kind, mime: '', indexState: 'indexed', ...extra }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

let revokeObjectURL: ReturnType<typeof vi.fn>
let created: HTMLVideoElement[]
let uploadToTile: ReturnType<typeof vi.fn>
let openFile: ReturnType<typeof vi.fn>
let onPlaying: ReturnType<typeof vi.fn>
let onMeta: ReturnType<typeof vi.fn>

function make(): WallMedia {
	return new WallMedia({ renderer: { uploadToTile } as never, openFile: openFile as never, onPlaying: onPlaying as never, onMeta: onMeta as never })
}
function learnDuration(video: HTMLVideoElement, seconds: number) {
	Object.defineProperty(video, 'duration', { value: seconds, configurable: true })
	video.dispatchEvent(new Event('loadedmetadata'))
}

beforeEach(() => {
	created = []
	uploadToTile = vi.fn(() => true)
	openFile = vi.fn(async () => new File(['x'], 'f'))
	onPlaying = vi.fn()
	onMeta = vi.fn()
	readWaveform.mockClear()
	const real = document.createElement.bind(document)
	vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: unknown[]) => {
		const el = (real as (t: string, ...r: unknown[]) => HTMLElement)(tag, ...rest)
		if (tag === 'video') created.push(el as HTMLVideoElement)
		return el
	}) as never)
	vi.stubGlobal('matchMedia', () => ({ matches: false }))
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
	vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
	vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
	URL.createObjectURL = vi.fn(() => 'blob:test')
	revokeObjectURL = vi.fn()
	URL.revokeObjectURL = revokeObjectURL as never
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('WallMedia videos', () => {
	it('plays at most eight videos, nearest first, and lets go of the ones that leave the viewport', async () => {
		const media = make()
		media.setItems(Array.from({ length: 12 }, (_, i) => rec('video', i)))
		media.setNear([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
		await flush()
		expect(created).toHaveLength(8)
		expect(openFile.mock.calls.map(c => (c[0] as FileRecord).relPath)).toEqual(Array.from({ length: 8 }, (_, i) => `video${i}`))

		media.setNear([5, 6, 7, 8, 9]) // 0-4 scrolled away
		await flush()
		expect(created).toHaveLength(10) // 8 and 9 started
		for (const gone of created.slice(0, 5)) expect(gone.hasAttribute('src')).toBe(false)
		for (const kept of created.slice(5, 8)) expect(kept.getAttribute('src')).toBe('blob:test')
		expect(revokeObjectURL).toHaveBeenCalledTimes(5)
		media.dispose()
	})

	it('hands over learned length and size once per file, however often it comes back into view', async () => {
		const media = make()
		media.setItems([rec('video', 0)])
		media.setNear([0])
		await flush()
		learnDuration(created[0]!, 12)
		expect(onMeta).toHaveBeenCalledTimes(1)
		expect(onMeta.mock.calls[0]![1]).toMatchObject({ duration: 12 })

		media.setNear([]) // scrolled away
		media.setNear([0]) // and back: a new element
		await flush()
		expect(created).toHaveLength(2)
		learnDuration(created[1]!, 12)
		media.setItems([rec('video', 0)]) // the list refreshed with the same stale record
		media.setNear([0])
		await flush()
		learnDuration(created[created.length - 1]!, 12)
		expect(onMeta).toHaveBeenCalledTimes(1)
		media.dispose()
	})

	it('does not give up on a file because releasing its video raised an error', async () => {
		const media = make()
		media.setItems([rec('video', 0)])
		media.setNear([0])
		await flush()
		media.setNear([])
		created[0]!.dispatchEvent(new Event('error')) // what removing the source can cause
		media.setNear([0])
		await flush()
		expect(created).toHaveLength(2)
		expect(openFile).toHaveBeenCalledTimes(2)
		media.dispose()
	})

	it('stops trying a file the browser cannot play', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const media = make()
		media.setItems([rec('video', 0)])
		media.setNear([0])
		await flush()
		created[0]!.dispatchEvent(new Event('error')) // a real decode failure on a live video
		media.setNear([])
		media.setNear([0])
		await flush()
		expect(created).toHaveLength(1)
		media.dispose()
	})

	it('reads a file that cannot be opened once, not on every scroll', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		openFile.mockRejectedValue(new Error('permission lapsed'))
		const media = make()
		media.setItems([rec('video', 0)])
		for (let i = 0; i < 4; i++) {
			media.setNear([0])
			await flush()
			media.setNear([])
		}
		expect(openFile).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledTimes(1)
		media.dispose()
	})

	it('releases every video while a viewer is open, and resumes after', async () => {
		const media = make()
		media.setItems([rec('video', 0), rec('video', 1)])
		media.setNear([0, 1])
		await flush()
		expect(created).toHaveLength(2)
		media.setPaused(true)
		expect(created.every(v => !v.hasAttribute('src'))).toBe(true)
		media.setPaused(false)
		await flush()
		expect(created).toHaveLength(4)
		media.dispose()
	})
})

describe('WallMedia audio', () => {
	it('animates only audio tiles near the viewport, and stops when paused', async () => {
		vi.useFakeTimers()
		const media = make()
		media.setItems([rec('audio', 0, { waveform: [1] }), rec('audio', 1, { waveform: [1] })])
		media.setNear([0])
		await vi.advanceTimersByTimeAsync(160)
		const calls = uploadToTile.mock.calls.length
		expect(calls).toBeGreaterThanOrEqual(2)
		expect(new Set(uploadToTile.mock.calls.map(c => c[0]))).toEqual(new Set([0])) // tile 1 is far away

		media.setPaused(true)
		await vi.advanceTimersByTimeAsync(300)
		expect(uploadToTile.mock.calls.length).toBe(calls)
		media.dispose()
	})

	it('reads the waveform of a file indexed without one just once, and keeps it across refreshes', async () => {
		const media = make()
		const item = rec('audio', 0)
		media.setItems([item])
		media.setNear([0])
		await flush()
		await flush()
		expect(readWaveform).toHaveBeenCalledTimes(1)
		expect(onMeta).toHaveBeenCalledWith(item, expect.objectContaining({ waveform: [0.5, 1] }))
		expect(media.peaksFor(item)).toEqual([0.5, 1])

		media.setItems([item]) // refreshed list, same stale record
		media.setNear([0])
		await flush()
		await flush()
		expect(readWaveform).toHaveBeenCalledTimes(1)
		media.dispose()
	})

	it('does not read the waveform of a file that already has one', async () => {
		const media = make()
		media.setItems([rec('audio', 0, { waveform: [0.2, 0.9] })])
		media.setNear([0])
		await flush()
		expect(readWaveform).not.toHaveBeenCalled()
		media.dispose()
	})
})
