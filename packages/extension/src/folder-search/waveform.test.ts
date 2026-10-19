import { describe, expect, it } from 'vitest'

import { WAVEFORM_BARS, formatDuration, waveformPeaks, waveformPeaksOfChannels } from './waveform'

describe('waveformPeaks', () => {
	it('returns the requested number of bars scaled so the loudest is 1', () => {
		const samples = new Float32Array(1000)
		samples[10] = 0.2
		samples[500] = -0.5 // negative peaks count
		const peaks = waveformPeaks(samples, 10)
		expect(peaks).toHaveLength(10)
		expect(Math.max(...peaks)).toBe(1)
		expect(peaks[5]).toBe(1)
		expect(peaks[0]).toBeCloseTo(0.4)
	})

	it('treats consecutive windows as one signal', () => {
		const a = new Float32Array(500).fill(0.1)
		const b = new Float32Array(500).fill(0.4)
		const joined = waveformPeaks([a, b], 2)
		expect(joined).toEqual([0.25, 1])
		expect(joined).toEqual(waveformPeaks(Float32Array.from([...a, ...b]), 2))
	})

	it('takes the loudest channel in each bucket', () => {
		const left = new Float32Array(100).fill(0.1)
		const right = new Float32Array(100).fill(0.3)
		expect(waveformPeaksOfChannels([left, right], 4)).toEqual([1, 1, 1, 1])
	})

	it('is silent-safe and empty-safe', () => {
		expect(waveformPeaks(new Float32Array(50), 4)).toEqual([0, 0, 0, 0])
		expect(waveformPeaks([], 4)).toEqual([])
		expect(waveformPeaks(new Float32Array(10))).toHaveLength(WAVEFORM_BARS)
	})
})

describe('formatDuration', () => {
	it('formats minutes, seconds and hours', () => {
		expect(formatDuration(7)).toBe('0:07')
		expect(formatDuration(754)).toBe('12:34')
		expect(formatDuration(3723)).toBe('1:02:03')
	})
	it('rounds to the nearest second', () => {
		expect(formatDuration(59.6)).toBe('1:00')
	})
	it('is empty when the length is unknown', () => {
		expect(formatDuration(undefined)).toBe('')
		expect(formatDuration(0)).toBe('')
		expect(formatDuration(Number.NaN)).toBe('')
	})
})
