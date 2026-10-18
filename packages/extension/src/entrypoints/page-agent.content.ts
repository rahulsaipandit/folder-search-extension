/**
 * `registration: 'runtime'` + no `matches` means this content script is NOT added to the
 * manifest's `content_scripts` or `host_permissions` — WXT only auto-injects/adds permissions
 * for scripts it registers itself (see manifest.mjs: contentScripts filtered by
 * `registration !== 'runtime'`, and matches?.forEach(addHostPermission) which is a no-op when
 * matches is empty/undefined). Injection is entirely manual, driven by whatever origins the
 * user has actually granted via optional_host_permissions — see
 * lib/pageAgentBridgeRegistration.ts (called from entrypoints/background.ts), which calls
 * chrome.scripting.registerContentScripts()/executeScript() with this bundle
 * (content-scripts/page-agent.js) for those origins only.
 *
 * This used to be a manifest content script matching <all_urls>. Moving it here removes the
 * standing host_permissions that Chrome Web Store review (and Enhanced Safe Browsing's
 * behavioral trust model) flags.
 */
import { browser } from 'wxt/browser'

import {
	DEFAULT_ALLOWLIST,
	DEFAULT_DENYLIST,
	KeywordPlugin,
	PasswordFieldPlugin,
	PolicyEngine,
	// LoginFormPlugin,
	SensitiveFieldPlugin,
	buildSnapshot,
} from '@/accessListControl'
import { initPageController } from '@/agent/RemotePageController.content'

declare const chrome: typeof browser

const DEBUG_PREFIX = '[Content]'

// Fork: initialize access control policy engine (see accessListControl/ for the evaluation pipeline)
const policyEngine = new PolicyEngine(
	{ denylist: DEFAULT_DENYLIST, allowlist: DEFAULT_ALLOWLIST },
	[
		new PasswordFieldPlugin(),
		// new LoginFormPlugin(),
		new SensitiveFieldPlugin(),
		new KeywordPlugin(),
	],
	{ requireUserGesture: false } // TODO: make configurable
)

export default defineContentScript({
	registration: 'runtime',
	runAt: 'document_end',
	main,
})

function main() {
	console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
	initPageController()

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message.type === 'CHECK_ACCESS') {
			const url = window.location.href
			const host = new URL(url).hostname
			const snapshot = buildSnapshot()
			const result = policyEngine.evaluate({ url, host, dom: snapshot })
			sendResponse({
				access: result.decision === 'ALLOW' ? 'allowed' : 'blocked',
				reason: result.reason,
			})
			return true
		}
		if (message.type !== 'PAGE_HTML') return false
		sendResponse({ html: document.documentElement.outerHTML, url: window.location.href })
		return true
	})

	// Start: Extension Scan Blocker Bridge
	window.addEventListener(
		'message',
		(event) => {
			// Security validation
			if (event.source !== window) return
			if (event.origin !== window.location.origin) return
			if (!event.isTrusted) return

			if (event.data?.type !== '__pageAgentBlock') return

			// Explicit whitelist only safe properties - never spread untrusted payload
			chrome.runtime.sendMessage({
				type: 'EXTENSION_PROBE_BLOCKED',
				payload: {
					timestamp: typeof event.data.timestamp === 'number' ? event.data.timestamp : Date.now(),
					url: typeof event.data.url === 'string' ? event.data.url.slice(0, 2048) : '',
					api: typeof event.data.api === 'string' ? event.data.api.slice(0, 32) : '',
				},
			})
		},
		false
	)
	// End: Extension Scan Blocker Bridge

	// if auth token matches, expose agent to page
	chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
		// extension side token.
		// @note this is isolated world. it is safe to assume user script cannot access it
		const extToken = result.PageAgentExtUserAuthToken
		if (!extToken) return

		// page side token
		const pageToken = localStorage.getItem('PageAgentExtUserAuthToken')
		if (!pageToken) return

		if (pageToken !== extToken) return

		// Fork: check access control policy before exposing the agent to the page
		const url = window.location.href
		const host = new URL(url).hostname
		const snapshot = buildSnapshot()
		const decision = policyEngine.evaluate({ url, host, dom: snapshot })
		if (decision.decision === 'BLOCK') {
			console.log('[PageAgentExt]: Access blocked by policy for', url)
			return
		}

		console.log('[PageAgentExt]: Auth tokens match. Exposing agent to page.')

		void exposeAgentToPage()
	})
}

async function exposeAgentToPage() {
	const { MultiPageAgent } = await import('@/agent/MultiPageAgent')
	console.log('[PageAgentExt]: MultiPageAgent loaded')

	/**
	 * singleton MultiPageAgent to handle requests from the page
	 */
	let multiPageAgent: InstanceType<typeof MultiPageAgent> | null = null

	window.addEventListener('message', async (e) => {
		if (e.source !== window) return

		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_AGENT_EXT_REQUEST') return

		const { action, payload, id } = data

		switch (action) {
			case 'execute': {
				// singleton check
				if (multiPageAgent && multiPageAgent.status === 'running') {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: 'Agent is already running a task. Please wait until it finishes.',
						},
						'*'
					)
					return
				}

				try {
					const { task, config } = payload
					const { systemInstruction, ...agentConfig } = config

					// Dispose old instance before creating new one
					multiPageAgent?.dispose()

					multiPageAgent = new MultiPageAgent({
						...agentConfig,
						instructions: systemInstruction ? { system: systemInstruction } : undefined,
					})

					// events

					multiPageAgent.addEventListener('statuschange', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'status_change_event',
								payload: multiPageAgent.status,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('activity', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'activity_event',
								payload: (event as CustomEvent).detail,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('historychange', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'history_change_event',
								payload: multiPageAgent.history,
							},
							'*'
						)
					})

					// result

					const result = await multiPageAgent.execute(task)

					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							payload: result,
						},
						'*'
					)
				} catch (error) {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: (error as Error).message,
						},
						'*'
					)
				}

				break
			}

			case 'stop': {
				multiPageAgent?.stop()
				break
			}

			default:
				console.warn(`${DEBUG_PREFIX} Unknown action from page:`, action)
				break
		}
	})
}
