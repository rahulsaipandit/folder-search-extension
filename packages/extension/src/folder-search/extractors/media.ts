/**
 * DOM-dependent media helpers (image decode, thumbnails, audio windows, video frames). They need
 * `createImageBitmap`, canvas and `AudioContext`, so they run only in the offscreen document.
 */
import { RawImage } from '@huggingface/transformers'

import { planVideoSegments } from '../videoPlan'

/** Longest edge fed to the vision encoder; keeps decode memory and latency bounded. */
export const MODEL_IMAGE_EDGE = 768
export const THUMB_EDGE = 256
export const AUDIO_WINDOW_SEC = 30
export const AUDIO_MAX_SEC = 30 * 60

type CanvasLike = HTMLCanvasElement | OffscreenCanvas

function fit(w: number, h: number, edge: number): { w: number; h: number } {
	const s = Math.min(1, edge / Math.max(w, h))
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas')
	c.width = w
	c.height = h
	return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = c.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('2D canvas is unavailable')
	return ctx
}

export function canvasToBlob(c: CanvasLike, quality = 0.8): Promise<Blob> {
	if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality })
	return new Promise((resolve, reject) =>
		c.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/jpeg', quality)
	)
}

export function rawImageFromCanvas(c: HTMLCanvasElement): RawImage {
	const data = ctx2d(c).getImageData(0, 0, c.width, c.height)
	return new RawImage(data.data, c.width, c.height, 4).rgb()
}

export async function thumbnailFromCanvas(c: HTMLCanvasElement): Promise<Blob> {
	const { w, h } = fit(c.width, c.height, THUMB_EDGE)
	if (w === c.width && h === c.height) return canvasToBlob(c)
	const t = makeCanvas(w, h)
	ctx2d(t).drawImage(c, 0, 0, w, h)
	return canvasToBlob(t)
}

export interface DecodedImage {
	raw: RawImage
	thumbnail: Blob
	/** Original pixel dimensions. */
	width: number
	height: number
}

/** Decodes an image file once, producing the model input and the gallery thumbnail. */
export async function decodeImage(file: Blob): Promise<DecodedImage> {
	const bitmap = await createImageBitmap(file)
	try {
		const { w, h } = fit(bitmap.width, bitmap.height, MODEL_IMAGE_EDGE)
		const canvas = makeCanvas(w, h)
		const ctx = ctx2d(canvas)
		// Flatten transparency onto white so PNG alpha does not become black.
		ctx.fillStyle = '#fff'
		ctx.fillRect(0, 0, w, h)
		ctx.drawImage(bitmap, 0, 0, w, h)
		return {
			raw: rawImageFromCanvas(canvas),
			thumbnail: await thumbnailFromCanvas(canvas),
			width: bitmap.width,
			height: bitmap.height,
		}
	} finally {
		bitmap.close()
	}
}

export interface AudioWindows {
	windows: Float32Array[]
	startSecs: number[]
	durationSec: number
	truncated: boolean
}

/** Decodes to mono 16 kHz and cuts fixed windows (design §12 phase 2). */
export async function decodeAudioWindows(
	file: Blob,
	windowSec = AUDIO_WINDOW_SEC,
	maxSec = AUDIO_MAX_SEC
): Promise<AudioWindows> {
	const AC = window.AudioContext
	const ctx = new AC({ sampleRate: 16000 })
	try {
		const buf = await ctx.decodeAudioData(await file.arrayBuffer())
		const mono = new Float32Array(buf.length)
		for (let ch = 0; ch < buf.numberOfChannels; ch++) {
			const data = buf.getChannelData(ch)
			for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / buf.numberOfChannels
		}
		const rate = buf.sampleRate
		const usable = Math.min(mono.length, Math.floor(maxSec * rate))
		const step = Math.floor(windowSec * rate)
		const windows: Float32Array[] = []
		const startSecs: number[] = []
		for (let at = 0; at < usable; at += step) {
			const slice = mono.slice(at, Math.min(usable, at + step))
			// A sub-second tail carries no usable signal for the encoder.
			if (slice.length < rate && windows.length > 0) break
			windows.push(slice)
			startSecs.push(at / rate)
		}
		return { windows, startSecs, durationSec: buf.duration, truncated: usable < mono.length }
	} finally {
		await ctx.close().catch(() => undefined)
	}
}

export interface VideoSegment {
	start: number
	end: number
	/** Decoded frames, evenly spaced inside the segment. */
	frames: RawImage[]
	/** JPEG of the middle frame, for the results grid. */
	thumbnail: Blob
}

/**
 * Yields one segment per minute with up to 16 frames each (see `planVideoSegments`). An async
 * generator, so only one segment's frames are in memory at a time.
 */
export async function* videoSegments(
	file: Blob
): AsyncGenerator<VideoSegment, { durationSec: number; truncated: boolean; width: number; height: number }> {
	const url = URL.createObjectURL(file)
	const video = document.createElement('video')
	video.muted = true
	video.preload = 'auto'
	video.src = url
	try {
		await new Promise<void>((resolve, reject) => {
			video.onloadedmetadata = () => resolve()
			video.onerror = () => reject(new Error('This video format cannot be decoded by the browser'))
		})
		const duration = video.duration
		const plan = planVideoSegments(duration)
		if (!plan.segments.length) throw new Error('Video has no readable duration')
		for (const seg of plan.segments) {
			const frames: RawImage[] = []
			let thumbnail: Blob | null = null
			for (const [i, t] of seg.times.entries()) {
				await new Promise<void>((resolve, reject) => {
					video.onseeked = () => resolve()
					video.onerror = () => reject(new Error(`Video seek failed at ${t.toFixed(1)}s`))
					video.currentTime = Math.min(t, duration - 0.05)
				})
				const { w, h } = fit(video.videoWidth, video.videoHeight, MODEL_IMAGE_EDGE)
				const canvas = makeCanvas(w, h)
				ctx2d(canvas).drawImage(video, 0, 0, w, h)
				frames.push(rawImageFromCanvas(canvas))
				if (i === Math.floor(seg.times.length / 2)) thumbnail = await thumbnailFromCanvas(canvas)
			}
			yield { start: seg.start, end: seg.end, frames, thumbnail: thumbnail! }
		}
		return { durationSec: duration, truncated: plan.truncated, width: video.videoWidth, height: video.videoHeight }
	} finally {
		video.removeAttribute('src')
		video.load()
		URL.revokeObjectURL(url)
	}
}
