/**
 * Versioned Procedural Memory - business logic layer.
 *
 * Manages the lifecycle and evolution of agent procedures: creation,
 * constrained patch application, precondition validation, merge-candidate
 * detection, and deprecation cascade.
 *
 * Storage is fully delegated to IProceduralStore so this class runs on any
 * platform (web via IndexedDBProceduralStore, desktop via PGLiteProceduralStore).
 *
 * Ported from packages/extension/src/memory/proceduralStore.ts - Phase 1 migration.
 */

import type { IProceduralStore } from '../../interfaces/IProceduralStore'
import type {
	ProcedureRecord,
	ProcedureVersionRecord,
	ProcedureStep,
	ProcedurePatch,
	ProcedurePatchAction,
	EvolutionPreconditionCheck,
	MergeCandidate,
	ProcedureStatus,
} from '../../types'

function nextId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export class ProceduralStore {
	private store: IProceduralStore
	constructor(store: IProceduralStore) { this.store = store }

	// ── Procedure CRUD ────────────────────────────────────────────────────────

	async createProcedure(params: {
		name: string
		domain: string
		steps: ProcedureStep[]
		rationale?: string
		tags?: string[]
		linkedEntities?: string[]
	}): Promise<{ procedure: ProcedureRecord; version: ProcedureVersionRecord }> {
		const procedureId = nextId('proc')
		const versionId = nextId('pver')
		const now = Date.now()

		const procedure = await this.store.createProcedure({
			id: procedureId,
			name: params.name,
			domain: params.domain,
			latestVersionId: versionId,
			stableVersionId: versionId,
			status: 'experimental',
			tags: params.tags ?? [],
			linkedEntities: params.linkedEntities ?? [],
			reliabilityScore: 0.5,
			successCount: 0,
			failureCount: 0,
			consecutiveSuccesses: 0,
		})

		const version = await this.store.createVersion({
			id: versionId,
			procedureId,
			version: 1,
			steps: params.steps,
			rationale: params.rationale ?? 'Initial creation',
			createdFromEpisodeIds: [],
			status: 'active',
		})

		return { procedure, version }
	}

	getProcedure(id: string): Promise<ProcedureRecord | null> {
		return this.store.getProcedure(id)
	}

	getProcedureByName(name: string): Promise<ProcedureRecord | null> {
		return this.store.getProcedureByName(name)
	}

	getProceduresByDomain(domain: string): Promise<ProcedureRecord[]> {
		return this.store.getProceduresByDomain(domain)
	}

	getAllProcedures(): Promise<ProcedureRecord[]> {
		return this.store.getAllProcedures()
	}

	getVersion(id: string): Promise<ProcedureVersionRecord | null> {
		return this.store.getVersion(id)
	}

	getLatestVersion(procedureId: string): Promise<ProcedureVersionRecord | null> {
		return this.store.getLatestVersion(procedureId)
	}

	// ── Outcome Tracking ──────────────────────────────────────────────────────

	async recordSuccess(procedureId: string): Promise<void> {
		const proc = await this.store.getProcedure(procedureId)
		if (!proc) return
		const newConsecutive = proc.consecutiveSuccesses + 1
		const newStatus: ProcedureStatus =
			newConsecutive >= 5 ? 'stable' : proc.status === 'experimental' ? 'active' : proc.status
		await this.store.updateProcedure(procedureId, {
			successCount: proc.successCount + 1,
			consecutiveSuccesses: newConsecutive,
			reliabilityScore: Math.min(1, proc.reliabilityScore + 0.05),
			status: newStatus,
			updatedAt: Date.now(),
		})
	}

	async recordFailure(procedureId: string): Promise<void> {
		const proc = await this.store.getProcedure(procedureId)
		if (!proc) return
		await this.store.updateProcedure(procedureId, {
			failureCount: proc.failureCount + 1,
			consecutiveSuccesses: 0,
			reliabilityScore: Math.max(0, proc.reliabilityScore - 0.1),
			updatedAt: Date.now(),
		})
	}

	// ── Procedure Evolution ───────────────────────────────────────────────────

	async evolveProcedure(params: {
		procedureId: string
		patch: ProcedurePatch
		triggeringEpisodeId: string
	}): Promise<{
		success: boolean
		newVersion?: ProcedureVersionRecord
		preconditionCheck?: EvolutionPreconditionCheck
	}> {
		const procedure = await this.store.getProcedure(params.procedureId)
		if (!procedure) return { success: false }

		const currentVersion = await this.store.getLatestVersion(params.procedureId)
		if (!currentVersion) return { success: false }

		const preconditionCheck = await this.validatePatch(
			params.patch,
			currentVersion,
			params.triggeringEpisodeId,
		)
		if (!preconditionCheck.overallPass) {
			return { success: false, preconditionCheck }
		}

		const newSteps = this.applyPatch(currentVersion.steps, params.patch)
		if (!newSteps) return { success: false, preconditionCheck }

		const newVersionId = nextId('pver')
		const newVersion = await this.store.createVersion({
			id: newVersionId,
			procedureId: params.procedureId,
			version: currentVersion.version + 1,
			parentVersionId: currentVersion.id,
			steps: newSteps,
			rationale: params.patch.rationale,
			createdFromEpisodeIds: [
				...currentVersion.createdFromEpisodeIds,
				params.triggeringEpisodeId,
			],
			status: 'experimental',
		})

		const newStatus: ProcedureStatus =
			params.patch.actions.some(a => a.type === 'deprecate') ? 'deprecated' : 'experimental'

		await this.store.updateProcedure(params.procedureId, {
			latestVersionId: newVersionId,
			status: newStatus,
			updatedAt: Date.now(),
		})

		return { success: true, newVersion, preconditionCheck }
	}

	// ── Deprecation ───────────────────────────────────────────────────────────

	async deprecateProcedure(
		procedureId: string,
		reason: string,
		mergeTargetId?: string,
	): Promise<void> {
		await this.store.updateProcedure(procedureId, {
			status: 'deprecated',
			updatedAt: Date.now(),
		})
		if (mergeTargetId) {
			// Link the deprecated procedure to the target so retrieval can redirect.
			const proc = await this.store.getProcedure(procedureId)
			if (proc) {
				await this.store.updateProcedure(procedureId, {
					linkedEntities: [...new Set([...proc.linkedEntities, mergeTargetId])],
				})
			}
		}
	}

	// ── Merge Candidate Detection ─────────────────────────────────────────────

	async findMergeCandidates(threshold = 0.6): Promise<MergeCandidate[]> {
		const procedures = await this.store.getAllProcedures()
		const activeProcedures = procedures.filter(p => p.status === 'active' || p.status === 'stable')
		const candidates: MergeCandidate[] = []

		for (let i = 0; i < activeProcedures.length; i++) {
			for (let j = i + 1; j < activeProcedures.length; j++) {
				const a = activeProcedures[i]
				const b = activeProcedures[j]

				const [vA, vB] = await Promise.all([
					this.store.getLatestVersion(a.id),
					this.store.getLatestVersion(b.id),
				])
				if (!vA || !vB) continue

				const stepOverlap = this.computeStepOverlap(vA.steps, vB.steps)
				const entityOverlap = this.computeSetOverlap(a.linkedEntities, b.linkedEntities)
				const similarity = stepOverlap * 0.7 + entityOverlap * 0.3

				if (similarity >= threshold) {
					candidates.push({
						sourceProcedureId: a.id,
						targetProcedureId: b.id,
						sourceVersionId: vA.id,
						targetVersionId: vB.id,
						similarity,
						stepOverlap,
						entityOverlap,
						rationale: `${Math.round(stepOverlap * 100)}% step overlap, ${Math.round(entityOverlap * 100)}% entity overlap`,
					})
				}
			}
		}

		return candidates.sort((a, b) => b.similarity - a.similarity)
	}

	// ── Precondition Validation ───────────────────────────────────────────────

	private async validatePatch(
		patch: ProcedurePatch,
		currentVersion: ProcedureVersionRecord,
		episodeId: string,
	): Promise<EvolutionPreconditionCheck> {
		const checks = {
			patchIsBackwardCompatible: true,
			patchDoesNotDuplicateExistingSteps: true,
			patchReferencesOnlyExistingEntities: true,
			patchHasTestableOutcome: true,
			patchStepCountWithinBounds: true,
			patchDoesNotCreateCircularDependency: true,
		}
		const failureReasons: string[] = []
		const warnings: string[] = []

		for (const action of patch.actions) {
			// 1. Backward compatibility: cannot remove/replace a critical step.
			if (action.type === 'replace_step' || action.type === 'remove_step') {
				const target = currentVersion.steps.find(s => s.id === action.stepId)
				if (target?.isCritical) {
					checks.patchIsBackwardCompatible = false
					failureReasons.push(
						`Cannot replace/remove critical step "${target.name}" - would break dependent workflows`,
					)
				}
			}

			// 2. Duplicate step detection.
			if (action.type === 'insert_step') {
				const duplicate = currentVersion.steps.find(
					s => s.name.toLowerCase() === action.step.name.toLowerCase(),
				)
				if (duplicate) {
					checks.patchDoesNotDuplicateExistingSteps = false
					failureReasons.push(
						`Step "${action.step.name}" duplicates existing step "${duplicate.name}"`,
					)
				}
				const similar = currentVersion.steps.filter(
					s => this.textOverlap(s.name, action.step.name) > 0.3,
				)
				if (similar.length > 0) {
					warnings.push(
						`New step "${action.step.name}" is ${Math.round(this.textOverlap(similar[0].name, action.step.name) * 100)}% similar to "${similar[0].name}"`,
					)
				}
			}

			// 3. Testable outcome.
			if (action.type === 'insert_step' || action.type === 'replace_step') {
				const step = action.type === 'insert_step' ? action.step : action.replacement
				const hasValidation = (step.validationChecks?.length ?? 0) > 0
				const hasPrecondition = (step.preconditions?.length ?? 0) > 0
				const hasOutcome = step.expectedOutcome !== undefined
				if (!hasValidation && !hasPrecondition && !hasOutcome) {
					checks.patchHasTestableOutcome = false
					warnings.push(
						`Step "${step.name}" has no validation check or precondition - consider adding one`,
					)
				}
			}

			// 4. Step count bounds (max 20).
			if (action.type === 'insert_step' || action.type === 'split_procedure') {
				const increment = action.type === 'insert_step' ? 1 : 2
				if (currentVersion.steps.length + increment > 20) {
					checks.patchStepCountWithinBounds = false
					failureReasons.push(
						`Patch would result in ${currentVersion.steps.length + increment} steps, exceeding the maximum of 20`,
					)
				}
			}

			// 5. Circular merge check.
			if (action.type === 'merge_procedure') {
				const targetVersion = await this.store.getLatestVersion(action.sourceProcedureId)
				if (targetVersion) {
					const circular = targetVersion.steps.some(s => s.id === action.sourceProcedureId)
					if (circular) {
						checks.patchDoesNotCreateCircularDependency = false
						failureReasons.push('Merge would create a circular dependency')
					}
				}
			}
		}

		const overallPass = Object.values(checks).every(Boolean) && patch.confidence >= 0.7

		return {
			procedureId: currentVersion.procedureId,
			currentVersionId: currentVersion.id,
			episodeId,
			patch,
			checks,
			overallPass,
			failureReasons,
			confidenceThreshold: 0.7,
			warnings,
		}
	}

	// ── Patch Application ─────────────────────────────────────────────────────

	private applyPatch(steps: ProcedureStep[], patch: ProcedurePatch): ProcedureStep[] | null {
		let current = [...steps]
		for (const action of patch.actions) {
			const next = this.applySingleAction(current, action)
			if (next === null) return null
			current = next
		}
		return current
	}

	private applySingleAction(steps: ProcedureStep[], action: ProcedurePatchAction): ProcedureStep[] | null {
		switch (action.type) {
			case 'insert_step': {
				const newStep = { ...action.step, order: 0 }
				if (!action.afterStepId) {
					return [...steps, { ...newStep, order: steps.length + 1 }]
				}
				const idx = steps.findIndex(s => s.id === action.afterStepId)
				if (idx < 0) return null
				return [...steps.slice(0, idx + 1), newStep, ...steps.slice(idx + 1)]
					.map((s, i) => ({ ...s, order: i + 1 }))
			}

			case 'replace_step': {
				if (!steps.find(s => s.id === action.stepId)) return null
				return steps.map(s =>
					s.id === action.stepId ? { ...action.replacement, order: s.order } : s,
				)
			}

			case 'remove_step':
				if (!steps.find(s => s.id === action.stepId)) return null
				return steps
					.filter(s => s.id !== action.stepId)
					.map((s, i) => ({ ...s, order: i + 1 }))

			case 'reorder_steps': {
				const byId = new Map(steps.map(s => [s.id, s]))
				const reordered = action.orderedStepIds
					.map(id => byId.get(id))
					.filter((s): s is ProcedureStep => s !== undefined)
				if (reordered.length !== steps.length) return null
				return reordered.map((s, i) => ({ ...s, order: i + 1 }))
			}

			case 'add_precondition':
				return steps.map(s =>
					s.id === action.stepId
						? { ...s, preconditions: [...(s.preconditions ?? []), action.precondition] }
						: s,
				)

			case 'remove_precondition':
				return steps.map(s =>
					s.id === action.stepId
						? { ...s, preconditions: (s.preconditions ?? []).filter(p => p !== action.precondition) }
						: s,
				)

			case 'add_validation':
				return steps.map(s =>
					s.id === action.stepId
						? { ...s, validationChecks: [...(s.validationChecks ?? []), action.validation] }
						: s,
				)

			case 'remove_validation':
				return steps.map(s =>
					s.id === action.stepId
						? { ...s, validationChecks: (s.validationChecks ?? []).filter(v => v !== action.validation) }
						: s,
				)

			case 'split_procedure': {
				const splitIdx = steps.findIndex(s => s.id === action.splitAfterStepId)
				if (splitIdx < 0) return null
				return steps.slice(0, splitIdx + 1).map((s, i) => ({ ...s, order: i + 1 }))
			}

			// merge_procedure requires async (fetching target steps) — handled in evolveProcedure.
			case 'merge_procedure':
			case 'deprecate':
				return steps

			default:
				return null
		}
	}

	// ── Similarity Helpers ────────────────────────────────────────────────────

	private computeStepOverlap(a: ProcedureStep[], b: ProcedureStep[]): number {
		if (a.length === 0 || b.length === 0) return 0
		const bNames = new Set(b.map(s => s.name.toLowerCase()))
		const overlap = a.filter(s => bNames.has(s.name.toLowerCase())).length
		return overlap / Math.max(a.length, b.length)
	}

	private computeSetOverlap(a: string[], b: string[]): number {
		if (a.length === 0 || b.length === 0) return 0
		const setB = new Set(b)
		const overlap = a.filter(x => setB.has(x)).length
		return overlap / Math.max(a.length, b.length)
	}

	private textOverlap(a: string, b: string): number {
		const wordsA = new Set(a.toLowerCase().split(/\s+/))
		const wordsB = new Set(b.toLowerCase().split(/\s+/))
		let overlap = 0
		for (const w of wordsA) if (wordsB.has(w)) overlap++
		return overlap / Math.max(wordsA.size, wordsB.size)
	}
}
