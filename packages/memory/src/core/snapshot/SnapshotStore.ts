/**
 * Snapshot Store - rolling checkpoint buffer for service-worker recovery.
 *
 * Phase 2 migration from packages/extension/src/memory/storage/repositories.ts
 * (SnapshotRepo). This in-process ring-buffer implementation works on all platforms.
 * The IDB-backed variant (Phase 3) persists across SW restarts and enables coldStart
 * detection.
 */

import type { StateSnapshot } from '../../types'

export interface ISnapshotStore {
	save(snapshot: StateSnapshot): Promise<void>
	getLatest(): Promise<StateSnapshot | null>
	getAll(): Promise<StateSnapshot[]>
	/** Keep only the most recent `maxCount` snapshots. */
	prune(maxCount?: number): Promise<void>
}

export class InMemorySnapshotStore implements ISnapshotStore {
	private snapshots: StateSnapshot[] = []

	async save(snapshot: StateSnapshot): Promise<void> {
		this.snapshots.push(snapshot)
	}

	async getLatest(): Promise<StateSnapshot | null> {
		if (this.snapshots.length === 0) return null
		return this.snapshots.reduce((latest, s) =>
			s.timestamp > latest.timestamp ? s : latest
		)
	}

	async getAll(): Promise<StateSnapshot[]> {
		return [...this.snapshots].sort((a, b) => b.timestamp - a.timestamp)
	}

	async prune(maxCount = 10): Promise<void> {
		const sorted = [...this.snapshots].sort((a, b) => b.timestamp - a.timestamp)
		this.snapshots = sorted.slice(0, maxCount)
	}
}
