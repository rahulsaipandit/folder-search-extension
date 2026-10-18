/**
 * Runtime host-access helpers. The extension declares no standing host_permissions —
 * page access comes from `activeTab` (the tab the user just invoked the extension on)
 * plus `optional_host_permissions`, granted at runtime via chrome.permissions.request().
 *
 * chrome.permissions.request() only succeeds when called synchronously within a user
 * gesture (e.g. a button's onClick), so callers must invoke ensureBroadHostAccess()
 * as early as possible in a click handler, before any other `await`.
 */
import { browser } from 'wxt/browser'

declare const chrome: typeof browser

const BROAD_ORIGIN = '<all_urls>'

export async function hasBroadHostAccess(): Promise<boolean> {
	try {
		return await chrome.permissions.contains({ origins: [BROAD_ORIGIN] })
	} catch (error) {
		console.error('[hostPermissions] contains() failed', error)
		return false
	}
}

/**
 * Requests standing access to all sites, needed for multi-tab automation (acting on tabs
 * the user never explicitly invoked the extension on). Must be called synchronously from
 * a user gesture — see module doc comment. Returns false (without throwing) if the user
 * declines; callers should still let single-tab automation proceed on activeTab alone.
 */
export async function ensureBroadHostAccess(): Promise<boolean> {
	if (await hasBroadHostAccess()) return true
	try {
		return await chrome.permissions.request({ origins: [BROAD_ORIGIN] })
	} catch (error) {
		console.error('[hostPermissions] request() failed', error)
		return false
	}
}

/** Origin match pattern (`https://example.com/*`) for a single site's one-time grant flow. */
export function originPatternForUrl(url: string): string | null {
	try {
		const { protocol, host } = new URL(url)
		if (protocol !== 'http:' && protocol !== 'https:') return null
		return `${protocol}//${host}/*`
	} catch {
		return null
	}
}

export async function hasHostAccessFor(url: string): Promise<boolean> {
	const pattern = originPatternForUrl(url)
	if (!pattern) return false
	try {
		return await chrome.permissions.contains({ origins: [pattern] })
	} catch (error) {
		console.error('[hostPermissions] contains() failed', error)
		return false
	}
}

/** Same user-gesture constraint as ensureBroadHostAccess() applies here. */
export async function requestHostAccessFor(url: string): Promise<boolean> {
	const pattern = originPatternForUrl(url)
	if (!pattern) return false
	try {
		return await chrome.permissions.request({ origins: [pattern] })
	} catch (error) {
		console.error('[hostPermissions] request() failed', error)
		return false
	}
}
