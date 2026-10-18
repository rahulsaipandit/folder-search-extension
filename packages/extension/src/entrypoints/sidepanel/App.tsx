import { buildSkillTaskPrefix, detectSkill } from '@page-agent/core/skills'
import type { Skill } from '@page-agent/core/skills'
import {
	Bot,
	CornerUpLeft,
	Globe,
	HelpCircle,
	History,
	Mic,
	MicOff,
	Moon,
	Send,
	Settings,
	Square,
	Sun,
	Zap,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfigPanel } from '@/components/ConfigPanel'
import { HistoryDetail } from '@/components/HistoryDetail'
import { ActivityCard, EventCard } from '@/components/cards'
import { ActionPanel, EmptyState, Logo, MotionOverlay, StatusDot } from '@/components/misc'
import { Button } from '@/components/ui/button'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from '@/components/ui/input-group'
import { Toaster } from '@/components/ui/sonner'
import { loadSettings } from '@/shared/settings'
import { getAllSkills, getOrSeedSkills } from '@/skills/skill-store'

import { useAgent } from '../../agent/useAgent'
import { GenericTaskWidget } from '../../lib/scheduledWidgets'
import { createWidgetInstance, registerWidget } from '../../lib/widgetRuntime'
import {
	LLMProviderNotConfiguredError,
	VoiceChatIntegration,
} from '../../llm/voice-chat/integration'
import type { VoiceStatus } from '../../llm/voice-chat/integration'
import { ActiveInstancesList } from './components/ActiveInstancesList'
import { AgentDashboard } from './components/AgentDashboard'
import { AgentLibrary } from './components/AgentLibrary'
import { AttachButton } from './components/AttachButton'
import { FavoriteButton } from './components/FavoriteButton'
import { HistoryAndFavorites } from './components/HistoryAndFavorites'
import MemoryBrowser from './components/MemoryBrowser'
import type { OrbState } from './components/PixelOrb'
import type { AvatarState } from './components/RobotFace'
import { FolderSearch } from './components/FolderSearch/FolderSearch'
import { SkillChip } from './components/SkillChip'
import { SkillManagerView } from './components/SkillManager/SkillManagerView'
import { SkillPicker } from './components/SkillPicker'
import { HowDoI } from './components/howDoI/HowDoI'
import { TourOverlay } from './components/howDoI/TourOverlay'
import { buildTours } from './components/howDoI/tours'
import type { TourId } from './components/howDoI/types'
import type { View } from './types'

function voiceStatusToOrbState(s: VoiceStatus): OrbState {
	switch (s) {
		case 'listening':
			return 'listening'
		case 'thinking':
			return 'thinking'
		case 'processing':
			return 'processing'
		case 'speaking':
			return 'responding'
		default:
			return 'idle'
	}
}

export default function App() {
	// Check URL parameters for initial view
	const urlParams = new URLSearchParams(window.location.search)
	const initialView = urlParams.get('view')
	// Folder Search is the landing view; `?view=chat` opens the agent chat directly.
	const defaultView: View =
		initialView === 'dashboard'
			? { name: 'dashboard' }
			: initialView === 'chat'
				? { name: 'chat' }
				: { name: 'folder-search' }

	const [view, setView] = useState<View>(defaultView)

	const [inputValue, setInputValue] = useState('')
	const [agentQueryValue, setAgentQueryValue] = useState('')
	const historyRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const statusDotRef = useRef<HTMLDivElement>(null)

	const {
		status,
		history,
		activity,
		currentTask,
		config,
		execute,
		resume,
		callTool,
		stop,
		clear,
		configure,
		blockedSite,
		blockedReason,
		blockOverridden,
		toggleSiteBlockOverride,
		siteAccessGranted,
		requestSiteAccess,
	} = useAgent()
	const { theme, setTheme } = useTheme()

	// "How do I?" guided walkthroughs — see components/howDoI/tours.ts and
	// docs/howDoIDesign.md. The active tour renders as an overlay (below) that
	// persists across view changes a tour's own steps trigger.
	const [activeTourId, setActiveTourId] = useState<TourId | null>(null)
	// Memoized so TourOverlay's steps prop keeps a stable identity across the frequent
	// re-renders an agent run causes (history/activity updates) — otherwise its step-once
	// effect would see a "new" step on every render and re-invoke execute() repeatedly.
	const tours = useMemo(() => buildTours({ setView, execute, statusDotRef }), [setView, execute])

	const [activeSkill, setActiveSkill] = useState<Skill | null>(null)
	const [skillPickerOpen, setSkillPickerOpen] = useState(false)
	// Suggested skill from auto-detection — shown as a dismissible chip proposal.
	// Distinct from activeSkill so the user must consciously accept it before it
	// affects the task; we never silently prepend instructions.
	const [suggestedSkill, setSuggestedSkill] = useState<Skill | null>(null)
	const allSkillsRef = useRef<Skill[]>([])

	// Pre-load the skill library once so onChange detection is synchronous
	// (no async work on every keystroke). getOrSeedSkills seeds on first install
	// and reads the table in a single IDB round-trip.
	useEffect(() => {
		getOrSeedSkills()
			.then((skills) => {
				allSkillsRef.current = skills
			})
			.catch(console.error)
	}, [])

	const voiceRef = useRef<VoiceChatIntegration | null>(null)
	const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('ready')

	// Refs so voice callbacks always see the latest values without re-initialising the integration
	const executeRef = useRef(execute)
	const setInputRef = useRef(setInputValue)
	useEffect(() => {
		executeRef.current = execute
	}, [execute])
	useEffect(() => {
		setInputRef.current = setInputValue
	}, [setInputValue])

	useEffect(() => {
		const vc = new VoiceChatIntegration({
			onStatusChange: ({ status: s, message }) => {
				setVoiceStatus(s)
				// Show interim transcript in the input box while the user is speaking
				if (s === 'listening' && message.startsWith('"')) {
					const interim = message.replace(/^"|"â€¦$/g, '').trim()
					if (interim) setInputRef.current(interim)
				}
			},
			onMessage: (msg) => {
				if (msg.role === 'user') {
					// Final transcript: show it in the input then route through the agent
					setInputRef.current(msg.content)
					executeRef.current(msg.content).catch(console.error)
				}
				// Ignore assistant messages â€” the agent pipeline shows the response in history
			},
			onError: (error) => {
				if (error instanceof LLMProviderNotConfiguredError) {
					toast.error(error.message)
				} else {
					toast.error(`Voice error: ${error.message}`)
				}
			},
		})
		voiceRef.current = vc
		vc.initialize().catch(console.error)

		const handleMessage = (msg: { type?: string }) => {
			if (msg?.type === 'micPermissionGranted') {
				voiceRef.current?.startListening(true)
			}
		}
		chrome.runtime.onMessage.addListener(handleMessage)

		return () => {
			vc.stopListening()
			chrome.runtime.onMessage.removeListener(handleMessage)
		}
	}, [])

	// Continue a completed session: pre-load its history then let the user type a follow-up
	const handleContinue = useCallback(
		async (sessionId: string) => {
			await resume(sessionId)
			setView({ name: 'chat' })
		},
		[resume]
	)

	// Retry a failed session: pre-load its history then re-execute the same task
	const handleRetry = useCallback(
		async (sessionId: string) => {
			const session = await resume(sessionId)
			if (!session) return
			setView({ name: 'chat' })
			execute(session.task).catch((err) => {
				console.error('[SidePanel] Retry failed:', err)
				toast.error(err?.message ?? String(err))
			})
		},
		[resume, execute]
	)

	// Auto-scroll to bottom on new events
	useEffect(() => {
		if (historyRef.current) {
			historyRef.current.scrollTop = historyRef.current.scrollHeight
		}
	}, [history, activity])

	const handleMicClick = useCallback(async () => {
		const vc = voiceRef.current
		if (!vc) return
		if (voiceStatus === 'listening') {
			vc.stopListening()
			return
		}
		const settings = await loadSettings()
		if (settings.apiProvider === 'demo') {
			toast.error(
				'Voice chat requires OpenAI, Anthropic, or a Browser LLM. Open Settings to configure your API key.'
			)
			return
		}
		let permState = 'prompt'
		try {
			const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
			permState = perm.state
		} catch {
			/* permissions API unavailable */
		}
		if (permState === 'granted') {
			vc.startListening(true)
		} else {
			chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') })
		}
	}, [voiceStatus])

	const handleSubmit = useCallback(
		(e?: React.SyntheticEvent) => {
			e?.preventDefault()
			if (!inputValue.trim() || status === 'running') return

			let taskToExecute = inputValue.trim()
			if (activeSkill) {
				taskToExecute = buildSkillTaskPrefix(activeSkill) + taskToExecute
			}
			setInputValue('')
			// Clear any pending suggestion when the message is sent; it belongs to
			// the input that's now gone.
			setSuggestedSkill(null)

			// injectSkillContext: true marks this as a user-initiated chat submission —
			// the only path where the skill index should be injected into the system prompt.
			execute(taskToExecute, { injectSkillContext: true }).catch((error) => {
				console.error('[SidePanel] Failed to execute task:', error)
				toast.error(error?.message ?? String(error))
			})
		},
		[inputValue, status, execute, activeSkill]
	)

	const handleStop = useCallback(() => {
		console.log('[SidePanel] Stopping task...')
		stop()
	}, [stop])

	useEffect(() => {
		registerWidget(GenericTaskWidget)
	}, [])

	const handleAssignToAgent = useCallback(async () => {
		if (!agentQueryValue.trim()) return

		const taskToExecute = agentQueryValue.trim()
		setAgentQueryValue('')
		try {
			await createWidgetInstance(GenericTaskWidget, { task: taskToExecute })
		} catch (error) {
			console.error('[SidePanel] Failed to create widget instance (non-fatal):', error)
		}
		execute(taskToExecute).catch((error) => {
			console.error('[SidePanel] Agent execute failed:', error)
			toast.error(error?.message ?? String(error))
		})
		toast.success('Task assigned; agent is running.')
	}, [agentQueryValue, execute])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleSubmit()
		}
	}

	// --- View routing ---
	// Wrapped in a function (rather than returning directly from App) so the active
	// "How do I?" tour overlay, rendered below, can persist across the view changes a
	// tour's own steps trigger.
	const renderContent = () => {
		if (view.name === 'config') {
			return (
				<ConfigPanel
					config={config}
					onSave={async (newConfig) => {
						await configure(newConfig)
						setView({ name: 'chat' })
					}}
					onClose={() => setView({ name: 'chat' })}
				/>
			)
		}

		if (view.name === 'settings') {
			return (
				<ConfigPanel
					config={config}
					onSave={async (newConfig) => {
						await configure(newConfig)
						setView({ name: 'chat' })
					}}
					onClose={() => setView({ name: 'chat' })}
				/>
			)
		}

		if (view.name === 'history') {
			return (
				<HistoryAndFavorites
					onHistorySelect={(id) => setView({ name: 'history-detail', sessionId: id })}
					onFavoriteSelect={(prompt) => {
						setInputValue(prompt)
						setView({ name: 'chat' })
					}}
					onBack={() => setView({ name: 'chat' })}
				/>
			)
		}

		if (view.name === 'history-detail') {
			return (
				<HistoryDetail
					sessionId={view.sessionId}
					onBack={() => setView({ name: 'history' })}
					onContinue={handleContinue}
					onRetry={handleRetry}
				/>
			)
		}

		if (view.name === 'widgets') {
			return (
				<div className="flex flex-col h-screen bg-background">
					<Toaster />
					<header className="flex items-center justify-between border-b px-3 py-2">
						<div className="flex items-center gap-2">
							<Bot className="size-5" />
							<span className="text-sm font-medium">Agentic Widgets</span>
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
							<h3 className="text-sm font-medium mb-2">Agent Query</h3>
							<div className="border rounded-lg p-3 space-y-3">
								<p className="text-xs text-muted-foreground">
									Enter a task description to assign it to the agent.
								</p>
								<textarea
									className="w-full min-h-[80px] p-2 text-xs border rounded-md bg-background"
									placeholder="Describe what you want the agent to do..."
									value={agentQueryValue}
									onChange={(e) => setAgentQueryValue(e.target.value)}
								/>
								<div className="flex justify-end">
									<Button
										size="sm"
										className="text-xs"
										onClick={handleAssignToAgent}
										disabled={!agentQueryValue.trim()}
									>
										Assign to Agent
									</Button>
								</div>
							</div>
						</div>

						<div>
							<h3 className="text-sm font-medium mb-2">Active Instances</h3>
							<ActiveInstancesList />

							<div className="pt-4">
								<Button
									className="w-full text-xs"
									onClick={() => {
										const dashboardUrl = chrome.runtime.getURL('/sidepanel.html?view=dashboard')
										chrome.tabs.create({ url: dashboardUrl })
									}}
								>
									Open Agent Dashboard
								</Button>
							</div>
						</div>
					</main>
				</div>
			)
		}

		if (view.name === 'dashboard') {
			return <AgentDashboard onBack={() => setView({ name: 'widgets' })} />
		}

		if (view.name === 'library') {
			return <AgentLibrary setView={setView} execute={execute} />
		}

		if (view.name === 'how-do-i') {
			return (
				<HowDoI
					onBack={() => setView({ name: 'chat' })}
					onStartTour={(tourId) => setActiveTourId(tourId)}
				/>
			)
		}

		if (view.name === 'folder-search') {
			return <FolderSearch />
		}

		if (view.name === 'memory') {
			return <MemoryBrowser onBack={() => setView({ name: 'chat' })} />
		}

		if (view.name === 'skill-manager') {
			return (
				<SkillManagerView
					onBack={() => {
						// Refresh the detection snapshot when returning from the manager so
						// skills created or deleted during this session are immediately visible
						// to detectSkill() without requiring a full page reload.
						getAllSkills()
							.then((skills) => {
								allSkillsRef.current = skills
							})
							.catch(console.error)
						setView({ name: 'library' })
					}}
				/>
			)
		}

		// --- Chat view ---

		const isRunning = status === 'running'
		const showEmptyState = !currentTask && history.length === 0 && !isRunning

		// Live avatar state follows voice input and agent activity.
		const liveAvatarState: AvatarState =
			voiceStatus === 'listening'
				? 'listening'
				: voiceStatus === 'processing'
					? 'thinking'
					: voiceStatus === 'thinking'
						? 'thinking'
						: (voiceStatus as string) === 'speaking'
							? 'speaking'
							: isRunning
								? 'thinking'
								: 'off'

		return (
			<div className="relative flex flex-col h-screen bg-background">
				<Toaster />

				<MotionOverlay active={isRunning} />
				{/* Header */}
				<header className="flex items-center justify-between border-b px-3 py-2">
					<div className="flex items-center gap-2">
						<Logo className="size-5" />
						<span className="text-sm font-medium">sample-extension</span>
						{/*--This is the lower heading title --*/}
					</div>
					<div className="flex items-center gap-1">
						{!siteAccessGranted && (
							<button
								type="button"
								onClick={() => {
									void requestSiteAccess()
								}}
								title="This site hasn't been granted access to Page Agent. Click to allow it (needed for automation on this tab)."
								className="flex items-center gap-1 rounded-full border border-amber-500/50 px-2 py-0.5 text-xs text-amber-600 transition-colors hover:bg-amber-500/10 cursor-pointer dark:text-amber-400"
							>
								<Globe className="size-3" />
								Enable on this site
							</button>
						)}
						<div ref={statusDotRef}>
							<StatusDot
								status={status}
								blockedSite={blockedSite}
								blockedReason={blockedReason}
								blockOverridden={blockOverridden}
								onToggleBlockOverride={toggleSiteBlockOverride}
							/>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setView({ name: 'history' })}
							className="cursor-pointer"
							aria-label="History"
							title="History & Favorites"
						>
							<History className="size-5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setView({ name: 'widgets' })}
							className="cursor-pointer"
							title="Agent Custom Query"
						>
							<Bot className="size-5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
							className="cursor-pointer"
							title={`Toggle theme. Current: ${theme === 'dark' ? 'Dark' : 'Light'}`}
						>
							{theme === 'dark' ? <Moon className="size-5" /> : <Sun className="size-5" />}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setView({ name: 'how-do-i' })}
							className="cursor-pointer"
							title="How do I?"
						>
							<HelpCircle className="size-5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setView({ name: 'settings' })}
							className="cursor-pointer"
							title="Settings"
						>
							<Settings className="size-5" />
						</Button>
					</div>
				</header>

				{!showEmptyState && (
					<ActionPanel
						isRunning={isRunning}
						avatarState={liveAvatarState}
						orbState={voiceStatusToOrbState(voiceStatus)}
						onActionPrompt={(prompt) => {
							setInputValue(prompt)
							textareaRef.current?.focus()
						}}
						onActionExecute={(prompt) => {
							execute(prompt).catch((error) => {
								console.error('[SidePanel] Failed to execute action:', error)
								toast.error(error?.message ?? String(error))
							})
						}}
						onViewChange={(viewName) => setView({ name: viewName } as View)}
						onNewChat={clear}
					/>
				)}

				{/* Content */}
				<main className="flex-1 overflow-hidden flex flex-col">
					{/* Current task */}
					{currentTask && (
						<div className="border-b px-3 py-2 bg-muted/30">
							<div className="text-[10px] text-muted-foreground uppercase tracking-wide">Task</div>
							<div className="flex items-center gap-2">
								<div className="text-xs font-medium truncate flex-1" title={currentTask}>
									{currentTask}
								</div>
								<FavoriteButton prompt={currentTask} />
							</div>
						</div>
					)}

					{/* History */}
					<div ref={historyRef} className="flex-1 overflow-y-auto p-3 space-y-2">
						{showEmptyState && (
							<EmptyState
								orbState={voiceStatusToOrbState(voiceStatus)}
								onMicClick={handleMicClick}
								onActionPrompt={(prompt) => {
									setInputValue(prompt)
									textareaRef.current?.focus()
								}}
								onActionExecute={(prompt) => {
									execute(prompt).catch((error) => {
										console.error('[SidePanel] Failed to execute action:', error)
										toast.error(error?.message ?? String(error))
									})
								}}
								onViewChange={(viewName) => setView({ name: viewName } as View)}
							/>
						)}

						{history.map((event, index) => (
							// eslint-disable-next-line @eslint-react/no-array-index-key
							<EventCard key={index} event={event} />
						))}

						{/* Activity indicator at bottom */}
						{activity && <ActivityCard activity={activity} />}
					</div>
				</main>

				{/* Input */}
				<footer className="border-t p-3">
					{activeSkill && (
						<div className="mb-2">
							<SkillChip skill={activeSkill} onDismiss={() => setActiveSkill(null)} />
						</div>
					)}
					{/* Skill suggestion — shown only when no skill is active and detection fired.
				    Accepting moves the skill to activeSkill (same flow as manual SkillPicker
				    selection). Dismissing clears the suggestion without activating anything. */}
					{!activeSkill && suggestedSkill && (
						<div className="mb-2 flex items-center gap-1.5">
							<span className="text-[10px] text-muted-foreground">Suggested:</span>
							<SkillChip skill={suggestedSkill} onDismiss={() => setSuggestedSkill(null)} />
							<button
								type="button"
								className="text-[10px] text-primary underline cursor-pointer"
								onClick={() => {
									setActiveSkill(suggestedSkill)
									setSuggestedSkill(null)
								}}
							>
								Use
							</button>
						</div>
					)}
					<div className="flex items-center gap-2">
						<InputGroup className="relative rounded-lg flex-1">
							<div className="pl-1.5 flex items-center self-stretch flex-shrink-0 gap-0.5 relative">
								<AttachButton disabled={isRunning} />
								<button
									type="button"
									title={activeSkill ? `Skill: ${activeSkill.displayName}` : 'Pick a skill'}
									onClick={() => setSkillPickerOpen((v) => !v)}
									className={`flex items-center justify-center size-6 rounded hover:bg-muted transition-colors cursor-pointer ${activeSkill ? 'text-primary' : 'text-muted-foreground'}`}
								>
									<Zap className="size-3.5" />
								</button>
								{skillPickerOpen && (
									<SkillPicker
										activeSkillId={activeSkill?.id ?? null}
										onActivate={(skill) => {
											setActiveSkill(skill)
											// Clear any pending suggestion so it can't reappear as a
											// stale chip after the user later dismisses this active skill.
											setSuggestedSkill(null)
										}}
										onManage={() => {
											setSkillPickerOpen(false)
											setView({ name: 'skill-manager' })
										}}
										onClose={() => setSkillPickerOpen(false)}
									/>
								)}
							</div>
							<InputGroupTextarea
								ref={textareaRef}
								placeholder="Describe your task..."
								value={inputValue}
								onChange={(e) => {
									setInputValue(e.target.value)
									// Auto-detect a relevant skill as the user types and surface it as a
									// suggestion chip. We only suggest — never activate automatically —
									// so the user's intent is always explicit. Clear the suggestion when
									// a skill is already active (no need to stack suggestions on top).
									if (!activeSkill && allSkillsRef.current.length > 0) {
										setSuggestedSkill(detectSkill(e.target.value, allSkillsRef.current))
									}
								}}
								onKeyDown={handleKeyDown}
								disabled={isRunning}
								className="text-xs pr-16 min-h-10"
							/>
							<InputGroupAddon
								align="inline-end"
								className="absolute bottom-0 right-0 flex items-center"
							>
								<InputGroupButton
									size="icon-sm"
									variant="ghost"
									className="size-7 cursor-pointer"
									title={voiceStatus === 'listening' ? 'Stop listening' : 'Start voice input'}
									aria-label="Listening"
									onClick={handleMicClick}
								>
									{voiceStatus === 'listening' ? (
										<MicOff className="size-3.5 text-destructive" />
									) : (
										<Mic className="size-3.5" />
									)}
								</InputGroupButton>
								{isRunning ? (
									<InputGroupButton
										size="icon-sm"
										variant="destructive"
										onClick={handleStop}
										className="size-7"
										aria-label="Stop task"
										title="Stop task"
									>
										<Square className="size-3" />
									</InputGroupButton>
								) : (
									<InputGroupButton
										size="icon-sm"
										variant="default"
										onClick={() => handleSubmit()}
										disabled={!inputValue.trim()}
										className="size-7 cursor-pointer"
										aria-label="Send"
										title="Send"
									>
										<Send className="size-3" />
									</InputGroupButton>
								)}
							</InputGroupAddon>
						</InputGroup>
					</div>
				</footer>
			</div>
		)
	}

	return (
		<>
			{renderContent()}
			{activeTourId && (
				<TourOverlay steps={tours[activeTourId]} onClose={() => setActiveTourId(null)} />
			)}
		</>
	)
}
