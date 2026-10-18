/**
 * Fallback for sites whose own frame-ancestors/X-Frame-Options header refuses the mockup's
 * iframe (e.g. CNN, most banks, Google/Meta properties — see PhoneBezel.tsx's blocked-site
 * detection). frame-ancestors/X-Frame-Options only restrict *sub-frame* embedding, never a
 * top-level tab navigation, so resizing the real tab's viewport via the DevTools Protocol
 * Emulation domain works on any site — at the cost of losing the fixed-size scrollable bezel,
 * since this reflows the actual tab (see the CDP-vs-iframe trade-off in git history for why the
 * primary mockup moved away from this approach).
 *
 * chrome.debugger is usable from any extension context with the permission, not just the
 * background service worker, so this runs directly in the Phone Simulator tab page — no
 * message-passing required.
 */
import { browser } from 'wxt/browser'

import type { Orientation, PhoneDevice } from './types'

declare const chrome: typeof browser

export async function openLiveResizedTab(
	url: string,
	device: PhoneDevice,
	orientation: Orientation
): Promise<void> {
	const tab = await chrome.tabs.create({ url: 'about:blank' })
	if (tab.id == null) throw new Error('Could not open a new tab.')
	const tabId = tab.id

	await chrome.debugger.attach({ tabId }, '1.3')

	const portrait = orientation === 'portrait'
	const width = portrait ? device.width : device.height
	const height = portrait ? device.height : device.width

	await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor: device.deviceScaleFactor,
		mobile: true,
		screenOrientation: {
			type: portrait ? 'portraitPrimary' : 'landscapePrimary',
			angle: portrait ? 0 : 90,
		},
	})
	await chrome.debugger.sendCommand({ tabId }, 'Emulation.setTouchEmulationEnabled', {
		enabled: true,
	})
	await chrome.debugger.sendCommand({ tabId }, 'Network.setUserAgentOverride', {
		userAgent: device.userAgent,
	})

	// Only navigate to the real URL once the overrides are in place, so the device metrics and UA
	// apply from the very first request instead of reflowing/re-fetching after the fact.
	await chrome.tabs.update(tabId, { url })
}
