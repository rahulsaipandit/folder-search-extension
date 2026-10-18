/**
 * ProcedureLearningProcessor - Learns procedures from completed goals
 *
 * Triggered by episodic entries tagged 'goal-completed'.
 * Searches for an existing procedure for the same goal type:
 *   - If none: extracts steps via LLM → creates 'candidate' procedure entry
 *   - If found: delegates to ProcedureEvolutionProcessor.evolveOnSuccess()
 *
 * Tags the source episodic entry with 'procedure-created' so this runs only once.
 *
 * Ported from GA's lib/memory/processors/ProcedureLearningProcessor.ts.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type { MemoryEntry, ProcedureStep, ProcedureMetadata } from '../../../types'
import { ProcedureEvolutionProcessor } from './ProcedureEvolutionProcessor'

export interface ProcedureLLMService {
	/**
	 * Extract structured procedure steps from an episodic memory's content.
	 * Must return a JSON array of ProcedureStep objects.
	 */
	extractSteps(content: string, goalTitle: string): Promise<ProcedureStep[]>

	/**
	 * Standard LLM complete (used by ProcedureEvolutionProcessor internally).
	 */
	complete(prompt: string, options?: {
		maxTokens?: number
		temperature?: number
		responseFormat?: { type: string }
	}): Promise<string>
}

function generateStepId(): string {
	return `step-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

function inferDomain(goalTitle: string): string {
	const title = goalTitle.toLowerCase()
	if (/\b(learn|study|course|skill|read|practice)\b/.test(title)) return 'learning'
	if (/\b(health|exercise|workout|diet|sleep|meditat)\b/.test(title)) return 'health'
	if (/\b(work|project|client|deadline|ship|launch|deploy)\b/.test(title)) return 'professional'
	if (/\b(finance|invest|budget|save|money)\b/.test(title)) return 'finance'
	if (/\b(relation|friend|family|social)\b/.test(title)) return 'social'
	return 'personal'
}

export class ProcedureLearningProcessor implements IMemoryProcessor {
	name = 'procedure-learner'
	description = 'Creates or evolves procedures from goal-completion episodic entries'

	private evolutionProcessor: ProcedureEvolutionProcessor

	private llmService: ProcedureLLMService
	constructor(llmService: ProcedureLLMService) {
		this.llmService = llmService
		this.evolutionProcessor = new ProcedureEvolutionProcessor(llmService)
	}

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		if (entry.type !== 'episodic') return false
		const tags = entry.tags ?? []
		if (!tags.includes('goal-completed')) return false
		if (tags.includes('procedure-created')) return false
		return true
	}

	async process(entry: MemoryEntry, context: ProcessorContext): Promise<CreateableMemoryEntry | null> {
		const memory = context.memory
		const goalTitle: string = (entry.metadata?.goalTitle as string | undefined) ?? 'Unknown Goal'
		const goalId: string = (entry.metadata?.goalId as string | undefined) ?? ''

		try {
			// Search for existing procedure for this goal type
			const searchResult = await (memory as any).search(goalTitle, {
				filter: { type: ['procedure'] },
				limit: 5,
			})

			const existingProcedure: MemoryEntry | undefined = searchResult?.results?.find(
				(r: any) => {
					const e: MemoryEntry = r.entry
					const linkedGoalIds: string[] = (e.metadata?.linkedGoalIds as string[] | undefined) ?? []
					return linkedGoalIds.includes(goalId) ||
						(e.title ?? '').toLowerCase().includes(goalTitle.toLowerCase().slice(0, 20))
				}
			)?.entry

			if (existingProcedure) {
				// Delegate to evolution processor for success path
				await this.evolutionProcessor.evolveOnSuccess(existingProcedure, entry, memory)
			} else {
				// Extract steps via LLM and create a new candidate procedure
				await this.createNewProcedure(entry, goalTitle, goalId, memory)
			}

			// Tag the source entry as processed
			await memory.update(entry.id, {
				tags: [...(entry.tags ?? []), 'procedure-created'],
			})
		} catch (err) {
			console.error('[ProcedureLearningProcessor] Failed to learn procedure:', err)
		}

		return null
	}

	private async createNewProcedure(
		entry: MemoryEntry,
		goalTitle: string,
		goalId: string,
		memory: any
	): Promise<void> {
		let steps: ProcedureStep[] = []

		try {
			const rawSteps = await this.llmService.extractSteps(entry.content, goalTitle)
			steps = rawSteps.map((s, i) => ({
				id: s.id || generateStepId(),
				name: s.name,
				description: s.description,
				order: s.order ?? i + 1,
				preconditions: s.preconditions,
				validationChecks: s.validationChecks,
				expectedOutcome: s.expectedOutcome,
				isCritical: s.isCritical ?? false,
			}))
		} catch (err) {
			console.warn('[ProcedureLearningProcessor] LLM step extraction failed, using placeholder:', err)
			steps = [{
				id: generateStepId(),
				name: 'Complete goal',
				description: `Steps to achieve: ${goalTitle}`,
				order: 1,
				isCritical: true,
			}]
		}

		const procedureMeta: ProcedureMetadata = {
			steps,
			domain: inferDomain(goalTitle),
			linkedGoalIds: goalId ? [goalId] : [],
			latestVersionId: '',  // filled after create
			reliabilityScore: 0.5,
			successCount: 1,
			failureCount: 0,
			consecutiveSuccesses: 1,
			status: 'candidate',  // promoted to 'experimental' after a second confirmed success
		}

		const procedureId = await memory.create({
			type: 'procedure',
			title: `Procedure: ${goalTitle}`,
			content: steps.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join('\n'),
			tags: ['procedure', 'experimental'],
			importance: 3,
			outcome: 'success',
			sourceIds: [entry.id],
			relations: [
				{
					type: 'derived_from',
					targetId: entry.id,
					metadata: { goalId, goalTitle },
				},
			],
			metadata: {
				...procedureMeta,
				latestVersionId: '',  // self-reference, updated after creation
			},
		})

		// Self-reference latestVersionId
		await memory.update(procedureId, {
			metadata: {
				...procedureMeta,
				latestVersionId: procedureId,
			},
		})

		console.log(`[ProcedureLearningProcessor] Created new procedure ${procedureId} for goal "${goalTitle}"`)
	}
}

export default ProcedureLearningProcessor
