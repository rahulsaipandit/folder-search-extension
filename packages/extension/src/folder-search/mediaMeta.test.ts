import { describe, expect, it } from 'vitest'

import { definedOnly } from './mediaMeta'

describe('definedOnly', () => {
	it('drops undefined fields so a patch cannot erase stored values', () => {
		expect(definedOnly({ duration: undefined, width: 320, height: undefined })).toEqual({ width: 320 })
		expect(Object.keys(definedOnly({ duration: undefined }))).toEqual([])
	})
	it('keeps real values, including zero-ish ones that are still values', () => {
		expect(definedOnly({ duration: 0, waveform: [] })).toEqual({ duration: 0, waveform: [] })
	})
})
