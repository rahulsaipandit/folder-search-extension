/**
 * Cache Consistency Manager - in-memory graph cache with version-based staleness
 * detection, TTL expiration, and mutation-event polling for cross-worker freshness.
 *
 * Phase 3 migration from packages/extension/src/memory/cache.ts.
 *
 * The dependency on MutationEventRepo (IDB) is replaced by a `pollFn` callback
 * injected at construction time.  The extension wires in `MutationEventRepo.pollSince`;
 * other platforms can supply their own implementation.
 */

import type { MutationEvent } from '../../types'

export interface CacheLine {
	nodeId: string
	data: unknown
	version: number
	ttl: number
}

export interface CacheConsistencyConfig {
	defaultTTL: number      // ms, default 30_000
	pollInterval: number    // ms, default 500
	maxCacheSize: number    // items, default 1_000
}

const DEFAULT_CONFIG: CacheConsistencyConfig = {
	defaultTTL: 30_000,
	pollInterval: 500,
	maxCacheSize: 1_000,
}

export interface CacheConsistencyManagerOptions extends Partial<CacheConsistencyConfig> {
	/** Called periodically to fetch mutation events since a given timestamp. */
	pollFn?: (since: number) => Promise<MutationEvent[]>
}

export class CacheConsistencyManager {
	private cache = new Map<string, CacheLine>()
	private versionIndex = new Map<string, number>()
	private lastPollTimestamp = 0
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private readonly config: CacheConsistencyConfig
	private pollFn?: (since: number) => Promise<MutationEvent[]>

	constructor(options: CacheConsistencyManagerOptions = {}) {
		const { pollFn, ...configOverrides } = options
		this.pollFn = pollFn
		this.config = { ...DEFAULT_CONFIG, ...configOverrides }
	}

	// ── Polling ───────────────────────────────────────────────────────────────

	startPolling(): void {
		if (this.pollTimer || !this.pollFn) return
		this.pollTimer = setInterval(async () => {
			try {
				const events = await this.pollFn!(this.lastPollTimestamp)
				for (const event of events) this.handleMutationEvent(event)
				if (events.length > 0) {
					this.lastPollTimestamp = Math.max(...events.map(e => e.timestamp))
				}
			} catch {
				// Silently retry on next interval
			}
		}, this.config.pollInterval)
	}

	stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	// ── Cache operations ──────────────────────────────────────────────────────

	get(nodeId: string): unknown | undefined {
		const line = this.cache.get(nodeId)
		if (!line) return undefined
		if (line.ttl < Date.now()) { this.cache.delete(nodeId); return undefined }
		return line.data
	}

	set(nodeId: string, data: unknown, version: number): void {
		if (this.cache.size >= this.config.maxCacheSize) {
			const oldest = this.cache.keys().next().value
			if (oldest) this.cache.delete(oldest)
		}
		this.cache.set(nodeId, { nodeId, data, version, ttl: Date.now() + this.config.defaultTTL })
		this.versionIndex.set(nodeId, version)
	}

	invalidate(nodeIds: string[]): void {
		for (const id of nodeIds) { this.cache.delete(id); this.versionIndex.delete(id) }
	}

	clear(): void { this.cache.clear(); this.versionIndex.clear() }

	// ── Stats ─────────────────────────────────────────────────────────────────

	stats(): { size: number; hitRate: number } {
		return {
			size: this.cache.size,
			hitRate: this.versionIndex.size > 0 ? this.cache.size / this.versionIndex.size : 1,
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private handleMutationEvent(event: MutationEvent): void {
		for (const id of event.recordIds) this.cache.delete(id)
		if (event.storeName === 'procedure_versions') {
			for (const key of this.cache.keys()) {
				if (key.startsWith('proc_')) this.cache.delete(key)
			}
		}
	}
}
