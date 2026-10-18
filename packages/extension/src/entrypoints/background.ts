import type { IBrainEngine } from '@page-agent/memory'
import { browser } from 'wxt/browser'

import { registerBuiltInActions } from '@/actions'
import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage } from '@/agent/TabsController.background'
import {
	syncPageAgentBridgeRegistration,
	watchPageAgentBridgePermissions,
} from '@/lib/pageAgentBridgeRegistration'
import { setupVaultFlushAlarm } from '@/lib/vaultFlushQueue'
import {
	runStartupRecovery,
	startWidgetScheduler,
} from '@/lib/widgetScheduler'
import { SmritiOrchestrator } from '@/memory/orchestrator'
import { loadSettings, saveSettings } from '@/shared/settings'

declare const chrome: typeof browser

declare global {
	// Typed as IBrainEngine so any platform-generic code can hold a reference
	// without importing the extension-specific SmritiOrchestrator class.
	var __smritiMemory: IBrainEngine & SmritiOrchestrator
}

// Google Forms link shown after the user uninstalls the extension.
const UNINSTALL_FEEDBACK_URL = 'https://forms.gle/ikPNQieKgTf7zw4y9'

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	// Re-set on every SW startup, not just onInstalled — setUninstallURL isn't guaranteed
	// to persist across all Chrome versions/updates, and it's cheap to call idempotently.
	chrome.runtime
		.setUninstallURL(UNINSTALL_FEEDBACK_URL)
		.catch((err: unknown) => console.error('[Background] setUninstallURL failed:', err))
	// Note: tab-state used to be pushed to extension pages via a long-lived port
	// (setupTabEventsPort). Upstream's stateless-SW refactor removed that — the
	// service worker holds no in-memory tab state anymore, and callers (sidepanel,
	// hub) instead pull current tab state on demand via handleTabControlMessage
	// (TAB_CONTROL messages), which survives SW restarts without special handling.

	// Start: Extension Scan Blocker
	const tabBlockCounts = new Map<number, number>()
	chrome.action.setBadgeBackgroundColor({ color: '#dc2626' })
	chrome.tabs.onRemoved.addListener((tabId) => {
		tabBlockCounts.delete(tabId)
	})
	// End: Extension Scan Blocker

	// generate user auth token

	chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
		if (result.PageAgentExtUserAuthToken) return

		const userAuthToken = crypto.randomUUID()
		chrome.storage.local.set({ PageAgentExtUserAuthToken: userAuthToken })
	})

	// message proxy - registered synchronously so the first TAB_CONTROL message
	// after the SW wakes up is handled before async startup completes
	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender as chrome.runtime.MessageSender, sendResponse)
		} else if (message.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender as chrome.runtime.MessageSender, sendResponse)
		} else if (message.type === 'GET_WIDGETS') {
			sendResponse({ widgets: [] })
			return
		} else if (message.type === 'EXTENSION_PROBE_BLOCKED') {
			const tabId = sender.tab?.id
			if (tabId) {
				const current = tabBlockCounts.get(tabId) || 0

				// Rate limit: max 1000 events per tab per session
				if (current >= 1000) {
					sendResponse({ success: false, throttled: true })
					return
				}

				const newCount = current + 1
				tabBlockCounts.set(tabId, newCount)

				// Throttle badge updates (max 1 per 5 events)
				if (newCount % 5 === 0 || newCount === 1) {
					chrome.action.setBadgeText({
						tabId: tabId,
						text: newCount > 999 ? '999+' : String(newCount),
					})
				}
			}
			sendResponse({ success: true })
			return
		} else if (message.action === 'getGraphData') {
			// Return graph nodes and edges for knowledge graph visualization
			const memory = globalThis.__smritiMemory
			if (!memory) {
				sendResponse({ error: 'Memory system not initialized' })
				return
			}

			Promise.all([memory.graph.getAllNodes(), memory.graph.getAllEdges(), memory.stats()])
				.then(([nodes, edges, stats]) => {
					sendResponse({ nodes, edges, stats })
				})
				.catch((err) => sendResponse({ error: String(err) }))
			return true
		} else if (message.action === 'getSettings') {
			loadSettings()
				.then((settings) => sendResponse({ settings }))
				.catch((err) => sendResponse({ error: String(err) }))
			return true
		} else if (message.action === 'saveSettings') {
			saveSettings(message.settings)
				.then(() => sendResponse({ success: true }))
				.catch((err) => sendResponse({ error: String(err) }))
			return true

		} else if (message.action) {
			// Legacy action-based messages not yet individually handled.
			sendResponse({ error: 'handler_not_yet_migrated', action: message.action })
			return
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})

	// external messages (from localhost launcher page via externally_connectable)

	chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
		if (message.type === 'OPEN_HUB') {
			openOrFocusHubTab(message.wsPort).then(() => {
				if (sender.tab?.id) chrome.tabs.remove(sender.tab.id)
				sendResponse({ ok: true })
			})
			return true
		}
	})

	// setup

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

	// page-agent-bridge has no standing host_permissions (activeTab + optional_host_permissions
	// only) — keep its registration in sync with whatever the user has actually granted.
	watchPageAgentBridgePermissions()
	syncPageAgentBridgeRegistration().catch((err: unknown) =>
		console.error('[Background] initial bridge registration failed:', err)
	)

	// async startup - runs after listeners are already registered
	registerBuiltInActions()
	runStartupRecovery().then((recoveredWidgets) => {
		console.log('[Background] Recovered', recoveredWidgets, 'widgets')
		startWidgetScheduler()
	})

	const memory = new SmritiOrchestrator({
		workingMemoryBudget: { maxItems: 7 },
		enableSemanticSearch: true,
		vectorIndexSyncIntervalMs: 5 * 60 * 1000,
	})
	globalThis.__smritiMemory = memory

	chrome.runtime.onSuspend.addListener(() => {
		globalThis.__smritiMemory?.close().catch(() => {})
	})

	setTimeout(() => memory.syncVectorIndex().catch(() => {}), 5000)

	// Vault artifact flush queue — syncs pending T1 artifacts every 5 min
	setupVaultFlushAlarm()
})

async function openOrFocusHubTab(wsPort: number) {
	const hubUrl = chrome.runtime.getURL('/hub.html')
	const existing = await chrome.tabs.query({ url: `${hubUrl}*` })

	if (existing.length > 0 && existing[0].id) {
		await chrome.tabs.update(existing[0].id, {
			active: true,
			url: `${hubUrl}?ws=${wsPort}`,
		})
		return
	}

	await chrome.tabs.create({ url: `${hubUrl}?ws=${wsPort}`, pinned: true })
}

