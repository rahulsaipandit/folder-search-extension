/**
 * The audio card: a dark gradient with a centre line and one bar per peak, as in the EmbeddingGemma demo.
 * Used for the wall tile (animated with a gentle pulse) and for the viewer (with a play position).
 */

/** Audio tiles are 4:3 (there is no picture to take a shape from). */
export const AUDIO_TILE_ASPECT = 4 / 3

/** Shown until real peaks are known, so a card never looks empty. */
export const PLACEHOLDER_PEAKS: number[] = Array.from({ length: 96 }, (_, i) => 0.12 + 0.5 * Math.sin(i * 0.37) ** 2 * Math.sin(i * 0.11) ** 2)

/** Largest value in each of `n` equal slices of `values`. */
function resample(values: number[], n: number): number[] {
	const count = Math.min(values.length, Math.max(1, Math.floor(n)))
	return Array.from({ length: count }, (_, i) => {
		const from = Math.floor((i * values.length) / count)
		const to = Math.floor(((i + 1) * values.length) / count)
		let max = 0
		for (let j = from; j < to; j++) max = Math.max(max, values[j]!)
		return max
	})
}

/**
 * @param progress 0..1 play position; bars up to it are bright and the rest dim. 0 draws all bars equally.
 * @param time seconds, for the pulse that rolls along the bars; omit for a still picture.
 */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: number[] | undefined, progress = 0, time?: number): void {
	const w = canvas.width
	const h = canvas.height
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	const bg = ctx.createLinearGradient(0, 0, w, h)
	bg.addColorStop(0, '#12363d')
	bg.addColorStop(0.48, '#0c202b')
	bg.addColorStop(1, '#080e1b')
	ctx.fillStyle = bg
	ctx.fillRect(0, 0, w, h)

	const left = Math.round(w * 0.09)
	const span = Math.round(w * 0.82)
	const mid = Math.round(h * 0.46)
	ctx.fillStyle = '#b9f2ef20'
	ctx.fillRect(left, mid, span, 1)

	const bars = resample(peaks?.length ? peaks : PLACEHOLDER_PEAKS, Math.floor(span / 5))
	const pitch = span / bars.length
	const played = Math.max(0, Math.min(1, progress))
	const fill = ctx.createLinearGradient(left, mid - h * 0.18, left + span, mid + h * 0.18)
	fill.addColorStop(0, '#b1f5e4')
	fill.addColorStop(0.55, '#8ad9ee')
	fill.addColorStop(1, '#a7b9f1')
	for (let i = 0; i < bars.length; i++) {
		const pulse = time === undefined ? 1 : 0.7 + 0.3 * Math.sin(time * 3.2 - i * 0.16)
		const half = Math.max(1, Math.round(bars[i]! * pulse * h * 0.18))
		ctx.fillStyle = played > 0 && i / bars.length <= played ? '#edfffa' : fill
		ctx.globalAlpha = played > 0 && i / bars.length > played ? 0.48 : 0.9
		ctx.beginPath()
		ctx.roundRect(Math.round(left + i * pitch), mid - half, Math.max(2, Math.round(pitch * 0.6)), half * 2, 1)
		ctx.fill()
	}
	ctx.globalAlpha = 1
	if (played > 0) {
		ctx.fillStyle = '#edfffa'
		ctx.fillRect(Math.round(left + span * played), Math.round(mid - h * 0.22), 2, Math.round(h * 0.44))
	}
}
