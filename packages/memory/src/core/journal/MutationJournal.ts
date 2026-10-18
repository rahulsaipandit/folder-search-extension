/**
 * Mutation Journal - in-memory write-ahead log for cross-worker IDB consistency.
 *
 * Phase 2 migration from packages/extension/src/memory/storage/repositories.ts
 * (MutationEventRepo). Subscribers poll via `pollSince(timestamp)`. The IDB-backed
 * variant (Phase 3) uses the same interface but persists events across restarts.
 */

import type { MutationEvent, MutationType } from '../../types'

export interface IMutationJournal {
	append(event: MutationEvent): void
	pollSince(timestamp: number): MutationEvent[]
	clear(): void
}

let _seq = 0
function nextJournalId(): string {
	return `mevt_${Date.now().toString(36)}_${(++_seq).toString(36)}`
}

export class InMemoryMutationJournal implements IMutationJournal {
	private events: MutationEvent[] = []
	/** Trim to last N events to bound memory usage in long-running service workers. */
	private readonly maxEvents: number

	constructor(maxEvents = 2_000) {
		this.maxEvents = maxEvents
	}

	append(event: MutationEvent): void {
		this.events.push(event)
		if (this.events.length > this.maxEvents) {
			this.events.splice(0, this.events.length - this.maxEvents)
		}
	}

	/** Record a mutation and return the assigned event ID. */
	record(params: {
		workerId: string
		storeName: string
		recordIds: string[]
		mutationType: MutationType
		summary: string
		dependencies?: string[]
	}): string {
		const id = nextJournalId()
		this.append({ id, timestamp: Date.now(), ...params })
		return id
	}

	pollSince(timestamp: number): MutationEvent[] {
		return this.events.filter(e => e.timestamp > timestamp)
	}

	clear(): void { this.events = [] }

	get size(): number { return this.events.length }
}
