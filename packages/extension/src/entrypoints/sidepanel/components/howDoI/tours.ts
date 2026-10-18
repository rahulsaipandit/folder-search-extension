import type { RefObject } from 'react'

import type { View } from '../../types'
import type { Step, TourId } from './types'

export interface TourContext {
	setView: (v: View) => void
	execute: (task: string) => Promise<unknown>
	statusDotRef: RefObject<HTMLElement | null>
}

/**
 * Builds every "How do I?" tour's Step[] from live app callbacks. Each step's execute()
 * calls the same functions the rest of the UI already uses (agent execute, setView, tab
 * navigation) — see howDoIDesign.md §3/§6 for why this is one runner instead of a
 * driver.js-style tour library plus a separate hand-written executor.
 */
export function buildTours(ctx: TourContext): Record<TourId, Step[]> {
	return {
		'collect-news': [
			{
				title: 'Ask the agent to collect the news',
				body: 'Watch the agent open Yahoo News and CNN and pull together a list of the latest headlines.',
				execute: async () => {
					ctx.setView({ name: 'chat' })
					await ctx.execute(
						'Open Yahoo News and CNN, and give me a list of the latest headlines from both.'
					)
				},
			},
		],
		teleprompter: [
			{
				title: 'Open the Teleprompter',
				body: 'Opening a sample script and loading it into the scrolling display — try Start to see it highlight along with your voice.',
				execute: () => {
					ctx.setView({ name: 'chat' })
					chrome.tabs.create({ url: chrome.runtime.getURL('/teleprompter.html?howDoI=1') })
				},
			},
		],
		'file-compare': [
			{
				title: 'Open File Compare',
				body: 'Opening two sample blobs of text and running a real comparison, so you can see exactly how additions, removals, and word-level changes are highlighted.',
				execute: () => {
					ctx.setView({ name: 'chat' })
					chrome.tabs.create({ url: chrome.runtime.getURL('/diff-tool.html?howDoI=1') })
				},
			},
		],
	}
}
