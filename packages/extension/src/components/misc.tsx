import type { AgentStatus } from '@page-agent/core'
import { Motion } from 'ai-motion'
import {
	ChevronDown,
	FileText,
	Globe,
	HelpCircle,
	Library,
	Mic,
	SquarePen,
	Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { TypingAnimation } from '@/components/ui/typing-animation'
import { trackEvent } from '@/lib/analytics'
import { cn } from '@/lib/utils'

import { PixelOrb } from '../entrypoints/sidepanel/components/PixelOrb'
import type { OrbState } from '../entrypoints/sidepanel/components/PixelOrb'
import { RobotFace } from '../entrypoints/sidepanel/components/RobotFace'
import type { AvatarState } from '../entrypoints/sidepanel/components/RobotFace'
import type { WidgetInstance } from '../lib/db'

// Widget status dot indicator
export function WidgetStatusDot({ status }: { status: WidgetInstance['status'] }) {
	const colorClass: Record<WidgetInstance['status'], string> = {
		idle: 'bg-muted-foreground',
		running: 'bg-blue-500',
		waiting: 'bg-yellow-500',
		scheduled: 'bg-purple-500',
		paused: 'bg-orange-500',
		failed: 'bg-red-500',
		completed: 'bg-green-500',
		cancelled: 'bg-gray-400',
	}

	const label: Record<WidgetInstance['status'], string> = {
		idle: 'Idle',
		running: 'Running',
		waiting: 'Waiting',
		scheduled: 'Scheduled',
		paused: 'Paused',
		failed: 'Failed',
		completed: 'Completed',
		cancelled: 'Cancelled',
	}

	return (
		<div className="flex items-center gap-1.5">
			<span
				className={cn(
					'size-2 rounded-full',
					colorClass[status],
					status === 'running' && 'animate-pulse'
				)}
			/>
			<span className="text-xs text-muted-foreground">{label[status]}</span>
		</div>
	)
}

// Status dot indicator
export function StatusDot({
	status,
	blockedSite,
	blockedReason,
	blockOverridden,
	onToggleBlockOverride,
}: {
	status: AgentStatus
	blockedSite?: string
	blockedReason?: string
	blockOverridden?: boolean
	onToggleBlockOverride?: () => void
}) {
	const [isDev, setIsDev] = useState(false)

	useEffect(() => {
		chrome.management
			.getSelf()
			.then((info) => {
				setIsDev(info.installType === 'development')
			})
			.catch(() => {
				// If error, assume not dev
			})
	}, [])

	const dotClass = {
		idle: 'bg-green-500',
		running: 'bg-blue-500',
		completed: 'bg-green-500',
		error: 'bg-destructive',
		blocked: 'bg-destructive',
		// 'stopped' added upstream (052a302a: agent run lifecycle rework) — a distinct
		// terminal state from a user-initiated stop(), separate from 'error'.
		stopped: 'bg-muted-foreground',
	}[status]

	const textClass = {
		idle: 'text-green-600 dark:text-green-400',
		running: 'text-red-600 dark:text-red-400',
		completed: 'text-muted-foreground',
		error: 'text-red-600 dark:text-red-400',
		blocked: 'text-red-600 dark:text-red-400',
		stopped: 'text-muted-foreground',
	}[status]

	const label = {
		idle: 'Ready',
		running: 'Running',
		completed: 'Done',
		error: 'Error',
		blocked: 'Restricted',
		stopped: 'Stopped',
	}[status]

	let title =
		status === 'blocked' && blockedSite
			? `Extension is disabled because ${blockedSite} site is a restricted site.`
			: undefined
	if (status === 'blocked' && blockedSite && isDev && blockedReason) {
		title += ` Reason: ${blockedReason}`
	}

	// Blocked: render as a clickable pill so the user can knowingly override a
	// false-positive block for this tab. The override resets on navigation
	// (handled in useAgent), so it never silently persists to another site.
	if (status === 'blocked' && onToggleBlockOverride) {
		return (
			<div className="flex items-center mr-2">
				<button
					type="button"
					onClick={onToggleBlockOverride}
					title={
						blockOverridden
							? 'Access override active for this tab. Click to re-enable the restriction.'
							: title
					}
					className={cn(
						'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
						blockOverridden
							? 'border-green-500/50 text-green-600 dark:text-green-400 hover:bg-green-500/10'
							: 'border-destructive/50 text-red-600 dark:text-red-400 hover:bg-destructive/10'
					)}
				>
					<span
						className={cn('size-2 rounded-full', blockOverridden ? 'bg-green-500' : dotClass)}
					/>
					{blockOverridden ? 'Ready' : label}
				</button>
			</div>
		)
	}

	return (
		<div className="flex items-center gap-1.5 mr-2">
			<span
				className={cn('size-2 rounded-full', dotClass, status === 'running' && 'animate-pulse')}
			/>
			<span className={cn('text-xs', textClass)} title={title}>
				{label}
			</span>
		</div>
	)
}

export function Logo({ className }: { className?: string }) {
	return (
		<img src="/assets/images/page-agent-256.webp" alt="Page Agent" className={cn('', className)} />
	)
}

// Full-screen ai-motion glow overlay, shown only while running
export function MotionOverlay({ active }: { active: boolean }) {
	const containerRef = useRef<HTMLDivElement>(null)
	const motionRef = useRef<Motion | null>(null)

	useEffect(() => {
		try {
			const mode = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
			const motion = new Motion({
				mode,
				borderWidth: 4,
				borderRadius: 14,
				glowWidth: mode === 'dark' ? 120 : 60,
				styles: { position: 'absolute', inset: '0' },
			})
			motionRef.current = motion
			containerRef.current!.appendChild(motion.element)
			motion.autoResize(containerRef.current!)
		} catch (e) {
			console.warn('[MotionOverlay] Motion unavailable:', e)
		}

		return () => {
			motionRef.current?.dispose()
			motionRef.current = null
		}
	}, [])

	useEffect(() => {
		const motion = motionRef.current
		if (!motion) return

		let disposed = false
		if (active) {
			motion.start()
			motion.fadeIn()
		} else {
			motion.fadeOut().then(() => !disposed && motion.pause())
		}
		return () => {
			disposed = true
		}
	}, [active])

	return (
		<div
			ref={containerRef}
			className="pointer-events-none absolute inset-0 z-10 opacity-60 overflow-hidden"
			style={{ display: active ? undefined : 'none' }}
		/>
	)
}

const ACTION_BUTTONS = [
	{ label: 'Knowledge Graph', icon: Zap, color: '#FFD700', viewName: 'memory' },
	{ label: 'Agent Library', icon: Library, color: '#8A2BE2', viewName: 'library' },
	{
		label: 'Summarize page',
		prompt: 'Summarize the content of the current web page.',
		icon: FileText,
		color: '#E67E22',
		execute: true,
	},
	{
		label: 'Explain something',
		prompt: 'Explain the concept of ',
		icon: HelpCircle,
		color: '#00B4D8',
	},
] as const

// Persistent action panel - shown when a task/history is present (autohides on main screen)
export function ActionPanel({
	isRunning,
	avatarState,
	orbState,
	onActionPrompt,
	onActionExecute,
	onViewChange,
	onNewChat,
}: {
	isRunning: boolean
	avatarState: AvatarState
	orbState?: OrbState
	onActionPrompt?: (prompt: string) => void
	onActionExecute?: (prompt: string) => void
	onViewChange?: (viewName: string) => void
	onNewChat?: () => void
}) {
	const [avatarOpen, setAvatarOpen] = useState(false)

	return (
		<div className="border-b">
			{/* Main row: halo icon | 4 circular action icons | new-chat button */}
			<div className="flex items-center gap-2 px-3 py-2">
				{/* Logo / spinner with halo */}
				<div className="relative flex-shrink-0 select-none pointer-events-none">
					<div className="absolute inset-0 -m-2 rounded-full bg-[conic-gradient(from_180deg,oklch(0.55_0.2_280),oklch(0.5_0.15_230),oklch(0.6_0.18_310),oklch(0.55_0.2_280))] blur-xl opacity-60 animate-[glow-a_5s_ease-in-out_infinite]" />
					<div className="absolute inset-0 -m-2 rounded-full bg-[conic-gradient(from_0deg,oklch(0.55_0.18_160),oklch(0.5_0.2_200),oklch(0.6_0.15_120),oklch(0.55_0.18_160))] blur-xl opacity-60 animate-[glow-b_5s_ease-in-out_infinite]" />
					{isRunning ? (
						<div className="relative overflow-hidden size-8">
							<img
								src="/assets/images/newage-spinner.svg"
								alt=""
								className="relative size-8 animate-spin"
							/>
							{orbState && (
								<div
									className="absolute top-1/2 left-1/2"
									style={{ transform: 'translate(-50%, -50%) scale(0.35)', pointerEvents: 'none' }}
								>
									<PixelOrb size="small" state={orbState} />
								</div>
							)}
						</div>
					) : (
						<div className="relative overflow-hidden size-8">
							<img src="/assets/images/page-agent-256.webp" alt="" className="relative size-8" />
							{orbState && (
								<div
									className="absolute top-1/2 left-1/2"
									style={{ transform: 'translate(-50%, -50%) scale(0.35)', pointerEvents: 'none' }}
								>
									<PixelOrb size="small" state={orbState} />
								</div>
							)}
						</div>
					)}
				</div>

				{/* 4 icon-only circular action buttons */}
				<div className="flex items-center gap-1.5 flex-1 justify-center">
					{ACTION_BUTTONS.map((button) => {
						const { label, icon: Icon, color } = button
						return (
							<button
								key={label}
								title={label}
								onClick={() => {
									if ('viewName' in button) {
										onViewChange?.(button.viewName)
									} else if ('execute' in button && button.execute) {
										onActionExecute?.(button.prompt)
									} else {
										onActionPrompt?.(button.prompt)
									}
								}}
								className="flex items-center justify-center size-8 rounded-full bg-muted/60 hover:bg-muted border border-border transition-colors cursor-pointer flex-shrink-0"
							>
								<Icon className="size-3.5" style={{ stroke: color }} />
							</button>
						)
					})}
				</div>

				{/* New chat */}
				<button
					onClick={onNewChat}
					className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1 rounded flex-shrink-0"
					title="New chat"
				>
					<SquarePen className="size-4" />
				</button>
			</div>

			{/* Collapsible robot avatar */}
			<button
				onClick={() => setAvatarOpen((v) => !v)}
				className="w-full flex items-center gap-1 px-3 pb-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				<ChevronDown className={cn('size-3 transition-transform', avatarOpen && 'rotate-180')} />
				<span>Avatar</span>
			</button>
			{avatarOpen && (
				<div className="flex flex-col items-center pb-3 gap-1">
					<RobotFace state={avatarState} size="compact" />
					<span className="text-[10px] text-muted-foreground capitalize">
						{avatarState.replace('-', ' ')}
					</span>
				</div>
			)}

		</div>
	)
}

// Empty state with logo and breathing glow
export function EmptyState({
	orbState = 'idle',
	onMicClick,
	onActionPrompt,
	onActionExecute,
	onViewChange,
}: {
	orbState?: OrbState
	onMicClick?: () => void
	onActionPrompt?: (prompt: string) => void
	onActionExecute?: (prompt: string) => void
	onViewChange?: (viewName: string) => void
} = {}) {
	const handleSearch = async () => {
		void trackEvent('home_action_click', { action: 'search' })
		await chrome.tabs.create({ url: 'https://www.google.com' })
	}

	const orbStatusLabel: Record<OrbState, string> = {
		idle: 'Ready',
		listening: 'Listening…',
		thinking: 'Thinking…',
		processing: 'Processing…',
		responding: 'Responding…',
	}

	return (
		<div className="flex flex-col items-center justify-center h-full text-center px-6">
			<div className="mt-0">
				<div className="relative select-none pointer-events-none">
					<div className="absolute inset-0 -m-6 rounded-full bg-[conic-gradient(from_180deg,oklch(0.55_0.2_280),oklch(0.5_0.15_230),oklch(0.6_0.18_310),oklch(0.55_0.2_280))] blur-2xl animate-[glow-a_5s_ease-in-out_infinite]" />
					<div className="absolute inset-0 -m-6 rounded-full bg-[conic-gradient(from_0deg,oklch(0.55_0.18_160),oklch(0.5_0.2_200),oklch(0.6_0.15_120),oklch(0.55_0.18_160))] blur-2xl animate-[glow-b_5s_ease-in-out_infinite]" />
					<div className="relative overflow-hidden">
						<Logo className="relative size-24 opacity-80" />
						<div
							className="absolute top-1/2 left-1/2"
							style={{ transform: 'translate(-50%, -50%) scale(0.55)', pointerEvents: 'none' }}
						>
							<PixelOrb size="small" state={orbState} />
						</div>
					</div>
				</div>
			</div>

			<div className="mt-4 flex items-center gap-2">
				<button
					onClick={() => {
						void trackEvent('home_action_click', { action: 'mic' })
						onMicClick?.()
					}}
					className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1 rounded"
					title={orbState === 'listening' ? 'Stop listening' : 'Start listening'}
				>
					<Mic className="size-4" />
				</button>
				<span className="text-sm font-medium text-muted-foreground">
					{orbStatusLabel[orbState]}
				</span>
			</div>
			<div className="mt-6 w-full">
				<p className="text-sm font-medium text-foreground mb-3">What can I help with?</p>
				<div className="grid grid-cols-2 gap-2">
					{ACTION_BUTTONS.map((button) => {
						const { label, icon: Icon, color } = button
						return (
							<button
								key={label}
								onClick={() => {
									void trackEvent('home_action_click', { action: label })
									if ('viewName' in button) {
										onViewChange?.(button.viewName)
									} else if ('execute' in button && button.execute) {
										onActionExecute?.(button.prompt)
									} else {
										onActionPrompt?.(button.prompt)
									}
								}}
								className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40 hover:bg-muted text-xs text-left transition-colors cursor-pointer"
							>
								<Icon className="size-4 flex-shrink-0" style={{ stroke: color }} />
								<span>{label}</span>
							</button>
						)
					})}
				</div>
			</div>
			<div className="mt-4 flex items-center gap-3 text-muted-foreground">
				<button
					onClick={handleSearch}
					className="hover:text-foreground transition-colors cursor-pointer"
					title="Look something up"
				>
					<Globe className="size-4" />
				</button>
			</div>
			<TypingAnimation
				className="mt-[50px] text-sm text-muted-foreground"
				words={[
					'Enter a task to automate this page',
					'Execute multi-page tasks',
					'Call this extension from your web page',
					'Use this extension in your own agents',
				]}
				cursorStyle="underscore"
				loop
				startOnView={false}
				typeSpeed={20}
				deleteSpeed={10}
				pauseDelay={3000}
			/>
		</div>
	)
}
