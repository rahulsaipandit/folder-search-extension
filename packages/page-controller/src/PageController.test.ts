/**
 * Regression test for the autofill index-mismatch bug (see
 * packages/extension/docs/AutofillDebuggingPostmortem.md, section 4):
 * getFormFields() must report the SAME highlightIndex space that
 * inputText()/selectOption()/clickElement() resolve through selectorMap.
 * A standalone DOM query computing its own index would silently drift from
 * this without any type error - this test would catch that drift.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { PageController } from './PageController'

// jsdom has no real layout engine (every element reports a 0x0 rect), which
// would make the dom_tree engine's visibility/viewport checks reject every
// element. Stub a plausible non-zero, in-viewport rect for interactive tags.
function installLayoutStubs() {
	let top = 0
	const rectCache = new WeakMap<Element, DOMRect>()
	const stubRectFor = (el: Element): DOMRect => {
		let rect = rectCache.get(el)
		if (rect) return rect
		const isInteractive = /^(INPUT|SELECT|TEXTAREA|BUTTON|A|LABEL)$/.test(el.tagName)
		const height = isInteractive ? 30 : 0
		rect = {
			x: 0,
			y: top,
			width: isInteractive ? 300 : 0,
			height,
			top,
			left: 0,
			right: 300,
			bottom: top + height,
			toJSON() {
				return this
			},
		} as DOMRect
		if (isInteractive) top += 40
		rectCache.set(el, rect)
		return rect
	}

	HTMLElement.prototype.getBoundingClientRect = function () {
		return stubRectFor(this)
	}
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
		configurable: true,
		get() {
			return stubRectFor(this).width
		},
	})
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get() {
			return stubRectFor(this).height
		},
	})
	document.elementFromPoint = () => document.body
	HTMLElement.prototype.scrollIntoView = function () {}

	// jsdom's global CSS.escape is not exposed in this environment; getFormFields()
	// uses it to build a label[for="..."] selector.
	if (typeof (globalThis as any).CSS === 'undefined' || !(globalThis as any).CSS.escape) {
		;(globalThis as any).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') }
	}

	// jsdom doesn't implement PointerEvent; actions.ts's click simulation needs it.
	if (typeof (globalThis as any).PointerEvent === 'undefined') {
		;(globalThis as any).PointerEvent = MouseEvent
	}
}

const TEST_FORM_HTML = `
  <form id="application-form">
    <label for="first_name">First Name<span>*</span></label>
    <input id="first_name" name="first_name" type="text" required>

    <label for="email">Email<span>*</span></label>
    <input id="email" name="email" type="email" required>

    <label for="country">Country<span>*</span></label>
    <select id="country" name="country" required>
      <option value="">Select...</option>
      <option value="US">United States</option>
      <option value="CA">Canada</option>
    </select>

    <input type="hidden" id="csrf_token" name="csrf_token" value="abc123">

    <button type="submit">Submit Application</button>
  </form>
`

describe('PageController.getFormFields()', () => {
	beforeEach(() => {
		installLayoutStubs()
		document.body.innerHTML = TEST_FORM_HTML
	})

	it('reports fields whose highlightIndex matches selectorMap - the same index inputText()/selectOption() resolve through', async () => {
		const pc = new PageController({ viewportExpansion: -1 })
		await pc.updateTree()

		const detect = await pc.getFormFields(false)
		expect(detect.success).toBe(true)

		const { fields } = JSON.parse(detect.message)
		const byName = (name: string) => fields.find((f: any) => f.name === name)

		expect(byName('first_name')).toMatchObject({
			fieldType: 'text',
			required: true,
			label: expect.stringContaining('First Name'),
		})
		expect(byName('email')).toMatchObject({ fieldType: 'email', required: true })
		expect(byName('country')).toMatchObject({ fieldType: 'select', required: true })

		// The bug this test guards against: detect_form_fields used to compute its
		// own querySelectorAll-position index, unrelated to highlightIndex. Prove
		// the reported index is the real thing by round-tripping it through the
		// exact same tools fill_form_field/submit_form use.
		const firstName = byName('first_name')
		const fillResult = await pc.inputText(firstName.highlightIndex, 'Ada Lovelace')
		expect(fillResult.success).toBe(true)
		expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Ada Lovelace')

		const country = byName('country')
		const selectResult = await pc.selectOption(country.highlightIndex, 'United States')
		expect(selectResult.success).toBe(true)
		expect((document.getElementById('country') as HTMLSelectElement).value).toBe('US')
	})

	it('excludes hidden fields and includes the submit button', async () => {
		const pc = new PageController({ viewportExpansion: -1 })
		await pc.updateTree()

		const detect = await pc.getFormFields(false)
		const { fields } = JSON.parse(detect.message)

		expect(fields.find((f: any) => f.name === 'csrf_token')).toBeUndefined()
		expect(fields.some((f: any) => f.fieldType === 'submit')).toBe(true)
	})

	it('returns an empty, non-throwing result when the DOM tree has not been indexed yet', async () => {
		const pc = new PageController({ viewportExpansion: -1 })
		const detect = await pc.getFormFields(false)
		expect(detect.success).toBe(false)
	})
})

describe('PageController', () => {
	it('constructs and exposes the current url', async () => {
		const controller = new PageController()
		expect(controller).toBeInstanceOf(PageController)
		expect(await controller.getCurrentUrl()).toBe(window.location.href)
	})

	describe('executeJavascript', () => {
		it('runs a script and returns its result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return 1 + 2')
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('3')
		})

		it('exposes the abort signal to the script scope', async () => {
			const controller = new PageController()
			const controllerSignal = new AbortController()
			controllerSignal.abort()

			const result = await controller.executeJavascript(
				'return signal.aborted',
				controllerSignal.signal
			)
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('true')
		})

		it('reports a syntax error as a failed result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return (')
			expect(result.success).toBe(false)
			expect(result.message).toContain('❌')
		})
	})
})
