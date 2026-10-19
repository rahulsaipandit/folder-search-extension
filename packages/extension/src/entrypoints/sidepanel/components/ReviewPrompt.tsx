import { Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { extensionName } from '@/shared/extensionName'
import { getFeedbackFormConfig, getStoreReviewUrl, reviewPromptEnabled } from '@/shared/reviewConfig'
import { markReviewDone, registerOpen, routeForRating } from '@/shared/reviewPrompt'

import { useFocusTrap } from './FolderSearch/focusTrap'

/**
 * Counted once per side panel load. A module-level promise (not a ref) so React StrictMode's double
 * effect in dev cannot count one open twice. Design: docs/designGuidelines.md §5.
 */
let opened: Promise<boolean> | undefined
function countOpenOnce(): Promise<boolean> {
	opened ??= registerOpen()
	return opened
}

/** "Enjoying Folder Search?" popup. Renders nothing until the open counter says it is due. */
export function ReviewPrompt() {
	const { t } = useI18n()
	const [visible, setVisible] = useState(false)
	const [hover, setHover] = useState(0)
	const dialogRef = useRef<HTMLDivElement>(null)
	useFocusTrap(dialogRef)

	useEffect(() => {
		// Feature flag off: no popup and no counting, so enabling it later starts from zero opens.
		if (!reviewPromptEnabled()) return
		// Without the form config the prompt could send low ratings nowhere; stay hidden and do not
		// consume an ask.
		if (!getFeedbackFormConfig()) return
		countOpenOnce()
			.then(setVisible)
			.catch(e => console.error('[review] could not read or write the open counter:', e))
	}, [])

	useEffect(() => {
		if (!visible) return
		// Move focus into the modal so keyboard users do not stay on the page behind it.
		dialogRef.current?.querySelector<HTMLElement>('[data-first-star]')?.focus()
		const key = (e: KeyboardEvent) => e.key === 'Escape' && setVisible(false)
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [visible])

	if (!visible) return null

	const rate = async (rating: number) => {
		setVisible(false)
		const url =
			routeForRating(rating) === 'store'
				? getStoreReviewUrl()
				: chrome.runtime.getURL(`feedback.html?ext=${encodeURIComponent(extensionName())}`)
		try {
			await markReviewDone()
		} catch (e) {
			console.error('[review] could not record the rating; the prompt may appear again:', e)
		}
		void chrome.tabs.create({ url })
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="review-title"
				className="bg-background text-foreground relative w-full max-w-sm rounded-2xl p-6 text-center shadow-xl"
			>
				<button
					type="button"
					aria-label={t('review.close')}
					onClick={() => setVisible(false)}
					className="text-muted-foreground hover:text-foreground absolute top-3 right-3 rounded p-1"
				>
					<X className="size-5" />
				</button>
				<img src="/assets/page-agent-64.png" alt="" className="mx-auto mb-3 size-14 rounded-xl" />
				<h2 id="review-title" className="text-xl font-bold">
					{t('review.title')}
				</h2>
				<p className="text-muted-foreground mt-1 text-sm font-medium">{t('review.subtitle')}</p>
				<div className="my-4 flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
					{[1, 2, 3, 4, 5].map(n => (
						<button
							key={n}
							data-first-star={n === 1 ? '' : undefined}
							type="button"
							aria-label={t('review.rate', { count: n })}
							onClick={() => void rate(n)}
							onMouseEnter={() => setHover(n)}
							onFocus={() => setHover(n)}
							onBlur={() => setHover(0)}
							className="rounded p-0.5"
						>
							<Star
								className={`size-9 ${n <= hover ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted'}`}
							/>
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={() => setVisible(false)}
					className="text-muted-foreground hover:text-foreground text-sm font-medium"
				>
					{t('review.maybeLater')}
				</button>
			</div>
		</div>
	)
}
