import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, compareSignatures, signatureFor } from './settings'

describe('index signature', () => {
	const base = signatureFor(DEFAULT_SETTINGS)

	it('reports no index yet, and a match for identical settings', () => {
		expect(compareSignatures(undefined, base)).toBe('none')
		expect(compareSignatures(base, signatureFor(DEFAULT_SETTINGS))).toBe('match')
	})

	it('invalidates the index when precision or vector size changes', () => {
		const q8 = signatureFor({ ...DEFAULT_SETTINGS, selection: { ...DEFAULT_SETTINGS.selection, dtype: 'q8' } })
		expect(compareSignatures(base, q8)).toBe('mismatch')
		expect(compareSignatures(base, signatureFor({ ...DEFAULT_SETTINGS, dim: 512 }))).toBe('mismatch')
	})

	it('keeps the index when only the vision/audio encoders are toggled (existing vectors stay valid)', () => {
		const noVision = signatureFor({ ...DEFAULT_SETTINGS, selection: { ...DEFAULT_SETTINGS.selection, vision: false } })
		expect(compareSignatures(base, noVision)).toBe('match')
	})
})
