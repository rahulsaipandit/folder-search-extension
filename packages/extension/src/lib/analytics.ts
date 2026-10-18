// ─── GA4 Analytics (Measurement Protocol) ──────────────────────────────────
// MV3's CSP forbids loading gtag.js/analytics.js (remote code execution is
// disallowed for extension pages), so events are sent as plain HTTPS POSTs
// to the Measurement Protocol endpoint instead of via Google's client script.
// See https://developers.google.com/analytics/devguides/collection/protocol/ga4
//
// Measurement ID + API secret are read from build-time env vars, not hardcoded here — this file
// ships in the packed extension bundle, which anyone can unzip and read, so a real credential
// checked in as a literal is effectively public. WXT auto-exposes any `WXT_`-prefixed variable
// from `.env`/`.env.development`/`.env.production` (gitignored, not committed) as
// `import.meta.env.WXT_*` — same mechanism already used for WXT_DEMO_BASE_URL in
// agent/constants.ts and WXT_ENVIRONMENT in ConfigPanel.tsx. Get the Measurement Protocol API
// secret from Admin → Data Streams → your stream → Measurement Protocol API secrets → Create (the
// Measurement ID alone is not enough to authenticate), then set both in your local `.env`:
//   WXT_GA_MEASUREMENT_ID=G-XXXXXXXXXX
//   WXT_GA_API_SECRET=<the Measurement Protocol API secret>
// Neither var being set is a normal, supported state (e.g. a contributor's own dev build) —
// trackEvent below no-ops rather than sending a request with an empty/invalid secret.
const MEASUREMENT_ID = import.meta.env.WXT_GA_MEASUREMENT_ID ?? ''
const API_SECRET = import.meta.env.WXT_GA_API_SECRET ?? ''

const ENDPOINT = 'https://www.google-analytics.com/mp/collect'

import { loadSettings, saveSettings } from '@/shared/settings'

let cachedClientId: string | null = null

// GA4 client_id is a random UUID persisted in extension storage - it identifies
// this browser installation for session stitching, never a real user identity.
// Takes the already-loaded settings object (trackEvent already has one) instead of loading its
// own copy - avoids a second chrome.storage round-trip for what's the same settings blob.
async function getClientId(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<string> {
	if (cachedClientId) return cachedClientId
	if (settings.analyticsClientId) {
		cachedClientId = settings.analyticsClientId
		return cachedClientId
	}
	const id = crypto.randomUUID()
	await saveSettings({ analyticsClientId: id })
	cachedClientId = id
	return id
}

// GA4 event names must start with a letter and contain only letters, digits,
// and underscores (max 40 chars) - skill ids are kebab-case, so normalise them.
function toEventName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)
}

/**
 * Send a custom GA4 event. Silently no-ops when the user has opted out
 * (settings.analyticsEnabled === false) and never throws - analytics must
 * never affect the calling feature. Failures are still logged (not thrown) per
 * AGENTS.md's "make errors visible" rule - a silent catch would hide a real
 * problem (e.g. the API_SECRET below still being a placeholder) forever.
 */
export async function trackEvent(name: string, params?: Record<string, string | number>): Promise<void> {
	try {
		const settings = await loadSettings()
		if (settings.analyticsEnabled === false) return
		if (!MEASUREMENT_ID || !API_SECRET) {
			console.warn('[analytics] WXT_GA_MEASUREMENT_ID/WXT_GA_API_SECRET not configured - dropping event', name)
			return
		}

		const client_id = await getClientId(settings)
		const url = `${ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_id,
				events: [{ name: toEventName(name), params }],
			}),
		})
		if (!response.ok) {
			console.warn('[analytics] GA4 event rejected:', response.status, name)
		}
	} catch (error) {
		console.warn('[analytics] failed to send event:', name, error)
	}
}

/** Tracks a click on an Agent Library card. */
export function trackCardClick(skillId: string): void {
	// One event name with skill_id as a parameter - not a per-skill event name (`card_click_${id}`)
	// - matches GA4's own modeling convention (event = action, params = dimensions) and keeps this
	// filterable as one event in reports instead of minting a new event definition per skill.
	void trackEvent('card_click', { skill_id: skillId })
}
