import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { SpotlightOverlay } from './SpotlightOverlay'
import type { Step } from './types'

interface Props {
	steps: Step[]
	onClose: () => void
}

/**
 * Drives a "How do I?" tour: awaits each step's execute() before allowing "Next", and
 * renders a spotlight + popover from the same step definition. One runner for every
 * tour — see howDoIDesign.md §3 for why this replaces a driver.js-style tour library.
 */
export function TourOverlay({ steps, onClose }: Props) {
	const [index, setIndex] = useState(0)
	const [running, setRunning] = useState(false)
	const step = steps[index]
	const isLast = index === steps.length - 1
	// Synchronous guard against re-invoking execute() for the same step index — state
	// updates (ranIndex) land after a render, so a rapid re-render burst (an agent run
	// causes many, via history/activity updates) can otherwise re-enter this effect
	// before the async execute() call's `finally` has a chance to record it as started.
	const startedIndexRef = useRef(-1)

	// Run the current step's action once when it becomes active.
	useEffect(() => {
		if (!step?.execute || startedIndexRef.current === index) return
		startedIndexRef.current = index
		let cancelled = false
		setRunning(true)
		Promise.resolve(step.execute())
			.catch((err) => {
				console.error('[HowDoI] Tour step failed', err)
				toast.error(err instanceof Error ? err.message : 'Step failed')
			})
			.finally(() => {
				if (!cancelled) setRunning(false)
			})
		return () => {
			cancelled = true
		}
	}, [index, step])

	if (!step) return null

	const handleNext = () => {
		if (running) return
		if (isLast) {
			onClose()
		} else {
			setIndex((i) => i + 1)
		}
	}

	// ScreenshotEditor (and other full-screen tools a tour can navigate into) render their
	// own overlay at zIndex 2147483647 — the max signed 32-bit int — so it always sits above
	// arbitrary host content. Matching that value here (and relying on this overlay being
	// the later sibling in the DOM, so it wins ties) keeps the tour popover reachable
	// instead of being buried underneath those tools' own full-screen chrome.
	const MAX_Z = 2147483647

	return (
		<div className="fixed inset-0" style={{ zIndex: MAX_Z }}>
			<SpotlightOverlay step={step} />
			{!step.targetRef && (
				<div className="pointer-events-none fixed inset-0 bg-black/55" style={{ zIndex: MAX_Z }} />
			)}
			<div
				className="fixed w-[calc(100%-2rem)] max-w-sm left-1/2 -translate-x-1/2 bottom-6 rounded-lg border bg-card p-3 shadow-lg"
				style={{ zIndex: MAX_Z }}
			>
				<div className="flex items-start justify-between gap-2">
					<div className="text-sm font-medium">{step.title}</div>
					<Button variant="ghost" size="icon-sm" className="size-6 -mt-1 -mr-1" onClick={onClose} title="Close walkthrough">
						<X className="size-3.5" />
					</Button>
				</div>
				<p className="text-xs text-muted-foreground mt-1">{step.body}</p>
				<div className="flex items-center justify-between mt-3">
					<span className="text-[10px] text-muted-foreground">
						Step {index + 1} of {steps.length}
					</span>
					<div className="flex items-center gap-1.5">
						{index > 0 && (
							<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIndex((i) => i - 1)} disabled={running}>
								<ChevronLeft className="size-3" />
								Back
							</Button>
						)}
						<Button size="sm" className="h-7 text-xs" onClick={handleNext} disabled={running}>
							{running ? (
								<Loader2 className="size-3 animate-spin" />
							) : isLast ? (
								'Done'
							) : (
								<>
									Next
									<ChevronRight className="size-3" />
								</>
							)}
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
