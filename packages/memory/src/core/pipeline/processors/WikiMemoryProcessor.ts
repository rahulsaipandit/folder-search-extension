/**
 * WikiMemoryProcessor - Pipeline processor that auto-processes wiki-raw entries
 *
 * Ported from GA's lib/memory/processors/WikiMemoryProcessor.ts.
 *
 * Hooks into the MemoryPipeline so any MemoryEntry created with
 * type='artifact' and tag 'wiki-raw' is automatically processed.
 * This gives the wiki system "fire and forget" semantics: callers
 * create a raw entry via memoryService.create() and the pipeline
 * handles the rest.
 *
 * NOTE: GA's WikiService has not yet been ported to CB. This processor
 * marks the entry as 'wiki-processed' and records an error tag when no
 * wikiProcessFn is provided. Wire up a real implementation by passing a
 * wikiProcessFn to the constructor once WikiService is available in CB.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type { MemoryEntry } from '../../../types'

/**
 * Optional callback that performs the actual wiki page generation and
 * graph ingestion for a raw entry. Receives the entry id and the full
 * ProcessorContext (which includes the memory service).
 *
 * Return true on success, false/throw on failure.
 */
export type WikiProcessFn = (entryId: string, context: ProcessorContext) => Promise<void>

export class WikiMemoryProcessor implements IMemoryProcessor {
	name = 'wiki-processor'
	description =
		'Auto-processes wiki-raw artifact entries into wiki pages with graph ingestion'

	private wikiProcessFn: WikiProcessFn | null

	constructor(
		/**
		 * Implementation that converts a raw wiki entry into a processed wiki page.
		 * When omitted the processor marks the entry as processed but performs no
		 * actual wiki operations (useful as a placeholder until WikiService is ported).
		 */
		wikiProcessFn: WikiProcessFn | null = null
	) {
		this.wikiProcessFn = wikiProcessFn
	}

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		if (entry.type !== 'artifact') return false
		if (!entry.tags?.includes('wiki-raw')) return false
		// Skip if already processed
		if (entry.tags?.includes('wiki-processed')) return false
		return true
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | null> {
		if (this.wikiProcessFn) {
			try {
				await this.wikiProcessFn(entry.id, context)
			} catch (err: unknown) {
				console.warn(
					'[WikiMemoryProcessor] Failed to process raw entry:',
					entry.id,
					err
				)
				// Tag the entry so it can be retried or inspected, but don't block the pipeline
				await context.memory.update(entry.id, {
					tags: [...(entry.tags ?? []), 'wiki-process-error'],
					metadata: {
						...entry.metadata,
						wikiProcessError:
							err instanceof Error ? err.message : String(err),
						wikiProcessErrorAt: new Date().toISOString(),
					},
				})
				return null
			}
		} else {
			// WikiService not yet ported - log and mark entry so callers can detect the gap
			console.warn(
				'[WikiMemoryProcessor] No wikiProcessFn provided; entry marked wiki-processed without actual wiki operations.',
				entry.id
			)
		}

		// Mark entry as processed regardless so it is not re-queued
		const updatedTags = [
			...(entry.tags ?? []).filter(t => t !== 'wiki-raw'),
			'wiki-processed',
		]
		await context.memory.update(entry.id, {
			tags: updatedTags,
			metadata: {
				...entry.metadata,
				wikiProcessedAt: new Date().toISOString(),
			},
		})

		// Side-effects only - no new entry to return
		return null
	}
}

export default WikiMemoryProcessor
