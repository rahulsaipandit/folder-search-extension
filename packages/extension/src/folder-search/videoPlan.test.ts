import { describe, expect, it } from 'vitest'

import { VIDEO_MAX_FRAMES, planVideoSegments } from './videoPlan'

describe('planVideoSegments', () => {
	it('cuts one segment per minute with at most 16 frames, all strictly inside the segment', () => {
		const { segments, truncated } = planVideoSegments(150)
		expect(truncated).toBe(false)
		expect(segments.map(s => [s.start, s.end])).toEqual([[0, 60], [60, 120], [120, 150]])
		expect(segments[0]!.times).toHaveLength(VIDEO_MAX_FRAMES)
		for (const s of segments) {
			for (const t of s.times) {
				expect(t).toBeGreaterThanOrEqual(s.start)
				expect(t).toBeLessThan(s.end)
			}
			expect([...s.times].sort((a, b) => a - b)).toEqual(s.times)
		}
	})

	it('uses fewer frames for a short tail but never zero', () => {
		const tail = planVideoSegments(61).segments[1]!
		expect(tail.times).toHaveLength(1)
		expect(planVideoSegments(0.5).segments[0]!.times).toHaveLength(1)
	})

	it('caps the number of segments and says so', () => {
		const { segments, truncated } = planVideoSegments(3 * 3600)
		expect(segments).toHaveLength(120)
		expect(truncated).toBe(true)
	})

	it('returns nothing for unreadable durations instead of looping', () => {
		for (const d of [0, -1, NaN, Infinity]) expect(planVideoSegments(d).segments).toEqual([])
	})
})
