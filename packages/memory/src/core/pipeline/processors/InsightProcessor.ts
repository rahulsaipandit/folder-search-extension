/**
 * InsightProcessor - Full LLM insight extraction from semantic memories
 *
 * Ported from GA's lib/memory/processors/InsightProcessor.ts.
 * Extracts deeper insights from high-importance semantic memories and
 * creates new 'insight' type entries derived from them.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type { MemoryEntry } from '../../../types'

export interface LLMService {
	extractInsight(content: string): Promise<string>
}

export class InsightProcessor implements IMemoryProcessor {
	name = 'insight-extractor'
	description = 'Extracts deeper insights from semantic memories'

	private llmService: LLMService
	constructor(llmService: LLMService) { this.llmService = llmService }

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		// Only process semantic memories
		if (entry.type !== 'semantic') return false

		// Skip if already has derived insights
		if (entry.relations?.some(r => r.type === 'derived_from')) return false

		// Only process high-importance entries (importance >= 4)
		if (!entry.importance || entry.importance < 4) return false

		// Process content that is substantial enough
		if (entry.content.length < 100) return false

		return true
	}

	async process(
		entry: MemoryEntry,
		_context: ProcessorContext
	): Promise<CreateableMemoryEntry | null> {
		try {
			const insight = await this.llmService.extractInsight(entry.content)

			if (!insight || insight.trim().length === 0) {
				console.warn('[InsightProcessor] Empty insight generated')
				return null
			}

			console.log(`[InsightProcessor] Extracted insight from entry ${entry.id}`)

			// Create a new 'insight' type entry derived from the source entry
			const insightEntry: CreateableMemoryEntry = {
				type: 'insight',
				content: insight,
				title: `Insight: ${this.generateTitle(insight)}`,
				tags: ['insight', 'derived', ...(entry.tags || [])].slice(0, 10),
				importance: 5, // Insights are always high importance
				sourceIds: [entry.id],
				relations: [
					{
						type: 'derived_from',
						targetId: entry.id,
						metadata: { parentImportance: entry.importance },
					},
				],
				metadata: {
					insightDate: new Date().toISOString().slice(0, 10),
					parentContentLength: entry.content.length,
					insightLength: insight.length,
				},
			}

			return insightEntry
		} catch (error: unknown) {
			console.error('[InsightProcessor] Failed to extract insight:', error)
			return null
		}
	}

	private generateTitle(content: string): string {
		// Extract first meaningful phrase (up to 40 chars to account for prefix)
		const firstSentence = content.split(/[.!?]/)[0]
		if (firstSentence.length <= 40) return firstSentence
		return firstSentence.substring(0, 37) + '...'
	}
}

export default InsightProcessor
