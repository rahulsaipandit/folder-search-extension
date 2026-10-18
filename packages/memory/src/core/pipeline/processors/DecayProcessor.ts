/**
 * DecayProcessor - Memory importance decay over time
 *
 * Ported from GA's lib/memory/processors/DecayProcessor.ts.
 * Lowers importance of old memories to manage storage and
 * simulate natural forgetting.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type { MemoryEntry } from '../../../types'

export class DecayProcessor implements IMemoryProcessor {
	name = 'decay'
	description = 'Lowers importance of old memories'

	private decayThresholdMs: number
	private decayAmount: number

	constructor(
		/** Minimum age before decay is applied, in days. Default: 30 */
		decayThresholdDays: number = 30,
		/** Amount to subtract from importance per decay cycle. Default: 1 */
		decayAmount: number = 1
	) {
		this.decayThresholdMs = decayThresholdDays * 24 * 60 * 60 * 1000
		this.decayAmount = decayAmount
	}

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		// Only process entries with importance > 1 (already at minimum)
		if (!entry.importance || entry.importance <= 1) return false

		// Check if entry is old enough (age > 30 days by default)
		const entryAge = Date.now() - new Date(entry.createdAt).getTime()
		if (entryAge < this.decayThresholdMs) return false

		// Don't process entries that have already been decayed within the threshold window
		if (entry.metadata?.lastDecayedAt) {
			const lastDecayAge =
				Date.now() - new Date(entry.metadata.lastDecayedAt as string).getTime()
			if (lastDecayAge < this.decayThresholdMs) return false
		}

		return true
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | null> {
		const newImportance = Math.max(1, (entry.importance || 3) - this.decayAmount)

		console.log(
			`[DecayProcessor] Decayed entry ${entry.id} importance: ${entry.importance} -> ${newImportance}`
		)

		await context.memory.update(entry.id, {
			importance: newImportance,
			metadata: {
				...entry.metadata,
				lastDecayedAt: new Date().toISOString(),
				decayCount: ((entry.metadata?.decayCount as number) || 0) + 1,
			},
		})

		return null
	}
}

export default DecayProcessor
