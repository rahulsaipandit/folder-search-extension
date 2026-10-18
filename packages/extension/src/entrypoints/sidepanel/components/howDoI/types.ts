import type { RefObject } from 'react'

/**
 * One step of a "How do I?" guided walkthrough. `execute`, when present, performs the
 * real action (an agent run, a tab navigation, a view change, a settings toggle) — the
 * walkthrough is not a scripted narration over a mock, it drives the actual app. See
 * packages/extension/docs/howDoIDesign.md §3/§6 for why this replaces a driver.js-style
 * tour library: a tour library only ever supplies the highlight/popover chrome, so it
 * would sit alongside a hand-written executor rather than instead of one.
 */
export interface Step {
	title: string
	body: string
	/** Ref to the on-screen element to spotlight while this step is active. Omit for a centered, non-anchored step. */
	targetRef?: RefObject<HTMLElement | null>
	/** Performs the step's real action. Advancing to the next step awaits this. */
	execute?: () => Promise<void> | void
}

export type TourId =
	| 'collect-news'
	| 'teleprompter'
	| 'file-compare'
