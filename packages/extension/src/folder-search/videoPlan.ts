/**
 * Video segmentation for the `videos` modality (design §14.5): one segment per minute, up to 16
 * frames evenly spaced inside it. 16 frames × ~140 tokens = 2,240, under the WebGPU batch budget.
 */
export const VIDEO_SEGMENT_SEC = 60
export const VIDEO_MAX_FRAMES = 16
/** 2 hours at one segment per minute; longer videos are truncated with a note. */
export const VIDEO_MAX_SEGMENTS = 120
/** Soundtrack decoding needs the whole file in memory, so larger files skip it (with a note). */
export const SOUNDTRACK_MAX_BYTES = 200 * 1024 * 1024

export interface VideoSegmentPlan {
	start: number
	end: number
	/** Seconds at which to grab frames, evenly spaced within [start, end). */
	times: number[]
}

export function planVideoSegments(
	duration: number,
	opts: { segmentSec?: number; maxFrames?: number; maxSegments?: number } = {}
): { segments: VideoSegmentPlan[]; truncated: boolean } {
	const segmentSec = opts.segmentSec ?? VIDEO_SEGMENT_SEC
	const maxFrames = opts.maxFrames ?? VIDEO_MAX_FRAMES
	const maxSegments = opts.maxSegments ?? VIDEO_MAX_SEGMENTS
	if (!Number.isFinite(duration) || duration <= 0) return { segments: [], truncated: false }
	const total = Math.ceil(duration / segmentSec)
	const segments: VideoSegmentPlan[] = []
	for (let s = 0; s < Math.min(total, maxSegments); s++) {
		const start = s * segmentSec
		const end = Math.min(duration, start + segmentSec)
		const len = end - start
		// Same frame density as a full segment (maxFrames per segmentSec), at least one frame.
		const n = Math.min(maxFrames, Math.max(1, Math.ceil(len / (segmentSec / maxFrames))))
		segments.push({ start, end, times: Array.from({ length: n }, (_, i) => start + ((i + 0.5) * len) / n) })
	}
	return { segments, truncated: total > maxSegments }
}
