/** Pure helpers for audio cards: peak levels for the waveform, and duration text. UI- and worker-safe. */

/** Peak values stored per audio file. 96 bars is enough detail for a card and is ~1 KB in the index. */
export const WAVEFORM_BARS = 96

function bucketMax(parts: Float32Array[], bars: number): number[] {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Array<number>(bars).fill(0)
	if (!total) return out
	let offset = 0
	for (const part of parts) {
		for (let i = 0; i < part.length; i++) {
			const bucket = Math.min(bars - 1, Math.floor(((offset + i) * bars) / total))
			const v = Math.abs(part[i]!)
			if (v > out[bucket]!) out[bucket] = v
		}
		offset += part.length
	}
	return out
}

function normalised(raw: number[]): number[] {
	const max = Math.max(0, ...raw)
	return max > 0 ? raw.map(v => Math.round((v / max) * 1000) / 1000) : raw
}

/**
 * Peak level per bucket across a recording given as one signal or as consecutive windows of it,
 * scaled so the loudest bucket is 1. Empty input gives an empty list.
 */
export function waveformPeaks(signal: Float32Array | Float32Array[], bars = WAVEFORM_BARS): number[] {
	const parts = Array.isArray(signal) ? signal : [signal]
	if (bars < 1 || !parts.some(p => p.length)) return []
	return normalised(bucketMax(parts, bars))
}

/** Same, for parallel channels of one recording: each bucket takes the loudest sample on any channel. */
export function waveformPeaksOfChannels(channels: Float32Array[], bars = WAVEFORM_BARS): number[] {
	if (bars < 1 || !channels.some(c => c.length)) return []
	const raw = new Array<number>(bars).fill(0)
	for (const channel of channels) {
		bucketMax([channel], bars).forEach((v, i) => {
			if (v > raw[i]!) raw[i] = v
		})
	}
	return normalised(raw)
}

/** `0:07`, `12:34`, `1:02:03`. Empty for a missing or non-positive length. */
export function formatDuration(seconds: number | undefined): string {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return ''
	const total = Math.round(seconds)
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	const two = (n: number) => String(n).padStart(2, '0')
	return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}
