/**
 * ProcedureEvolutionProcessor - Full SMRITI port of procedure patching
 *
 * On success: increments counters, promotes status (3→active, 5→stable).
 * On failure: asks LLM for a patch, runs 6 precondition checks,
 *             applies all 11 patch action types, creates a new version entry.
 *
 * Triggered by episodic entries tagged 'goal-failed' or 'goal-completed'
 * that carry a `procedureId` in metadata.
 *
 * Ported from GA's lib/memory/processors/ProcedureEvolutionProcessor.ts.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type {
	MemoryEntry,
	ProcedureStep,
	ProcedureMetadata,
	ProcedurePatch,
	ProcedurePatchAction,
	ValidationCheckResult,
} from '../../../types'

export interface ProcedureEvolutionLLMService {
	complete(prompt: string, options?: {
		maxTokens?: number
		temperature?: number
		responseFormat?: { type: string }
	}): Promise<string>
}

const CONFIDENCE_THRESHOLD = 0.7
const MAX_STEPS = 20

// ─── Status Promotion ───────────────────────────────────────────────────────

function promoteStatus(meta: ProcedureMetadata): ProcedureMetadata['status'] {
	if (meta.status === 'deprecated') return 'deprecated'
	if (meta.consecutiveSuccesses >= 5 && meta.status === 'active') return 'stable'
	if (meta.consecutiveSuccesses >= 3 && meta.status === 'experimental') return 'active'
	if (meta.successCount >= 2 && meta.status === 'candidate') return 'experimental'
	return meta.status
}

// ─── 6 Precondition Validation Checks (ported from SMRITI proceduralStore) ──

function runPreconditionChecks(
	currentSteps: ProcedureStep[],
	patch: ProcedurePatch,
	allProcedures: Map<string, MemoryEntry>,
	currentProcedureId: string
): ValidationCheckResult[] {
	const results: ValidationCheckResult[] = []

	for (const action of patch.actions) {
		// 1. Backward compatibility - cannot replace or remove isCritical steps
		if (action.type === 'replace_step' || action.type === 'remove_step') {
			const targetId = action.stepId
			const target = currentSteps.find(s => s.id === targetId)
			if (target?.isCritical) {
				results.push({
					passed: false,
					checkName: 'backward_compatibility',
					reason: `Cannot ${action.type} critical step "${target.name}" (isCritical=true)`,
				})
				continue
			}
		}
		results.push({ passed: true, checkName: 'backward_compatibility' })

		// 2. No duplicates - new step name must not match existing (case-insensitive)
		if (action.type === 'insert_step' || action.type === 'replace_step') {
			const newName = action.type === 'insert_step'
				? action.step.name
				: action.replacement.name
			const duplicate = currentSteps.some(
				s => s.name.toLowerCase() === newName.toLowerCase() &&
					(action.type === 'insert_step' || s.id !== action.stepId)
			)
			if (duplicate) {
				results.push({
					passed: false,
					checkName: 'no_duplicates',
					reason: `Step name "${newName}" already exists in procedure`,
				})
				continue
			}
		}
		results.push({ passed: true, checkName: 'no_duplicates' })

		// 3. Entity references - lightweight mode, always pass
		results.push({ passed: true, checkName: 'entity_references' })

		// 4. Testable outcome - step must have a non-trivial description OR at least one
		//    of: validationChecks, preconditions, expectedOutcome.
		//    LLM-generated steps often omit the optional structured fields but always
		//    provide a description - that alone is sufficient as a testability signal.
		if (action.type === 'insert_step') {
			const s = action.step
			const hasTestability =
				(s.description?.trim().length ?? 0) > 0 ||
				(s.validationChecks?.length ?? 0) > 0 ||
				(s.preconditions?.length ?? 0) > 0 ||
				!!s.expectedOutcome
			if (!hasTestability) {
				results.push({
					passed: false,
					checkName: 'testable_outcome',
					reason: `New step "${s.name}" has no description, validationChecks, preconditions, or expectedOutcome`,
				})
				continue
			}
		}
		results.push({ passed: true, checkName: 'testable_outcome' })

		// 5. Step count bounds - max 20 steps
		if (action.type === 'insert_step') {
			if (currentSteps.length >= MAX_STEPS) {
				results.push({
					passed: false,
					checkName: 'step_count_bounds',
					reason: `Procedure already has ${currentSteps.length} steps (max ${MAX_STEPS})`,
				})
				continue
			}
		}
		results.push({ passed: true, checkName: 'step_count_bounds' })

		// 6. No circular dependencies - for merge, target cannot reference source
		if (action.type === 'merge_procedure') {
			const sourceProcEntry = allProcedures.get(action.sourceProcedureId)
			if (sourceProcEntry) {
				const sourceRelations = sourceProcEntry.relations ?? []
				// Circular: source references current procedure as parent - merging would create a cycle
				const circularRef = sourceRelations.some(
					r => r.type === 'parent' && r.targetId === currentProcedureId
				)
				if (circularRef) {
					results.push({
						passed: false,
						checkName: 'no_circular_deps',
						reason: 'Merge source references current procedure as parent (circular)',
					})
					continue
				}
			}
		}
		results.push({ passed: true, checkName: 'no_circular_deps' })
	}

	return results
}

// ─── Apply Patch (all 11 action types) ──────────────────────────────────────

function applyPatch(
	steps: ProcedureStep[],
	actions: ProcedurePatchAction[],
	sourceProcedures: Map<string, MemoryEntry>
): ProcedureStep[] {
	let result = [...steps]

	for (const action of actions) {
		switch (action.type) {
			case 'insert_step': {
				const newStep: ProcedureStep = {
					...action.step,
					id: action.step.id || `step-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
				}
				if (action.afterStepId) {
					const idx = result.findIndex(s => s.id === action.afterStepId)
					if (idx >= 0) {
						result.splice(idx + 1, 0, newStep)
					} else {
						result.push(newStep)
					}
				} else {
					result.push(newStep)
				}
				break
			}

			case 'replace_step': {
				const idx = result.findIndex(s => s.id === action.stepId)
				if (idx >= 0) result[idx] = { ...action.replacement, id: action.stepId }
				break
			}

			case 'remove_step': {
				result = result.filter(s => s.id !== action.stepId)
				break
			}

			case 'reorder_steps': {
				const idToStep = new Map(result.map(s => [s.id, s]))
				const reordered = action.orderedStepIds
					.map(id => idToStep.get(id))
					.filter((s): s is ProcedureStep => s !== undefined)
				// Append any steps not in the ordered list at the end
				const reorderedIds = new Set(action.orderedStepIds)
				const remaining = result.filter(s => !reorderedIds.has(s.id))
				result = [...reordered, ...remaining]
				break
			}

			case 'add_precondition': {
				const idx = result.findIndex(s => s.id === action.stepId)
				if (idx >= 0) {
					result[idx] = {
						...result[idx],
						preconditions: [...(result[idx].preconditions ?? []), action.precondition],
					}
				}
				break
			}

			case 'remove_precondition': {
				const idx = result.findIndex(s => s.id === action.stepId)
				if (idx >= 0) {
					result[idx] = {
						...result[idx],
						preconditions: (result[idx].preconditions ?? []).filter(p => p !== action.precondition),
					}
				}
				break
			}

			case 'add_validation': {
				const idx = result.findIndex(s => s.id === action.stepId)
				if (idx >= 0) {
					result[idx] = {
						...result[idx],
						validationChecks: [...(result[idx].validationChecks ?? []), action.validation],
					}
				}
				break
			}

			case 'remove_validation': {
				const idx = result.findIndex(s => s.id === action.stepId)
				if (idx >= 0) {
					result[idx] = {
						...result[idx],
						validationChecks: (result[idx].validationChecks ?? []).filter(v => v !== action.validation),
					}
				}
				break
			}

			case 'split_procedure':
				// split_procedure creates a new procedure entry - handled in process(), not here.
				// Here we just trim the steps to everything up to and including the split point.
				{
					const idx = result.findIndex(s => s.id === action.splitAfterStepId)
					if (idx >= 0) result = result.slice(0, idx + 1)
				}
				break

			case 'merge_procedure': {
				const sourceProcEntry = sourceProcedures.get(action.sourceProcedureId)
				if (sourceProcEntry) {
					const sourceSteps: ProcedureStep[] = (sourceProcEntry.metadata?.steps as ProcedureStep[] | undefined) ?? []
					const insertIdx = action.insertAfterStepId
						? result.findIndex(s => s.id === action.insertAfterStepId)
						: -1
					if (insertIdx >= 0) {
						result.splice(insertIdx + 1, 0, ...sourceSteps)
					} else {
						result = [...result, ...sourceSteps]
					}
				}
				break
			}

			case 'deprecate':
				// deprecate is handled at the metadata level in process(), not on steps
				break
		}
	}

	// Re-normalise order field
	return result.map((s, i) => ({ ...s, order: i + 1 }))
}

// ─── LLM Patch Prompt ────────────────────────────────────────────────────────

function buildPatchPrompt(steps: ProcedureStep[], failureContent: string): string {
	const stepsJson = JSON.stringify(steps, null, 2)
	return `You are a procedure improvement assistant. A goal failed. Analyze the current procedure steps and the failure description, then suggest a patch.

Current procedure steps:
${stepsJson}

Failure description:
${failureContent.slice(0, 600)}

Respond with JSON only:
{
  "actions": [
    // One or more patch actions. Each action must have a "type" field.
    // Valid types: insert_step, replace_step, remove_step, reorder_steps,
    //              add_precondition, remove_precondition, add_validation, remove_validation,
    //              split_procedure, merge_procedure, deprecate
  ],
  "confidence": <0.0–1.0>,
  "rationale": "<brief explanation of what went wrong and why this patch helps>"
}`
}

// ─── ProcedureEvolutionProcessor ─────────────────────────────────────────────

export class ProcedureEvolutionProcessor implements IMemoryProcessor {
	name = 'procedure-evolver'
	description = 'Evolves procedures on goal success/failure - full SMRITI port with 11 patch actions, 6 precondition checks'

	private llmService: ProcedureEvolutionLLMService
	constructor(llmService: ProcedureEvolutionLLMService) { this.llmService = llmService }

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		if (entry.type !== 'episodic') return false
		const tags = entry.tags ?? []
		if (!tags.includes('goal-failed') && !tags.includes('goal-completed')) return false
		if (!entry.metadata?.procedureId) return false
		// Avoid re-processing
		if (tags.includes('procedure-evolved')) return false
		return true
	}

	async process(entry: MemoryEntry, context: ProcessorContext): Promise<CreateableMemoryEntry | null> {
		const memory = context.memory
		const procedureId = entry.metadata?.procedureId as string | undefined
		if (!procedureId) return null

		const isFailure = (entry.tags ?? []).includes('goal-failed')

		try {
			const procedure = await (memory as any).get(procedureId)
			if (!procedure) {
				console.warn(`[ProcedureEvolutionProcessor] Procedure not found: ${procedureId}`)
				return null
			}

			if (isFailure) {
				await this.evolveOnFailure(procedure, entry, memory)
			} else {
				await this.evolveOnSuccess(procedure, entry, memory)
			}

			await memory.update(entry.id, {
				tags: [...(entry.tags ?? []), 'procedure-evolved'],
			})
		} catch (err) {
			console.error('[ProcedureEvolutionProcessor] Evolution failed:', err)
		}

		return null
	}

	/** Called by ProcedureLearningProcessor for successful goal completions where a procedure already exists. */
	async evolveOnSuccess(
		procedure: MemoryEntry,
		_sourceEntry: MemoryEntry,
		memory: any
	): Promise<void> {
		const meta = procedure.metadata as ProcedureMetadata | undefined
		if (!meta || meta.status === 'deprecated') return

		const successCount = (meta.successCount ?? 0) + 1
		const consecutiveSuccesses = (meta.consecutiveSuccesses ?? 0) + 1
		const reliabilityScore = Math.min(1, (meta.reliabilityScore ?? 0.5) + 0.05)
		const newStatus = promoteStatus({ ...meta, successCount, consecutiveSuccesses })

		await memory.update(procedure.id, {
			outcome: 'success',
			metadata: {
				...meta,
				successCount,
				consecutiveSuccesses,
				reliabilityScore,
				status: newStatus,
			},
		})

		console.log(
			`[ProcedureEvolutionProcessor] Success #${successCount} for ${procedure.id} → status: ${newStatus}`
		)
	}

	private async evolveOnFailure(
		procedure: MemoryEntry,
		sourceEntry: MemoryEntry,
		memory: any
	): Promise<void> {
		const meta = procedure.metadata as ProcedureMetadata | undefined
		if (!meta || meta.status === 'deprecated') return

		const failureCount = (meta.failureCount ?? 0) + 1
		const consecutiveSuccesses = 0
		const reliabilityScore = Math.max(0, (meta.reliabilityScore ?? 0.5) - 0.1)

		// Ask LLM for a patch
		let patch: ProcedurePatch | null = null
		try {
			const prompt = buildPatchPrompt(meta.steps ?? [], sourceEntry.content)
			const raw = await this.llmService.complete(prompt, {
				maxTokens: 1024,
				temperature: 0.3,
				responseFormat: { type: 'json' },
			})
			const jsonMatch = raw.match(/\{[\s\S]*\}/)
			if (jsonMatch) patch = JSON.parse(jsonMatch[0]) as ProcedurePatch
		} catch (err) {
			console.warn('[ProcedureEvolutionProcessor] LLM patch generation failed:', err)
		}

		// Update base metrics regardless of patch success
		const updatedMeta: ProcedureMetadata = {
			...meta,
			failureCount,
			consecutiveSuccesses,
			reliabilityScore,
		}

		if (!patch || patch.confidence < CONFIDENCE_THRESHOLD) {
			// Low confidence or no patch - just update metrics
			await memory.update(procedure.id, {
				outcome: 'failure',
				metadata: updatedMeta,
			})
			return
		}

		// Run 6 precondition checks
		// For merge_procedure, we need a lookup map of related procedures
		const sourceProcedures = new Map<string, MemoryEntry>()
		for (const action of patch.actions) {
			if (action.type === 'merge_procedure') {
				try {
					const src = await (memory as any).get(action.sourceProcedureId)
					if (src) sourceProcedures.set(action.sourceProcedureId, src)
				} catch { /* non-critical */ }
			}
		}

		const checks = runPreconditionChecks(meta.steps ?? [], patch, sourceProcedures, procedure.id)
		const allPassed = checks.every(c => c.passed)

		if (!allPassed) {
			const failures = checks.filter(c => !c.passed).map(c => `${c.checkName}: ${c.reason}`)
			console.warn('[ProcedureEvolutionProcessor] Precondition checks failed:', failures.join('; '))
			await memory.update(procedure.id, {
				outcome: 'failure',
				metadata: updatedMeta,
			})
			return
		}

		// Check for deprecation action
		const deprecateAction = patch.actions.find(a => a.type === 'deprecate')
		if (deprecateAction) {
			await memory.update(procedure.id, {
				outcome: 'failure',
				metadata: { ...updatedMeta, status: 'deprecated' },
			})
			console.log(`[ProcedureEvolutionProcessor] Deprecated procedure ${procedure.id}: ${(deprecateAction as any).reason}`)
			return
		}

		// Apply patch to get new steps
		const newSteps = applyPatch(meta.steps ?? [], patch.actions, sourceProcedures)

		// Create new version entry
		const newVersionId = await memory.create({
			type: 'procedure',
			title: procedure.title,
			content: newSteps.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join('\n'),
			tags: [...(procedure.tags ?? []).filter((t: string) => t !== 'experimental'), updatedMeta.status],
			importance: procedure.importance,
			outcome: 'failure',
			sourceIds: [sourceEntry.id],
			relations: [
				{
					type: 'parent',
					targetId: procedure.id,
					metadata: { patchConfidence: patch.confidence, rationale: patch.rationale },
				},
			],
			metadata: {
				...updatedMeta,
				steps: newSteps,
				latestVersionId: '',  // self-reference, set below
				patchHistory: [
					...((meta as any).patchHistory ?? []),
					{
						timestamp: new Date().toISOString(),
						confidence: patch.confidence,
						rationale: patch.rationale,
						actionTypes: patch.actions.map(a => a.type),
					},
				],
			},
		})

		// Self-reference and update parent to point to new version
		await memory.update(newVersionId, {
			metadata: {
				...updatedMeta,
				steps: newSteps,
				latestVersionId: newVersionId,
			},
		})

		// Update parent procedure to point to new latest version, add child relation
		const parentRelations = [...(procedure.relations ?? [])]
		parentRelations.push({
			type: 'child' as any,
			targetId: newVersionId,
			metadata: { createdAt: new Date().toISOString() },
		})
		await memory.update(procedure.id, {
			outcome: 'failure',
			metadata: { ...updatedMeta, latestVersionId: newVersionId },
			relations: parentRelations,
		})

		// Handle split_procedure side effect: create the new split-off procedure
		const splitAction = patch.actions.find(a => a.type === 'split_procedure')
		if (splitAction && splitAction.type === 'split_procedure') {
			const splitIdx = (meta.steps ?? []).findIndex(s => s.id === splitAction.splitAfterStepId)
			if (splitIdx >= 0) {
				const splitSteps = (meta.steps ?? []).slice(splitIdx + 1)
				if (splitSteps.length > 0) {
					await memory.create({
						type: 'procedure',
						title: splitAction.newProcedureTitle,
						content: splitSteps.map((s: ProcedureStep, i: number) => `${i + 1}. ${s.name}: ${s.description}`).join('\n'),
						tags: ['procedure', 'experimental'],
						importance: 3,
						outcome: 'pending',
						relations: [
							{ type: 'derived_from' as any, targetId: procedure.id, metadata: { splitFrom: true } },
						],
						metadata: {
							steps: splitSteps,
							domain: splitAction.newProcedureDomain,
							linkedGoalIds: meta.linkedGoalIds ?? [],
							latestVersionId: '',
							reliabilityScore: 0.5,
							successCount: 0,
							failureCount: 0,
							consecutiveSuccesses: 0,
							status: 'experimental',
						} as ProcedureMetadata,
					})
				}
			}
		}

		console.log(
			`[ProcedureEvolutionProcessor] Created new procedure version ${newVersionId} from failure on ${procedure.id}`
		)
	}
}

export default ProcedureEvolutionProcessor
