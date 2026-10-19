import { describe, expect, it } from 'vitest'

import { nextFocusIndex } from './focusTrap'

describe('nextFocusIndex', () => {
	it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', () => {
		expect(nextFocusIndex(4, 3, false)).toBe(0)
		expect(nextFocusIndex(4, 0, true)).toBe(3)
	})
	it('leaves ordinary Tab movement inside the dialog to the browser', () => {
		expect(nextFocusIndex(4, 1, false)).toBeNull()
		expect(nextFocusIndex(4, 2, true)).toBeNull()
	})
	it('brings focus that is outside the dialog back in, at the end the user was heading for', () => {
		expect(nextFocusIndex(4, -1, false)).toBe(0)
		expect(nextFocusIndex(4, -1, true)).toBe(3)
	})
	it('copes with a single control and with none', () => {
		expect(nextFocusIndex(1, 0, false)).toBe(0)
		expect(nextFocusIndex(1, 0, true)).toBe(0)
		expect(nextFocusIndex(0, -1, false)).toBeNull()
	})
})
