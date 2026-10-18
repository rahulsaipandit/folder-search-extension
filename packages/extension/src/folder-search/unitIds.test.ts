import { describe, expect, it } from 'vitest'

import { unitFileOf, unitStartOf } from './unitIds'

describe('unit ids', () => {
	it('splits on the last @ so file names containing @ survive', () => {
		expect(unitFileOf('f1:clips/a@b.mp4@120')).toBe('f1:clips/a@b.mp4')
		expect(unitStartOf('f1:clips/a@b.mp4@120')).toBe(120)
	})

	it('reads the start second of soundtrack windows (suffix a) as well as segments', () => {
		expect(unitStartOf('f:v.mp4@30a')).toBe(30)
		expect(unitFileOf('f:v.mp4@30a')).toBe('f:v.mp4')
		expect(unitStartOf('f:v.mp4@')).toBe(0)
	})
})
