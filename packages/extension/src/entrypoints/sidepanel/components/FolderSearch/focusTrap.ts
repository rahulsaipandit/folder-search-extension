import { type RefObject, useEffect } from 'react'

/**
 * Where Tab should move to inside a dialog with `count` focusable controls, or null to let the browser
 * do its normal thing. Only the ends need handling: Tab on the last control wraps to the first,
 * Shift+Tab on the first wraps to the last, and focus that has strayed outside comes back in.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number | null {
	if (count <= 0) return null
	if (current < 0) return backwards ? count - 1 : 0
	if (!backwards && current === count - 1) return 0
	if (backwards && current === 0) return count - 1
	return null
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Keeps Tab inside `ref`'s element while it is mounted (the dialogs are modal; the page behind must not be reachable). */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const root = ref.current
		if (!root) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return
			const controls = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
			const next = nextFocusIndex(controls.length, controls.indexOf(document.activeElement as HTMLElement), e.shiftKey)
			if (next !== null) {
				e.preventDefault()
				controls[next]!.focus()
			} else if (!controls.length) {
				e.preventDefault()
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [ref])
}
