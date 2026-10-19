import type { FileRecord } from './types'

/**
 * Tracks duplicate relationships for one reconcile pass. A duplicate points at the file whose
 * vectors it shares; when that file goes away its duplicates must be re-indexed, unless they were
 * removed earlier in the same pass (they must not be resurrected from the stale snapshot).
 */
export class RemovalContext {
	private byPrimary = new Map<string, FileRecord[]>()
	private removed = new Set<string>()

	constructor(inventory: FileRecord[]) {
		for (const f of inventory) {
			if (!f.duplicateOf) continue
			const list = this.byPrimary.get(f.duplicateOf) ?? []
			list.push(f)
			this.byPrimary.set(f.duplicateOf, list)
		}
	}

	dependentsOf(primaryId: string): FileRecord[] {
		return (this.byPrimary.get(primaryId) ?? []).filter(f => !this.removed.has(f.fileId))
	}

	markRemoved(fileId: string): void {
		this.removed.add(fileId)
	}
}
