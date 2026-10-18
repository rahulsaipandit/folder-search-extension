import type { PageFrontmatter } from '@page-agent/memory'
import { createVaultProviderFromConfig } from './vaultConfig'

/**
 * Pending vault flush queue — T1 synthesis artifacts queued for async vault sync.
 *
 * Pattern (adapted from MKDF §4):
 *   SynthesisEngine produces artifact
 *     → addPendingArtifact(artifact)   — stored in chrome.storage.local
 *     ↓ chrome.alarms fires every 5 min
 *   flushPendingArtifacts()
 *     → optimistic clear (prevent double-flush on concurrent alarm)
 *     → IVaultProvider.updatePage() for each artifact
 *     → on failure: restore artifacts individually
 *
 * The background service worker sets up the alarm via setupVaultFlushAlarm().
 * The side panel or synthesis pipeline calls addPendingArtifact() directly.
 */

export interface PendingVaultArtifact {
	slug: string
	content: string
	frontmatter: PageFrontmatter
}

const QUEUE_KEY = 'pendingVaultArtifacts'
const ALARM_NAME = 'flush-vault-artifacts'
const ALARM_PERIOD_MINUTES = 5

export async function addPendingArtifact(artifact: PendingVaultArtifact): Promise<void> {
	const result = await chrome.storage.local.get(QUEUE_KEY)
	const queue = (result[QUEUE_KEY] as PendingVaultArtifact[] | undefined) ?? []
	// Deduplicate by slug — latest write wins
	const filtered = queue.filter((a) => a.slug !== artifact.slug)
	filtered.push(artifact)
	await chrome.storage.local.set({ [QUEUE_KEY]: filtered })
}

export async function getPendingCount(): Promise<number> {
	const result = await chrome.storage.local.get(QUEUE_KEY)
	const queue = (result[QUEUE_KEY] as PendingVaultArtifact[] | undefined) ?? []
	return queue.length
}

export async function flushPendingArtifacts(): Promise<{ flushed: number; failed: number }> {
	const result = await chrome.storage.local.get(QUEUE_KEY)
	const queue = (result[QUEUE_KEY] as PendingVaultArtifact[] | undefined) ?? []
	if (queue.length === 0) return { flushed: 0, failed: 0 }

	// Optimistic clear — prevents double-flush if alarm fires concurrently
	await chrome.storage.local.set({ [QUEUE_KEY]: [] })

	const vault = await createVaultProviderFromConfig()
	const failed: PendingVaultArtifact[] = []
	let flushed = 0

	for (const artifact of queue) {
		try {
			await vault.updatePage(artifact.slug, artifact.content, artifact.frontmatter)
			flushed++
		} catch {
			failed.push(artifact)
		}
	}

	// Restore failed artifacts to the queue
	if (failed.length > 0) {
		const current = await chrome.storage.local.get(QUEUE_KEY)
		const existing = (current[QUEUE_KEY] as PendingVaultArtifact[] | undefined) ?? []
		// Don't re-add slugs that succeeded in a concurrent flush
		const existingSlugs = new Set(existing.map((a) => a.slug))
		const toRestore = failed.filter((a) => !existingSlugs.has(a.slug))
		if (toRestore.length > 0) {
			await chrome.storage.local.set({ [QUEUE_KEY]: [...existing, ...toRestore] })
		}
	}

	return { flushed, failed: failed.length }
}

/**
 * Register the chrome.alarms flush timer.
 * Call this once from background.ts on extension startup.
 */
export function setupVaultFlushAlarm(): void {
	chrome.alarms.get(ALARM_NAME, (alarm) => {
		if (!alarm) {
			chrome.alarms.create(ALARM_NAME, {
				delayInMinutes: ALARM_PERIOD_MINUTES,
				periodInMinutes: ALARM_PERIOD_MINUTES,
			})
		}
	})

	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === ALARM_NAME) {
			flushPendingArtifacts().catch(console.error)
		}
	})
}
