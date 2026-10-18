/**
 * Shared local persistence for tracked extensions + their keyword rank history.
 *
 * `localStorage`, not `lib/db.ts`'s Dexie database — matches the lightweight pattern
 * `seo-tracker`'s own keyword watchlist already uses (design doc §10 explicitly notes this is a
 * deliberate simplification for a first slice, not the eventual Dexie-backed shape §7 assumes).
 * Extension pages share one origin (`chrome-extension://<id>/`), so this is readable/writable from
 * both the `extension-ranker` tab and the sidepanel's widget-runtime context (where the scheduled
 * ranking sweep executes).
 */

import type { TrackedExtension } from './types'

const STORAGE_KEY = 'chromeExtensionRanker:tracked'

export function loadTrackedExtensions(): TrackedExtension[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		return raw ? JSON.parse(raw) : []
	} catch (error) {
		console.error('[chromeExtensionRanking] failed to load tracked extensions from localStorage:', error)
		return []
	}
}

export function saveTrackedExtensions(entries: TrackedExtension[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}
