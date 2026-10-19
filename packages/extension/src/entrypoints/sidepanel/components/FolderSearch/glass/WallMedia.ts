/**
 * Makes the wall's audio and video tiles live, the way the EmbeddingGemma demo does (design §4B.3):
 * videos near the viewport play muted and looping, and every frame is copied into the tile's texture;
 * audio tiles show their waveform with a gentle rolling pulse. Only a handful of videos play at once.
 *
 * Files are read from the user's folder on demand. When access has lapsed (a browser restart) the tile
 * simply keeps its poster; one warning is logged per file.
 */
import { type MediaMeta, readWaveform } from '@/folder-search/mediaMeta'
import type { FileRecord } from '@/folder-search/types'

import { AUDIO_TILE_ASPECT, drawWaveform } from './drawWaveform'
import type { GlassRenderer } from './GlassRenderer'

/** Videos playing at once: 8, or 4 on touch devices (same limits as the demo). */
export const videoLimit = (): number => (matchMedia('(pointer: coarse)').matches ? 4 : 8)
/** Audio waveforms are redrawn this often (milliseconds), as in the demo. */
const AUDIO_FRAME_MS = 50
const AUDIO_CANVAS_W = 320

export interface WallMediaHost {
	renderer: GlassRenderer
	openFile: (item: FileRecord) => Promise<File>
	/** Indices of the video tiles that are playing now (for the pause/play icon). */
	onPlaying: (playing: ReadonlySet<number>) => void
	/** Duration, size or peaks that were not in the index; the caller shows and saves them. */
	onMeta: (item: FileRecord, meta: MediaMeta) => void
}

interface LiveVideo {
	video: HTMLVideoElement
	url: string | null
	frame: number
	released: boolean
}

export class WallMedia {
	private items: FileRecord[] = []
	private near: number[] = []
	private paused = false
	private readonly videos = new Map<number, LiveVideo>()
	private readonly playing = new Set<number>()
	private readonly blocked = new Set<string>()
	/** Files whose length/size/peaks were already handed to the host this session (survives `setItems`). */
	private readonly reported = new Set<string>()
	private readonly peaks = new Map<string, number[]>()
	private readonly canvases = new Map<number, HTMLCanvasElement>()
	private readonly waveformRequested = new Set<string>()
	private waveformQueue: Promise<void> = Promise.resolve()
	private audioTimer = 0
	private disposed = false

	constructor(private readonly host: WallMediaHost) {
		document.addEventListener('visibilitychange', this.reconcile)
	}

	setItems(items: FileRecord[]): void {
		this.releaseAll()
		this.items = items
		this.canvases.clear()
		for (const f of items) if (f.waveform?.length) this.peaks.set(f.fileId, f.waveform)
		this.reconcile()
	}

	/** Tile indices near the viewport, nearest first. */
	setNear(near: number[]): void {
		this.near = near
		this.reconcile()
	}

	/** Stop everything while a viewer is open (it plays its own copy). */
	setPaused(paused: boolean): void {
		this.paused = paused
		this.reconcile()
	}

	/** Peaks for an audio tile: stored, backfilled, or undefined (drawn as a placeholder pattern). */
	peaksFor(item: FileRecord): number[] | undefined {
		return this.peaks.get(item.fileId)
	}

	/** First picture of an audio tile. */
	audioPoster(item: FileRecord): HTMLCanvasElement {
		const canvas = document.createElement('canvas')
		canvas.width = AUDIO_CANVAS_W
		canvas.height = Math.round(AUDIO_CANVAS_W / AUDIO_TILE_ASPECT)
		drawWaveform(canvas, this.peaksFor(item))
		return canvas
	}

	private readonly reconcile = (): void => {
		if (this.disposed) return
		const active = !this.paused && !document.hidden
		const near = active ? this.near : []

		const wantVideos = new Set<number>()
		for (const i of near) {
			if (wantVideos.size >= videoLimit()) break
			if (this.items[i]?.kind === 'video') wantVideos.add(i)
		}
		for (const i of [...this.videos.keys()]) if (!wantVideos.has(i)) this.release(i)
		for (const i of wantVideos) if (!this.videos.has(i)) void this.activate(i)

		const audio = near.filter(i => this.items[i]?.kind === 'audio')
		for (const i of audio) this.requestWaveform(i)
		if (audio.length && !this.audioTimer) this.audioTimer = window.setInterval(this.drawAudio, AUDIO_FRAME_MS)
		else if (!audio.length && this.audioTimer) this.stopAudio()
	}

	// ── Video ───────────────────────────────────────────────────────────────────────────────────

	private async activate(index: number): Promise<void> {
		const item = this.items[index]
		if (!item || this.blocked.has(item.fileId)) return
		const video = document.createElement('video')
		video.muted = true
		video.loop = true
		video.playsInline = true
		video.preload = 'auto'
		const live: LiveVideo = { video, url: null, frame: 0, released: false }
		this.videos.set(index, live)

		video.addEventListener('loadedmetadata', () => {
			if ((item.duration === undefined || item.width === undefined) && !this.reported.has(item.fileId)) {
				this.reported.add(item.fileId)
				this.host.onMeta(item, {
					duration: Number.isFinite(video.duration) ? video.duration : undefined,
					width: video.videoWidth || undefined,
					height: video.videoHeight || undefined,
				})
			}
		})
		video.addEventListener('loadeddata', () => {
			if (!live.released) void video.play().catch(e => console.warn('[folder-search] video would not play:', item.relPath, e))
		})
		video.addEventListener('playing', () => {
			if (live.released) return
			this.setPlaying(index, true)
			this.startFrames(index, live)
		})
		const stopped = () => {
			this.setPlaying(index, false)
			if (live.frame) video.cancelVideoFrameCallback(live.frame)
			live.frame = 0
		}
		video.addEventListener('pause', stopped)
		video.addEventListener('error', () => {
			// Releasing a video (removing its source) can raise one: that is not a reason to give up on the file.
			if (live.released) return
			stopped()
			this.blocked.add(item.fileId)
			console.warn('[folder-search] this browser cannot play', item.relPath)
		})

		try {
			const file = await this.host.openFile(item)
			if (live.released) return
			live.url = URL.createObjectURL(file)
			video.src = live.url
		} catch (e) {
			// Usually: folder access lapsed. The poster stays; do not retry on every scroll.
			this.blocked.add(item.fileId)
			this.videos.delete(index)
			live.released = true
			console.warn('[folder-search] could not read', item.relPath, 'to play it:', e instanceof Error ? e.message : e)
		}
	}

	private startFrames(index: number, live: LiveVideo): void {
		const { video } = live
		if (typeof video.requestVideoFrameCallback !== 'function' || live.frame) return
		const step = () => {
			if (live.released || video.paused) {
				live.frame = 0
				return
			}
			this.host.renderer.uploadToTile(index, video)
			live.frame = video.requestVideoFrameCallback(step)
		}
		live.frame = video.requestVideoFrameCallback(step)
	}

	private release(index: number): void {
		const live = this.videos.get(index)
		if (!live) return
		live.released = true
		this.videos.delete(index)
		if (live.frame) live.video.cancelVideoFrameCallback(live.frame)
		live.video.pause()
		live.video.removeAttribute('src')
		live.video.load()
		if (live.url) URL.revokeObjectURL(live.url)
		this.setPlaying(index, false)
	}

	private releaseAll(): void {
		for (const i of [...this.videos.keys()]) this.release(i)
		this.stopAudio()
	}

	private setPlaying(index: number, on: boolean): void {
		if (on === this.playing.has(index)) return
		if (on) this.playing.add(index)
		else this.playing.delete(index)
		this.host.onPlaying(new Set(this.playing))
	}

	// ── Audio ───────────────────────────────────────────────────────────────────────────────────

	private readonly drawAudio = (): void => {
		const t = performance.now() / 1000
		for (const i of this.near) {
			const item = this.items[i]
			if (item?.kind !== 'audio') continue
			let canvas = this.canvases.get(i)
			if (!canvas) {
				canvas = this.audioPoster(item)
				this.canvases.set(i, canvas)
			}
			drawWaveform(canvas, this.peaksFor(item), 0, t)
			this.host.renderer.uploadToTile(i, canvas)
		}
	}

	private stopAudio(): void {
		window.clearInterval(this.audioTimer)
		this.audioTimer = 0
	}

	/** Reads a file indexed before peaks were stored. One at a time: decoding audio is not free. */
	private requestWaveform(index: number): void {
		const item = this.items[index]
		if (!item || item.waveform?.length || this.peaks.has(item.fileId) || this.waveformRequested.has(item.fileId) || this.blocked.has(item.fileId)) return
		this.waveformRequested.add(item.fileId)
		this.waveformQueue = this.waveformQueue.then(async () => {
			if (this.disposed) return
			try {
				const meta = await readWaveform(await this.host.openFile(item))
				if (meta.waveform?.length) this.peaks.set(item.fileId, meta.waveform)
				this.reported.add(item.fileId)
				this.host.onMeta(item, meta)
			} catch (e) {
				this.blocked.add(item.fileId)
				console.warn('[folder-search] could not read the waveform of', item.relPath, e instanceof Error ? e.message : e)
			}
		})
	}

	dispose(): void {
		this.disposed = true
		document.removeEventListener('visibilitychange', this.reconcile)
		this.releaseAll()
	}
}
