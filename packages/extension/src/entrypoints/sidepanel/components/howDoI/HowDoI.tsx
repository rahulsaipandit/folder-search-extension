import { CornerUpLeft, FileDiff, type LucideIcon, Mic, Newspaper } from 'lucide-react'

import { Button } from '@/components/ui/button'

import type { TourId } from './types'

interface HowDoICard {
	id: string
	title: string
	subtitle: string
	icon: LucideIcon
	color: string
	action:
		| { kind: 'tour'; tourId: TourId }
		| { kind: 'tab'; url: string }
}

const CARDS: HowDoICard[] = [
	{
		id: 'collect-news',
		title: 'Collect latest news',
		subtitle: 'Have the agent pull headlines from Yahoo News and CNN',
		icon: Newspaper,
		color: 'red',
		action: { kind: 'tour', tourId: 'collect-news' },
	},
	{
		id: 'teleprompter',
		title: 'TelePrompter',
		subtitle: 'Voice-controlled teleprompter for reading a script aloud',
		icon: Mic,
		color: 'rose',
		action: { kind: 'tour', tourId: 'teleprompter' },
	},
	{
		id: 'diff-tool',
		title: 'File Compare',
		subtitle: 'See exactly what changed between two files',
		icon: FileDiff,
		color: 'teal',
		action: { kind: 'tour', tourId: 'file-compare' },
	},
]

const colorClasses: Record<string, string> = {
	red: 'bg-red-500/20 text-red-500 dark:bg-red-500/10 dark:text-red-400',
	orange: 'bg-orange-500/20 text-orange-500 dark:bg-orange-500/10 dark:text-orange-400',
	blue: 'bg-blue-500/20 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400',
	rose: 'bg-rose-500/20 text-rose-500 dark:bg-rose-500/10 dark:text-rose-400',
	teal: 'bg-teal-500/20 text-teal-500 dark:bg-teal-500/10 dark:text-teal-400',
	indigo: 'bg-indigo-500/20 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400',
}

interface Props {
	onBack: () => void
	onStartTour: (tourId: TourId) => void
}

export function HowDoI({ onBack, onStartTour }: Props) {
	return (
		<div className="flex flex-col h-screen bg-background">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<span className="text-sm font-medium">HELP - How do I?</span>
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<CornerUpLeft className="size-3.5" />
				</Button>
			</header>
			<main className="flex-1 overflow-y-auto p-3">
				<p className="text-sm text-muted-foreground mb-1">
					Choose a workflow below to see a simulated walkthrough of how it works, step by step.
				</p>
				<p className="text-sm font-bold mb-3">Simulated Agent Library Cards</p>
				<div className="grid grid-cols-2 gap-3">
					{CARDS.map((card) => {
						const Icon = card.icon
						return (
							<button
								key={card.id}
								type="button"
								className="flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left hover:bg-muted/50 transition-colors cursor-pointer"
								onClick={() => {
									if (card.action.kind === 'tour') {
										onStartTour(card.action.tourId)
									} else {
										chrome.tabs.create({ url: chrome.runtime.getURL(card.action.url) })
									}
								}}
							>
								<div className={`size-10 rounded-full flex items-center justify-center ${colorClasses[card.color]}`}>
									<Icon className="size-5" />
								</div>
								<div>
									<div className="text-sm font-medium">{card.title}</div>
									<div className="text-xs text-muted-foreground">{card.subtitle}</div>
								</div>
							</button>
						)
					})}
				</div>
			</main>
		</div>
	)
}
