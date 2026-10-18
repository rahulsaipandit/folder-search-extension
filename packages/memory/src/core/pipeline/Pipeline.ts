import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { BackgroundJob, JobType, MemoryEntry, TieredLLMConfig } from '../../types'
import { enrichEntryWithEntities } from './processors/T0EntityExtractor'
import { recomputeSalience } from './processors/T0SalienceProcessor'
import { T1SummarizationProcessor } from './processors/T1SummarizationProcessor'
import type { IMemoryProcessor, ProcessorContext } from './IMemoryProcessor'

/**
 * Async enrichment pipeline.
 *
 * All memory writes succeed immediately. The pipeline enriches them in the background:
 *   1. T0 entity extraction
 *   2. T0 salience computation
 *   3. T1 summarization (if importance ≥ 3 → promote to L1 semantic)
 *   4. Index update (embedding + BM25)
 *
 * Design principle (from GA): writes never block on pipeline completion.
 */

export type PipelineEventType =
	| 'job.started'
	| 'job.completed'
	| 'job.failed'
	| 'entry.enriched'
	| 'entry.promoted'
	| 'processor.completed'

export interface PipelineEvent {
	type: PipelineEventType
	entryId: string
	job?: BackgroundJob
	error?: Error
	processorName?: string
}

type PipelineListener = (event: PipelineEvent) => void

export class Pipeline {
	private readonly store: IMemoryStore
	private readonly index: IMemoryIndex
	private readonly t1: T1SummarizationProcessor
	private readonly listeners = new Set<PipelineListener>()

	// Pluggable processor chain (Phase 4.1 GA→CB migration)
	private processors: IMemoryProcessor[] = []
	private pipelineContext?: ProcessorContext

	// In-memory queue: mobile time-boxed, max 2 parallel
	private readonly queue: { entry: MemoryEntry; jobs: JobType[] }[] = []
	private running = 0
	private readonly maxParallel: number
	private readonly budgetMs: number

	constructor(
		store: IMemoryStore,
		index: IMemoryIndex,
		config: {
			llm?: TieredLLMConfig
			maxParallel?: number
			budgetMs?: number
		} = {}
	) {
		this.store = store
		this.index = index
		this.t1 = new T1SummarizationProcessor(config.llm ?? {})
		this.maxParallel = config.maxParallel ?? 2
		this.budgetMs = config.budgetMs ?? 5_000
	}

	async initialize(): Promise<void> {
		await this.t1.initialize()
	}

	/** Set the runtime context passed to every registered processor. */
	setPipelineContext(ctx: ProcessorContext): void {
		this.pipelineContext = ctx
	}

	/** Register a pluggable processor that runs after the built-in enrichment steps. */
	registerProcessor(p: IMemoryProcessor): void {
		this.processors.push(p)
	}

	/** Enqueue an entry for background enrichment. Non-blocking. */
	enqueue(entry: MemoryEntry): void {
		this.queue.push({
			entry,
			jobs: ['extract_entities', 'compute_salience', 'extract_semantic'],
		})
		this.drain()
	}

	on(listener: PipelineListener): void {
		this.listeners.add(listener)
	}

	off(listener: PipelineListener): void {
		this.listeners.delete(listener)
	}

	// ── Internal ────────────────────────────────────────────────────────────────

	private drain(): void {
		while (this.running < this.maxParallel && this.queue.length > 0) {
			const item = this.queue.shift()!
			this.running++
			this.processEntry(item.entry).finally(() => {
				this.running--
				this.drain()
			})
		}
	}

	private async processEntry(entry: MemoryEntry): Promise<void> {
		const startedAt = Date.now()

		try {
			this.emit({ type: 'job.started', entryId: entry.id })

			// Step 1 - T0 entity extraction (sync, free)
			if (Date.now() - startedAt < this.budgetMs) {
				enrichEntryWithEntities(entry)
			}

			// Step 2 - T0 salience computation (sync, free)
			if (Date.now() - startedAt < this.budgetMs) {
				recomputeSalience(entry)
			}

			// Step 3 - T1 summarization (async, LLM)
			if (Date.now() - startedAt < this.budgetMs && entry.type === 'episodic') {
				const importance = await this.t1.scoreImportance(entry)
				entry.importance = importance
				entry.updatedAt = new Date().toISOString()

				// Promote high-importance episodes to L1 semantic memory
				if (importance >= 3) {
					await this.promoteToSemantic(entry)
				}
			}

			// Step 4 - Update store + index
			if (Date.now() - startedAt < this.budgetMs) {
				await this.store.put(entry)
				await this.index.index(entry)
			}

			// Step 5 - Pluggable processor chain (Phase 4.1)
			if (this.processors.length > 0 && this.pipelineContext) {
				for (const p of this.processors) {
					if (await p.shouldProcess(entry)) {
						const result = await p.process(entry, this.pipelineContext!)
						if (result !== null) {
							// Single-entry result: merge fields back onto current entry
							if (!Array.isArray(result)) {
								Object.assign(entry, result)
							}
						}
						this.emit({ type: 'processor.completed', entryId: entry.id, processorName: p.name })
					}
				}
			}

			this.emit({ type: 'entry.enriched', entryId: entry.id })
			this.emit({ type: 'job.completed', entryId: entry.id })
		} catch (error) {
			this.emit({ type: 'job.failed', entryId: entry.id, error: error as Error })
		}
	}

	private async promoteToSemantic(sourceEntry: MemoryEntry): Promise<void> {
		try {
			const result = await this.t1.summarize(sourceEntry)

			const semanticEntry: MemoryEntry = {
				id: `${sourceEntry.id}-sem`,
				type: 'semantic',
				content: result.summary,
				title: result.title,
				createdAt: new Date().toISOString(),
				importance: result.importance,
				tags: result.tags,
				sourceIds: [sourceEntry.id],
				entities: sourceEntry.entities,
				sessionId: sourceEntry.sessionId,
				userId: sourceEntry.userId,
				lifecycleState: 'active',
				salience: sourceEntry.salience,
			}

			recomputeSalience(semanticEntry)
			await this.store.put(semanticEntry)
			await this.index.index(semanticEntry)

			this.emit({ type: 'entry.promoted', entryId: sourceEntry.id })

			// Phase 4: L2 insight synthesis - check if enough related L1 semantics
			// exist to warrant promoting to a deep L2 insight
			await this.maybePromoteToInsight(semanticEntry)
		} catch {
			// Promotion failure is non-fatal - source entry still enriched
		}
	}

	/**
	 * Phase 4 - L2 insight synthesis (Smriti 3-pass graph building pattern).
	 *
	 * Trigger: when 3+ L1 semantic entries share at least 2 overlapping entities,
	 * synthesize them into a single L2 `insight` entry representing the deep pattern.
	 *
	 * L2 entries are NOT created for every promotion - only when a cluster forms.
	 * This mirrors how human insight emerges from accumulated related experiences.
	 */
	private async maybePromoteToInsight(semanticEntry: MemoryEntry): Promise<void> {
		if (!semanticEntry.entities || semanticEntry.entities.length < 2) return

		// Find other semantic entries with ≥ 2 overlapping entities
		const entitySet = new Set(semanticEntry.entities)
		const { entries: all } = await this.store.query({ type: 'semantic', lifecycleState: 'active' })

		const related = all.filter((e) => {
			if (e.id === semanticEntry.id) return false
			const overlap = (e.entities ?? []).filter((ent) => entitySet.has(ent)).length
			return overlap >= 2
		})

		// Threshold: 3 related L1 semantics required to form an L2 insight
		if (related.length < 2) return

		// Check if an L2 insight for this entity cluster already exists
		const clusterKey = [...semanticEntry.entities].sort().slice(0, 3).join(':')
		const insightId = `insight-${clusterKey}`
		const existing = await this.store.get(insightId)
		if (existing) {
			// Update existing insight: append this semantic to sourceIds
			if (!existing.sourceIds?.includes(semanticEntry.id)) {
				existing.sourceIds = [...(existing.sourceIds ?? []), semanticEntry.id]
				existing.updatedAt = new Date().toISOString()
				recomputeSalience(existing)
				await this.store.put(existing)
				await this.index.index(existing)
			}
			return
		}

		// Create new L2 insight entry
		const sourceEntries = [semanticEntry, ...related.slice(0, 4)]
		const combinedContent = sourceEntries
			.map((e) => e.content.slice(0, 200))
			.join('\n\n---\n\n')

		// T1 LLM insight synthesis - fallback to heuristic concatenation
		let insightContent: string
		let insightTitle: string
		try {
			const result = await this.t1.summarize({
				...semanticEntry,
				content: `Synthesize an insight from these ${sourceEntries.length} related observations:\n\n${combinedContent}`,
				title: `Insight synthesis for: ${[...entitySet].slice(0, 3).join(', ')}`,
			})
			insightContent = result.summary
			insightTitle = result.title ?? `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
		} catch {
			// T3 fallback: simple concatenation
			insightContent = `Pattern observed across ${sourceEntries.length} related events: ${combinedContent.slice(0, 400)}`
			insightTitle = `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
		}

		const insightEntry: MemoryEntry = {
			id: insightId,
			type: 'insight',
			content: insightContent,
			title: insightTitle,
			createdAt: new Date().toISOString(),
			importance: 4, // L2 insights are high importance by construction
			sourceIds: sourceEntries.map((e) => e.id),
			entities: [...entitySet],
			tags: semanticEntry.tags,
			lifecycleState: 'active',
		}

		recomputeSalience(insightEntry)
		await this.store.put(insightEntry)
		await this.index.index(insightEntry)

		this.emit({ type: 'entry.promoted', entryId: insightEntry.id })
	}

	private emit(event: PipelineEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch {
				// Event listener failures must not crash the pipeline
			}
		}
	}
}
