/**
 * Keeps entrypoints/page-agent.content.ts (built to content-scripts/page-agent.js, a
 * registration:'runtime' content script with no static `matches`) registered for whatever
 * origins the user has actually granted via optional_host_permissions — nothing is declared
 * statically in the manifest. See wxt.config.js's optional_host_permissions comment and
 * lib/hostPermissions.ts.
 */
import { browser } from 'wxt/browser'

declare const chrome: typeof browser

const BRIDGE_SCRIPT_ID = 'page-agent-bridge'
const BRIDGE_SCRIPT_FILE = '/content-scripts/page-agent.js'

async function grantedOrigins(): Promise<string[]> {
	const { origins } = await chrome.permissions.getAll()
	return origins ?? []
}

/** Re-registers the bridge for the current set of granted origins. Safe to call repeatedly. */
export async function syncPageAgentBridgeRegistration(): Promise<void> {
	const origins = await grantedOrigins()

	const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] })

	if (origins.length === 0) {
		if (existing.length > 0) {
			await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] })
		}
		return
	}

	const script = {
		id: BRIDGE_SCRIPT_ID,
		js: [BRIDGE_SCRIPT_FILE],
		matches: origins,
		runAt: 'document_end' as const,
	}

	if (existing.length > 0) {
		await chrome.scripting.updateContentScripts([script])
	} else {
		await chrome.scripting.registerContentScripts([script])
	}

	// registerContentScripts/updateContentScripts only affects future navigations — inject
	// into already-open matching tabs so a permission grant takes effect immediately.
	try {
		const tabs = await chrome.tabs.query({ url: origins })
		await Promise.all(
			tabs
				.filter((tab): tab is typeof tab & { id: number } => typeof tab.id === 'number')
				.map((tab) =>
					chrome.scripting
						.executeScript({ target: { tabId: tab.id }, files: [BRIDGE_SCRIPT_FILE] })
						.catch(() => {
							// Restricted pages (chrome://, Web Store, etc.) reject injection — expected.
						})
				)
		)
	} catch (error) {
		console.error('[pageAgentBridgeRegistration] Failed to inject into open tabs', error)
	}
}

export function watchPageAgentBridgePermissions(): void {
	chrome.permissions.onAdded.addListener(() => {
		syncPageAgentBridgeRegistration().catch((error) =>
			console.error('[pageAgentBridgeRegistration] sync after grant failed', error)
		)
	})
	chrome.permissions.onRemoved.addListener(() => {
		syncPageAgentBridgeRegistration().catch((error) =>
			console.error('[pageAgentBridgeRegistration] sync after revoke failed', error)
		)
	})
}
