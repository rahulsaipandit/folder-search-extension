import { useEffect, useState } from 'react'

import type { Step } from './types'

interface Rect {
	top: number
	left: number
	width: number
	height: number
}

/**
 * Cutout spotlight over `step.targetRef`, re-measured on resize/scroll so it tracks the
 * real element rather than a fixed snapshot. Renders nothing (a centered popover only,
 * handled by the caller) when the step has no targetRef.
 */
export function SpotlightOverlay({ step }: { step: Step }) {
	const [rect, setRect] = useState<Rect | null>(null)

	useEffect(() => {
		const target = step.targetRef?.current
		if (!target) {
			setRect(null)
			return
		}
		const measure = () => {
			const r = target.getBoundingClientRect()
			setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
		}
		measure()
		window.addEventListener('resize', measure)
		window.addEventListener('scroll', measure, true)
		return () => {
			window.removeEventListener('resize', measure)
			window.removeEventListener('scroll', measure, true)
		}
	}, [step.targetRef])

	if (!rect) return null

	const pad = 6
	return (
		<div
			className="pointer-events-none fixed rounded-md ring-2 ring-primary transition-all duration-200"
			style={{
				top: rect.top - pad,
				left: rect.left - pad,
				width: rect.width + pad * 2,
				height: rect.height + pad * 2,
				boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
				// Matches TourOverlay's max z-index so the spotlight cutout stays visible even
				// when the tour has navigated into a tool with its own max-z full-screen overlay
				// (e.g. ScreenshotEditor).
				zIndex: 2147483647,
			}}
		/>
	)
}
