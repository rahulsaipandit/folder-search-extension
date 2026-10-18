import {
	Brain,
	CalendarClock,
	ChevronDown,
	Clock,
	CornerUpLeft,
	ExternalLink,
	Eye,
	FileDiff,
	FolderSearch2,
	HelpCircle,
	Laugh,
	Library,
	Link,
	Mic,
	Palette,
	PenTool,
	// Puzzle, — only used by the disabled Extension Ranker card below; re-import when re-enabled.
	Search,
	Smartphone,
	Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import MessageEmotionButtons from '@/components/ui/MessageEmotionButtons'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

import { trackCardClick } from '@/lib/analytics'

import { getPendingTrajectoryCount, recordTrajectory } from '../../../actions/TrajectoryCollector'
import { listSessions } from '../../../lib/db'
import { ActionOptimizationWidget } from '../../../lib/scheduledWidgets'
import {
	createWidgetInstance,
} from '../../../lib/widgetRuntime'
import type { View } from '../types'

// Maps special action IDs to their navigation target.
// panelView: opens in the side panel. tabUrl: opens in a new tab.
// buttonTabUrl: overrides tabUrl when the ExternalLink icon button is clicked.
const SPECIAL_SKILL_ROUTES: Record<
	string,
	{ panelView?: string; tabUrl?: string; buttonTabUrl?: string }
> = {
	'svg-viewer': { tabUrl: '/svg-viewer.html' },
	'color-selector': { tabUrl: '/color-selector.html' },
	'url-tools': { tabUrl: '/url-tools.html' },
	teleprompter: { tabUrl: '/teleprompter.html' },
	'diff-tool': { tabUrl: '/diff-tool.html' },
	'epoch-converter': { tabUrl: '/epoch-converter.html' },
	'skill-manager': { panelView: 'skill-manager' },
	'how-do-i': { panelView: 'how-do-i' },
	'folder-search': { panelView: 'folder-search' },
	// 'seo-rank-tracker': { tabUrl: 'seo-tracker.html' }, — card disabled, see note above skills array
	// 'chrome-extension-ranker': { tabUrl: 'extension-ranker.html' }, — card disabled, see note above skills array
	'phone-simulator': { tabUrl: '/phone-simulator.html' },
}

const skills = [
	{
		id: 'folder-search',
		name: 'Folder Search',
		desc: 'Search your photos and documents by meaning. Private: runs on your device',
		icon: FolderSearch2,
		color: 'emerald',
		isSpecial: true,
	},
	{
		id: 'how-do-i',
		name: 'How do I?',
		desc: 'Guided walkthroughs of common workflows, run for real',
		icon: HelpCircle,
		color: 'violet',
		isSpecial: true,
	},
	{
		id: 'teleprompter',
		name: 'Teleprompter',
		desc: 'Voice-controlled teleprompter that highlights words as you speak them, with a practice mode',
		icon: Mic,
		color: 'rose',
		isSpecial: true,
	},
	{
		id: 'diff-tool',
		name: 'File Compare',
		desc: 'Compare two or three blobs of text (or two images) and see exactly what changed',
		icon: FileDiff,
		color: 'teal',
		isSpecial: true,
	},
	{
		id: 'url-tools',
		name: 'URL Tools',
		desc: 'Encode and decode URLs for web development',
		icon: Link,
		color: 'cyan',
		isSpecial: true,
	},
	{
		id: 'epoch-converter',
		name: 'Epoch Converter',
		desc: 'Convert Unix timestamps to readable dates and vice versa, with live epoch clock',
		icon: Clock,
		color: 'slate',
		isSpecial: true,
	},
	{
		id: 'svg-viewer',
		name: 'SVG Viewer',
		desc: 'View, edit, and export SVG files with live preview',
		icon: Eye,
		color: 'indigo',
		isSpecial: true,
	},
	{
		id: 'phone-simulator',
		name: 'Phone Simulator',
		desc: 'Preview any URL inside a realistic phone mockup, with a picker for 20+ devices',
		icon: Smartphone,
		color: 'blue',
		isSpecial: true,
	},
	// SEO Rank Tracker card is disabled: its Search Console dashboard needs the 'identity'
	// permission (chrome.identity.getAuthToken() in SearchConsoleProvider.ts), which is commented
	// out in wxt.config.js pending a Web Store privacy-practices justification (and a real
	// oauth2.client_id, still a placeholder). Re-add together.
	// {
	// 	id: 'seo-rank-tracker',
	// 	name: 'SEO Rank Tracker',
	// 	desc: 'Search Console dashboard, on-page audit, and keyword position spot-checks (free sources only)',
	// 	icon: TrendingUp,
	// 	color: 'green',
	// 	isSpecial: true,
	// },
	// Extension Ranker card is disabled: chromewebstore.google.com is on Chromium's hardcoded
	// list of restricted host patterns extensions can never get fetch/CORS access to (same list
	// as chrome.google.com/webstore/*, clients*.google.com), so lookupExtension()/
	// searchKeywordRank() in chromeExtensionRanking/chromeWebStoreClient.ts can never succeed as
	// direct extension-page fetches — see "Known limitation" in
	// packages/extension/docs/AgentLibraryFeatures/designChromeExtensionRanking.md. Re-enable
	// once a server-side proxy fetches the Web Store pages on the extension's behalf.
	// {
	// 	id: 'chrome-extension-ranker',
	// 	name: 'Extension Ranker',
	// 	desc: 'Track your Chrome extension in the Web Store: verify a listing and get keyword suggestions',
	// 	icon: Puzzle,
	// 	color: 'blue',
	// 	isSpecial: true,
	// },
	{
		id: 'color-selector',
		name: 'Color Selector',
		desc: 'Browse color palettes and copy color codes (HEX, RGB, HSL)',
		icon: Palette,
		color: 'violet',
		isSpecial: true,
	},
	{
		id: 'explorations',
		name: 'Explorations',
		desc: 'Feed my curiosity by teaching me something new every day',
		icon: Search,
		color: 'purple',
		isSpecial: false,
	},
	{
		id: 'motivation',
		name: 'Morning motivation',
		desc: 'Perk me up each morning with a motivational quote',
		icon: Zap,
		color: 'blue',
		isSpecial: false,
	},
	{
		id: 'joke',
		name: 'Joke of the day',
		desc: 'Brighten my lunch break with a new joke every day',
		icon: Laugh,
		color: 'teal',
		isSpecial: false,
	},
	{
		id: 'writing',
		name: 'Writing inspo',
		desc: 'Inspire me with a creative writing prompt every week',
		icon: PenTool,
		color: 'pink',
		isSpecial: false,
	},
	{
		id: 'history',
		name: 'On this day',
		desc: 'Tell me something interesting that happened on this date in history',
		icon: CalendarClock,
		color: 'green',
		isSpecial: false,
	},
	{
		id: 'skill-manager',
		name: 'Skill Manager',
		desc: 'Create and manage reusable LLM instruction packages that augment agent responses',
		icon: Library,
		color: 'indigo',
		isSpecial: true,
	},
]

const actionColorClasses: Record<string, string> = {
	red: 'bg-red-500/20 text-red-500 dark:bg-red-500/10 dark:text-red-400',
	purple: 'bg-purple-500/20 text-purple-500 dark:bg-purple-500/10 dark:text-purple-400',
	orange: 'bg-orange-500/20 text-orange-500 dark:bg-orange-500/10 dark:text-orange-400',
	blue: 'bg-blue-500/20 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400',
	teal: 'bg-teal-500/20 text-teal-500 dark:bg-teal-500/10 dark:text-teal-400',
	pink: 'bg-pink-500/20 text-pink-500 dark:bg-pink-500/10 dark:text-pink-400',
	green: 'bg-green-500/20 text-green-500 dark:bg-green-500/10 dark:text-green-400',
	cyan: 'bg-cyan-500/20 text-cyan-500 dark:bg-cyan-500/10 dark:text-cyan-400',
	indigo: 'bg-indigo-500/20 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400',
	violet: 'bg-violet-500/20 text-violet-500 dark:bg-violet-500/10 dark:text-violet-400',
	emerald: 'bg-emerald-500/20 text-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-400',
	amber: 'bg-amber-500/20 text-amber-500 dark:bg-amber-500/10 dark:text-amber-400',
	slate: 'bg-slate-500/20 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400',
	rose: 'bg-rose-500/20 text-rose-500 dark:bg-rose-500/10 dark:text-rose-400',
}

interface AgentLibraryProps {
	setView: (v: View) => void
	execute: (task: string) => Promise<unknown>
}

export function AgentLibrary({ setView, execute }: AgentLibraryProps) {
	const [showAll, setShowAll] = useState(true)
	/** Maps actionId → number of pending trajectories (0 means badge hidden). */
	const [pendingCounts, setPendingCounts] = useState<Map<string, number>>(() => new Map())

	// Load pending trajectory counts for each skill so the optimization badge
	// appears as soon as MIN_TRAJECTORIES_TO_OPTIMIZE failures have been recorded.
	useEffect(() => {
		const loadPendingCounts = async () => {
			try {
				const counts = new Map<string, number>()
				await Promise.all(
					skills.map(async (skill) => {
						const count = await getPendingTrajectoryCount(skill.id)
						if (count > 0) counts.set(skill.id, count)
					})
				)
				setPendingCounts(counts)
			} catch (e) {
				console.error('Failed to load pending trajectory counts', e)
			}
		}
		loadPendingCounts()
	}, [])

	// Opens a special skill — either navigates to a panel view or opens a new tab.
	// useButtonAction=true uses the button-specific tab URL (e.g. full-screen org editor).
	const launchSpecialAction = (actionId: string, useButtonAction = false) => {
		const route = SPECIAL_SKILL_ROUTES[actionId]
		if (!route) return
		const tabUrl = useButtonAction && route.buttonTabUrl ? route.buttonTabUrl : route.tabUrl
		if (tabUrl) {
			chrome.tabs.create({ url: chrome.runtime.getURL(tabUrl) })
		} else if (route.panelView) {
			setView({ name: route.panelView } as View)
		}
	}

	/**
	 * After a once_now execution completes, find the session just created for
	 * this skill run and record it as a trajectory. This is the passive-collection
	 * hook for Phase 1 of the ActionOpt integration.
	 */
	const recordActionTrajectory = async (actionId: string, taskDesc: string) => {
		try {
			const sessions = await listSessions()
			// listSessions() returns newest first; find the most recent one whose task
			// matches this skill's description (slight race tolerance: ≤ 3 sessions back)
			const match = sessions.slice(0, 3).find((s) => s.task === taskDesc)
			if (match) await recordTrajectory(match, actionId)
		} catch (e) {
			// Trajectory recording is best-effort — never surface errors to the user
			console.warn('[AgentLibrary] Failed to record trajectory', e)
		}
	}

	/**
	 * Trigger the FORGE→TRAIN optimization run for a skill.
	 * Creates a ActionOptimizationWidget instance (once_now) and refreshes the
	 * pending count badge after the widget fires.
	 */
	const handleOptimize = async (actionId: string) => {
		const skill = skills.find((s) => s.id === actionId)
		if (!skill) return
		try {
			await createWidgetInstance(ActionOptimizationWidget, { actionId })
			toast.success(`Optimizing "${skill.name}" — check back shortly for results`)
			// Clear the badge optimistically; the widget will drain pending trajectories
			setPendingCounts((prev) => {
				const next = new Map(prev)
				next.delete(actionId)
				return next
			})
		} catch (e) {
			console.error('Failed to start optimization', e)
			toast.error('Failed to start optimization')
		}
	}

	const handleRunSkill = (skillId: string) => {
		const skill = skills.find((candidate) => candidate.id === skillId)
		if (!skill) return
		execute(skill.desc)
			.then(() => recordActionTrajectory(skill.id, skill.desc))
			.catch((error) => {
				console.error('[AgentLibrary] Skill execution failed:', error)
				toast.error(error?.message ?? String(error))
			})
		toast.success(`Running: ${skill.name}`)
	}

	const handleEmotionClick = (
		event: string,
		messageId: string | number,
		message: any,
		feedback?: string
	) => {
		if (feedback) {
			toast.success(`${event} feedback submitted for skill`)
		} else {
			toast.info(`${event} recorded`)
		}
	}

	const visibleSkills = showAll ? skills : skills.slice(0, 4)

	return (
		<div className="flex flex-col h-screen bg-background">
			<Toaster />
			<header className="flex items-center justify-between border-b px-3 py-2">
				<div className="flex items-center gap-2">
					<Library className="size-5" />
					<span className="text-sm font-medium">Agent Library</span>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => setView({ name: 'chat' })}
					className="cursor-pointer"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</header>
			<main className="flex-1 overflow-y-auto p-3 space-y-4">
				<div>
					<p className="text-sm text-muted-foreground mb-4">
						Stay up to date on things you care about by putting AgentX to work within your browser.
					</p>
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-medium">Skills</span>
						<button
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
							onClick={() => setShowAll(!showAll)}
						>
							{showAll ? 'Show less' : 'Show more'}
							<ChevronDown
								className={`size-3 transition-transform ${showAll ? 'rotate-180' : ''}`}
							/>
						</button>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{visibleSkills.map((skill) => {
							const Icon = skill.icon
							const isSpecial = skill.isSpecial
							return (
								<div
									key={skill.id}
									className="bg-card border rounded-lg p-3 flex flex-col gap-2 hover:bg-muted/50 transition-colors cursor-pointer"
									onClick={
										isSpecial
											? () => {
													trackCardClick(skill.id)
													launchSpecialAction(skill.id)
												}
											: () => {
													trackCardClick(skill.id)
												handleRunSkill(skill.id)
												}
									}
								>
									<div className="flex items-start justify-between">
										<div
											className={`size-9 rounded-full flex items-center justify-center ${actionColorClasses[skill.color]}`}
										>
											<Icon className="size-4" />
										</div>
										<div className="flex items-center gap-1">
											{/* Optimization badge: amber Brain icon with failure count.
											    Appears when ≥ MIN_TRAJECTORIES_TO_OPTIMIZE failures are queued.
											    Clicking triggers the FORGE→TRAIN optimization run. */}
											{pendingCounts.has(skill.id) && (
												<Button
													size="icon-sm"
													variant="ghost"
													className="relative size-6 p-0 text-amber-500 hover:text-amber-600"
													onClick={(e) => {
														e.stopPropagation()
														handleOptimize(skill.id)
													}}
													title={`${pendingCounts.get(skill.id)} failure(s) queued — click to optimize`}
												>
													<Brain className="size-3.5" />
													<span className="absolute -top-1 -right-1 size-3 rounded-full bg-amber-500 text-[8px] text-white flex items-center justify-center leading-none">
														{pendingCounts.get(skill.id)}
													</span>
												</Button>
											)}
											<Button
												size="icon-sm"
												variant="ghost"
												className="size-6 p-0 text-muted-foreground hover:text-foreground"
												onClick={(e) => {
													e.stopPropagation()
													if (isSpecial) {
														launchSpecialAction(skill.id, true)
													} else {
														handleRunSkill(skill.id)
													}
												}}
												title={isSpecial ? 'Launch' : 'Run skill'}
											>
												{isSpecial ? (
													<ExternalLink className="size-3" />
												) : (
														<Zap className="size-3" />
												)}
											</Button>
										</div>
									</div>
									<div>
										<div className="text-sm font-medium">{skill.name}</div>
										<div className="text-xs text-muted-foreground">{skill.desc}</div>
									</div>
									<div className="mt-auto flex justify-end pt-1">
										<MessageEmotionButtons
											messageId={skill.id}
											message={skill}
											onEmotionClick={handleEmotionClick}
											isCurrentUser={false}
										/>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			</main>
		</div>
	)
}
