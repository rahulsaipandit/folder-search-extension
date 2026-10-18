/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
} from '@page-agent/core'
import { buildSkillIndexBlock } from '@page-agent/core/skills'
import type { LLMConfig } from '@page-agent/llms'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ensureBroadHostAccess, hasHostAccessFor, requestHostAccessFor } from '@/lib/hostPermissions'

//RP_DONE:
import { globalActionExecutionEngine } from '../actions'
//RP_DONE:

import {
	type SessionRecord,
	cleanupStaleSessions,
	createSession,
	finalizeSession,
	getSession,
	updateSession,
} from '../lib/db'
import { loadSettings } from '../shared/settings'
//RP_DONE:
import { getOrSeedSkills } from '../skills/skill-store'
import { MultiPageAgent } from './MultiPageAgent'
import { DEMO_CONFIG, migrateLegacyEndpoint } from './constants'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	maxSteps?: number
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	disableNamedToolChoice?: boolean
	enableWebsiteIntegration?: boolean
}

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	config: ExtConfig | null
	execute: (task: string, opts?: { injectSkillContext?: boolean }) => Promise<ExecutionResult>
	resume: (sessionId: string) => Promise<SessionRecord | null> //RP_DONE:
	stop: () => Promise<void>
	clear: () => Promise<void> //RP_DONE:
	configure: (config: ExtConfig) => Promise<void>
	/** Directly invoke a registered tool on the current agent instance, bypassing the LLM loop. */
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>
	activeWidgetCount: number //RP_DONE:
	isSiteBlocked: boolean //RP_DONE:
	blockedSite: string //RP_DONE:
	blockedReason: string //RP_DONE:
	blockOverridden: boolean
	toggleSiteBlockOverride: () => void
	/** False when the current tab's site hasn't been granted host access yet — distinct from
	 * isSiteBlocked, which only applies once access is granted and the policy engine evaluates
	 * the page. No standing host_permissions means this is the default for most sites. */
	siteAccessGranted: boolean
	/** Requests optional_host_permissions for the current tab's origin. Must be called
	 * directly from a click handler (user gesture) — see lib/hostPermissions.ts. */
	requestSiteAccess: () => Promise<void>
}

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageAgent | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const [activeWidgetCount, setActiveWidgetCount] = useState(0) //RP_DONE:
	const [isSiteBlocked, setIsSiteBlocked] = useState(false) //RP_DONE:
	const [blockedSite, setBlockedSite] = useState<string>('') //RP_DONE:
	const [blockedReason, setBlockedReason] = useState<string>('') //RP_DONE:
	// User-initiated bypass for the current tab's block, reset whenever the
	// checked hostname changes so it never silently carries over to another site.
	const [blockOverridden, setBlockOverridden] = useState(false)
	const blockOverrideHostRef = useRef<string | null>(null)
	// Default true so nothing flashes before the first check resolves.
	const [siteAccessGranted, setSiteAccessGranted] = useState(true)
	const currentTabUrlRef = useRef<string>('')
	const checkAccessRef = useRef<() => Promise<void>>(async () => {})

	//RP_DONE: Session tracking
	const currentSessionIdRef = useRef<string | null>(null) //RP_DONE:
	// History to pre-load when the next execute() is called (set by resume()) //RP_DONE:
	const pendingInitialHistoryRef = useRef<HistoricalEvent[] | null>(null) //RP_DONE:

	useEffect(() => {
		Promise.all([
			chrome.storage.local.get(['llmConfig', 'language', 'advancedConfig']),
			loadSettings(),
		]).then(([result, settings]) => {
			let llmConfig = (result.llmConfig as LLMConfig) ?? DEMO_CONFIG
			const language = (result.language as SupportedLanguage) || undefined
			const advancedConfig = (result.advancedConfig as AdvancedConfig) ?? {}

			// Auto-migrate a stale demo baseURL (legacy hardcoded endpoints, or any cached
			// demo config left behind by an older build's DEMO_BASE_URL) to the live one,
			// unless the user explicitly customized it in Settings.
			const migrated = migrateLegacyEndpoint(llmConfig, settings.demoBaseURLCustomized)
			if (migrated !== llmConfig) {
				llmConfig = migrated
				chrome.storage.local.set({ llmConfig: migrated })
			} else if (!result.llmConfig) {
				chrome.storage.local.set({ llmConfig: DEMO_CONFIG })
			}

			setConfig({ ...llmConfig, ...advancedConfig, language })
		})
	}, [])

	//RP_DONE: On startup: finalize any sessions left in_progress from a previous crash
	useEffect(() => {
		chrome.storage.local.get(['isAgentRunning'], (result) => {
			if (!result.isAgentRunning) {
				cleanupStaleSessions().catch(console.error)
			}
		})
	}, [])

	//RP_DONE: Check if current tab is blocked. Re-runs on tab switch/navigation
	// so the panel never shows a stale verdict from a previously active tab.
	useEffect(() => {
		const checkAccess = async () => {
			try {
				const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
				if (tab?.id) {
					const url = tab.url || ''
					currentTabUrlRef.current = url
					if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
						// Allow chrome:// pages (newtab) and extension pages (sidepanel tabs, flow pages)
						setIsSiteBlocked(false)
						setSiteAccessGranted(true)
						return
					}
					const hostname = new URL(url).hostname
					// A previous override only applies to the host it was granted for.
					if (blockOverrideHostRef.current !== hostname) {
						blockOverrideHostRef.current = hostname
						setBlockOverridden(false)
					}

					// No standing host_permissions — most sites have no granted access by design.
					// That's not the same as "blocked by policy": only run the real policy check
					// (which needs the content script, only present on granted origins) once
					// access has actually been granted; otherwise just surface the "not granted"
					// state so the UI can offer to request it, instead of misreporting "blocked".
					if (!(await hasHostAccessFor(url))) {
						setSiteAccessGranted(false)
						setIsSiteBlocked(false)
						return
					}
					setSiteAccessGranted(true)

					chrome.tabs.sendMessage(tab.id, { type: 'CHECK_ACCESS' }, (response) => {
						if (chrome.runtime.lastError) {
							// Content script not loaded or error, assume blocked
							setIsSiteBlocked(true)
							setBlockedSite(hostname)
							return
						}
						const blocked = response?.access === 'blocked'
						setIsSiteBlocked(blocked)
						if (blocked) {
							setBlockedSite(hostname)
							setBlockedReason(response?.reason || 'Unknown')
						}
					})
				}
			} catch (error) {
				setIsSiteBlocked(true)
				setBlockedSite('')
			}
		}

		checkAccessRef.current = checkAccess
		checkAccess()

		const handleTabActivated = () => checkAccess()
		const handleTabUpdated = (
			_tabId: number,
			changeInfo: chrome.tabs.OnUpdatedInfo,
			tab: chrome.tabs.Tab
		) => {
			if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
				checkAccess()
			}
		}

		chrome.tabs.onActivated.addListener(handleTabActivated)
		chrome.tabs.onUpdated.addListener(handleTabUpdated)

		return () => {
			chrome.tabs.onActivated.removeListener(handleTabActivated)
			chrome.tabs.onUpdated.removeListener(handleTabUpdated)
		}
	}, [])

	useEffect(() => {
		if (!config) return

		const { systemInstruction, ...agentConfig } = config
		console.log('[Ext] Creating MultiPageAgent with config:', {
			disableNamedToolChoice: (agentConfig as any).disableNamedToolChoice,
			provider: (agentConfig as any).provider,
			baseURL: (agentConfig as any).baseURL,
			model: (agentConfig as any).model,
		}) //RP_DONE:

		const agent = new MultiPageAgent({
			...agentConfig,
			instructions: systemInstruction ? { system: systemInstruction } : undefined,
		})
		agentRef.current = agent

		const handleStatusChange = (_e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			// Clear stale activity on any non-running status, including the 'stopped' state
			// introduced by the core lifecycle rework (status now decouples from task outcome).
			if (newStatus !== 'running') {
				setActivity(null)
			}
			// Finalize session when execution ends (including a user-initiated stop)
			if (
				(newStatus === 'completed' || newStatus === 'error' || newStatus === 'stopped') &&
				currentSessionIdRef.current
			) {
				const sessionId = currentSessionIdRef.current
				currentSessionIdRef.current = null
				// Write the final history snapshot before finalizing - guards against the
				// race where statuschange fires before the last historychange, which would
				// leave the done-step result out of IndexedDB.
				updateSession(sessionId, [...agent.history])
					.then(() => finalizeSession(sessionId, newStatus))
					.catch(console.error)
			} //RP_DONE:
		}

		const handleHistoryChange = (_e: Event) => {
			const newHistory = [...agent.history]
			setHistory(newHistory)
			// Incrementally persist after every step
			if (currentSessionIdRef.current) {
				updateSession(currentSessionIdRef.current, newHistory).catch(console.error)
			} //RP_DONE:
		}

		const handleActivity = (e: Event) => {
			const newActivity = (e as CustomEvent).detail as AgentActivity
			setActivity(newActivity)
		}

		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		return () => {
			agent.removeEventListener('statuschange', handleStatusChange)
			agent.removeEventListener('historychange', handleHistoryChange)
			agent.removeEventListener('activity', handleActivity)
			agent.dispose()
		}
	}, [config])

	//RP_DONE: Track background widget status for unified indicator
	useEffect(() => {
		const activeWidgetSet = new Set<string>()

		const handleWidgetMessage = (message: any) => {
			if (!message.type || !message.type.startsWith('widget:')) return
			if (!message.instanceId) return

			const eventType = message.type.split(':')[1]

			if (eventType === 'started') {
				activeWidgetSet.add(message.instanceId)
			} else if (['completed', 'paused', 'error'].includes(eventType)) {
				activeWidgetSet.delete(message.instanceId)
			}

			setActiveWidgetCount(activeWidgetSet.size)
		}

		chrome.runtime.onMessage.addListener(handleWidgetMessage)

		// Initial count sync on mount
		chrome.storage.local.get(['activeWidgets'], (result: { activeWidgets?: number }) => {
			setActiveWidgetCount(result.activeWidgets || 0)
		})

		return () => {
			chrome.runtime.onMessage.removeListener(handleWidgetMessage)
		}
	}, [])

	//RP_DONE:  Unified status aggregation logic
	const effectiveStatus = useMemo<AgentStatus>(() => {
		// Priority 1: Site is blocked
		if (isSiteBlocked) return 'blocked'

		// Priority 2: Interactive agent is running - always show this first
		if (status === 'running') return 'running'

		// Priority 3: Any background widgets are active
		if (activeWidgetCount > 0) return 'running'

		// Otherwise return native agent status
		return status
	}, [status, activeWidgetCount, isSiteBlocked])

	// User-initiated toggle between the "Restricted" and "Ready" states for the
	// current tab. Does not touch the underlying policy engine or its lists -
	// it only suppresses the blocked verdict in the UI for this tab until the
	// user navigates elsewhere (handled by the hostname-change reset above).
	const toggleSiteBlockOverride = useCallback(() => {
		setBlockOverridden((prev) => !prev)
	}, [])

	// Must be invoked directly from a click handler — chrome.permissions.request() only
	// succeeds synchronously within a user gesture (see lib/hostPermissions.ts).
	const requestSiteAccess = useCallback(async () => {
		const url = currentTabUrlRef.current
		if (!url) return
		const granted = await requestHostAccessFor(url)
		if (granted) await checkAccessRef.current()
	}, [])

	// injectSkillContext: pass true only from user-initiated chat submissions. Widget
	// triggers, retries, and voice paths share this hook but were never designed to
	// receive skill context — unconditional injection wastes IDB round-trips and adds
	// catalog text to prompts that don't interpret it.
	const execute = useCallback(
		async (task: string, { injectSkillContext = false }: { injectSkillContext?: boolean } = {}) => {
			const agent = agentRef.current
			console.log('🚀 [useAgent] start executing task:', task) // RP_DONE:
			if (!agent) throw new Error('Agent not initialized')

			// Must run before any other `await` in this handler — chrome.permissions.request()
			// only succeeds synchronously within the user gesture that triggered execute().
			// Multi-tab automation needs this; single-tab tasks work fine on activeTab alone
			// if the user declines, so a `false` result here is not fatal.
			void ensureBroadHostAccess()

			const initialHistory = pendingInitialHistoryRef.current ?? undefined // RP_DONE:
			pendingInitialHistoryRef.current = null

			// Reset UI history only when starting fresh (not continuing from a session)
			if (!initialHistory) {
				setHistory([])
			}

			// Create a new session immediately so it appears in history while running
			const session = await createSession(task)
			currentSessionIdRef.current = session.id // RP_DONE:

			setCurrentTask(task)
			try {
				// RP_DONE:
				// actionInvoker is spread from a variable to avoid the excess-property
				// check against the compiled core type, which may lag behind the source.
				const actionOpts = { actionInvoker: globalActionExecutionEngine }

				// Build the skill index addon only for user-initiated chat submissions.
				// getOrSeedSkills() seeds defaults on first install and reads the table in
				// one IDB round-trip (vs. the prior seedDefaultSkills() + getAllSkills()
				// double-scan). Empty string from buildSkillIndexBlock means no skills
				// exist yet, so we omit the addon rather than appending a blank block.
				let skillsAddon: string | undefined
				if (injectSkillContext) {
					const skills = await getOrSeedSkills()
					const block = buildSkillIndexBlock(skills)
					if (block) skillsAddon = block
				}

				return await agent.execute(task, {
					...(initialHistory ? { initialHistory } : {}),
					...actionOpts,
					...(skillsAddon ? { systemPromptAddons: [skillsAddon] } : {}),
				})
			} catch (error) {
				// agent.execute() threw before emitting any events (e.g. onBeforeTask failed).
				// The agent status was never updated, so force it here.
				setStatus('error')
				setActivity(null)
				if (currentSessionIdRef.current) {
					finalizeSession(currentSessionIdRef.current, 'error').catch(console.error)
					currentSessionIdRef.current = null
				}
				throw error
			}
		},
		[]
	) // RP_DONE:

	/**
	 * RP_DONE: Pre-load a previous session's history as context for the next execute() call.
	 * For "Continue": call resume(), then the user types a follow-up and calls execute().
	 * For "Retry": call resume(), then immediately call execute(session.task).
	 */
	const resume = useCallback(async (sessionId: string): Promise<SessionRecord | null> => {
		const session = await getSession(sessionId)
		if (!session) return null

		// Stage the history so execute() picks it up as initialHistory
		pendingInitialHistoryRef.current = session.history

		// Pre-populate the UI so the user sees the prior conversation immediately
		setHistory([...session.history])
		setCurrentTask(session.task)

		return session
	}, [])

	// Deterministic tool invocation for one-off automation flows (autofill, job search,
	// login) that need to drive the active tab without going through the LLM loop.
	// Reads agentRef.current at call time (not captured at render) so callers always
	// get the live agent instance, same pattern as stop()/clear() below.
	const callTool = useCallback(
		async (name: string, args: Record<string, unknown>): Promise<string> => {
			const agent = agentRef.current
			if (!agent) throw new Error('Agent not initialized')
			// execute() binds TabsController to the active tab via onBeforeTask(); callTool()
			// bypasses execute() entirely, so without this the agent has no target tab.
			await agent.ensureTabBinding()
			return agent.callTool(name, args)
		},
		[]
	)

	const stop = useCallback(async () => {
		await agentRef.current?.stop()
	}, [])
	//RP_DONE:
	// Await the agent's abort settling (PageAgentCore.stop() is async since the
	// upstream lifecycle rework) before resetting local state. Otherwise the
	// abort's own historychange/statuschange events (a "Task aborted" entry,
	// status -> 'stopped') land after our reset and silently repopulate the
	// just-cleared chat - see handleHistoryChange/handleStatusChange above.
	const clear = useCallback(async () => {
		await agentRef.current?.stop()
		setHistory([])
		setCurrentTask('')
		setStatus('idle')
		setActivity(null)
		currentSessionIdRef.current = null
	}, [])

	const configure = useCallback(
		async ({
			language,
			maxSteps,
			systemInstruction,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			disableNamedToolChoice,
			...llmConfig
		}: ExtConfig) => {
			await chrome.storage.local.set({ llmConfig })
			if (language) {
				await chrome.storage.local.set({ language })
			} else {
				await chrome.storage.local.remove('language')
			}
			const advancedConfig: AdvancedConfig = {
				maxSteps,
				systemInstruction,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			}
			await chrome.storage.local.set({ advancedConfig })
			setConfig({ ...llmConfig, ...advancedConfig, language })
		},
		[]
	)

	return {
		status: effectiveStatus, //RP_DONE:
		history,
		activity,
		currentTask,
		config,
		execute,
		resume, //RP_DONE:
		callTool,
		stop,
		clear, //RP_DONE:
		configure,
		activeWidgetCount, //RP_DONE:
		isSiteBlocked, //RP_DONE:
		blockedSite, //RP_DONE:
		blockedReason, //RP_DONE:
		blockOverridden,
		toggleSiteBlockOverride,
		siteAccessGranted,
		requestSiteAccess,
	}
}
