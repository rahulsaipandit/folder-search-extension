/**
 * Goal management skills for the Cognitive Brain skill registry.
 * These skills delegate directly to GoalManager - no LLM fallback needed.
 *
 * IDs follow the org.cognitive-brain.goals.* namespace to distinguish
 * CB-native skills from the original org.page-agent.* set.
 *
 * Schemas are hand-rolled (parse + safeParse) to match the pattern used by
 * compute.ts, time.ts, etc. - avoids a hard runtime dep on zod until the
 * package has its node_modules fully installed.
 */

import type { ActionDefinition, ActionContext } from '../../interfaces/IActionRegistry'
import type { GoalStatus, GoalOutcome } from '../../core/goals/Goal'

// ── Schema factory ────────────────────────────────────────────────────────────

/** Wrap a validator function into the duck-typed schema shape required by ActionDefinition. */
function makeSchema<T>(validator: (v: unknown) => T) {
	return {
		parse(input: unknown): T {
			return validator(input)
		},
		safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown } {
			try {
				return { success: true as const, data: validator(input) }
			} catch (e) {
				return { success: false as const, error: e }
			}
		},
	}
}

// ── Shared validation helpers ─────────────────────────────────────────────────

const VALID_STATUSES: GoalStatus[] = ['pending', 'in_progress', 'completed', 'paused']
const VALID_OUTCOMES: GoalOutcome[] = ['success', 'failure']

function assertString(v: unknown, field: string): string {
	if (typeof v !== 'string' || v.length === 0) throw new Error(`${field} must be a non-empty string`)
	return v
}

function optionalString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined
}

function optionalStringArray(v: unknown): string[] | undefined {
	if (v === undefined || v === null) return undefined
	if (Array.isArray(v)) return v.map(String)
	return undefined
}

function optionalInt(v: unknown, min: number, max: number): number | undefined {
	if (v === undefined || v === null) return undefined
	const n = Number(v)
	if (!Number.isInteger(n) || n < min || n > max)
		throw new Error(`Expected integer between ${min} and ${max}`)
	return n
}

function requireObject(v: unknown): Record<string, unknown> {
	if (typeof v !== 'object' || v === null || Array.isArray(v))
		throw new Error('Expected a plain object')
	return v as Record<string, unknown>
}

// ── Input / Output types ──────────────────────────────────────────────────────

export interface GoalCreateInput {
	title: string
	description?: string
	priority?: number
	category?: string
	targetDate?: string
	successCriteria?: string[]
}

export interface GoalCreateOutput {
	goalId: string
	goal: unknown
}

export interface GoalListInput {
	status?: GoalStatus
}

export interface GoalListOutput {
	goals: unknown[]
}

export interface GoalCloseInput {
	id: string
	outcome: GoalOutcome
	linkedEpisodeId?: string
}

export interface GoalCloseOutput {
	goal: unknown
}

export interface GoalGetInput {
	id: string
}

export interface GoalGetOutput {
	goal: unknown | null
}

// ── Input / Output schemas ────────────────────────────────────────────────────

const createInputSchema = makeSchema<GoalCreateInput>((v) => {
	const o = requireObject(v)
	return {
		title:           assertString(o.title, 'title'),
		description:     optionalString(o.description),
		priority:        optionalInt(o.priority, 1, 5),
		category:        optionalString(o.category),
		targetDate:      optionalString(o.targetDate),
		successCriteria: optionalStringArray(o.successCriteria),
	}
})

const createOutputSchema = makeSchema<GoalCreateOutput>((v) => v as GoalCreateOutput)

const listInputSchema = makeSchema<GoalListInput>((v) => {
	const o = requireObject(v)
	const status = optionalString(o.status) as GoalStatus | undefined
	if (status !== undefined && !VALID_STATUSES.includes(status)) {
		throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`)
	}
	return { status }
})

const listOutputSchema = makeSchema<GoalListOutput>((v) => v as GoalListOutput)

const closeInputSchema = makeSchema<GoalCloseInput>((v) => {
	const o = requireObject(v)
	const outcome = assertString(o.outcome, 'outcome') as GoalOutcome
	if (!VALID_OUTCOMES.includes(outcome)) {
		throw new Error(`outcome must be one of: ${VALID_OUTCOMES.join(', ')}`)
	}
	return {
		id:              assertString(o.id, 'id'),
		outcome,
		linkedEpisodeId: optionalString(o.linkedEpisodeId),
	}
})

const closeOutputSchema = makeSchema<GoalCloseOutput>((v) => v as GoalCloseOutput)

const getInputSchema = makeSchema<GoalGetInput>((v) => {
	const o = requireObject(v)
	return { id: assertString(o.id, 'id') }
})

const getOutputSchema = makeSchema<GoalGetOutput>((v) => v as GoalGetOutput)

// ── Skill definitions ─────────────────────────────────────────────────────────

export const goalCreateAction: ActionDefinition<GoalCreateInput, GoalCreateOutput> = {
	id:           'org.cognitive-brain.goals.create',
	name:         'goals.create',
	description:  'Create a new goal in the Cognitive Brain goal store.',
	version:      '1.0.0',
	category:     'goals',
	capabilities: [],
	inputSchema:  createInputSchema,
	outputSchema: createOutputSchema,
	fallbackToLLM: false,
	timeoutMs:     5_000,
	userInvocable: true,

	async execute(input, ctx: ActionContext): Promise<GoalCreateOutput> {
		const gm = ctx.goalManager
		if (!gm) throw new Error('[goals.create] GoalManager not available in ActionContext')
		const goal = await gm.createGoal({
			title:           input.title,
			description:     input.description,
			priority:        input.priority,
			category:        input.category,
			targetDate:      input.targetDate,
			successCriteria: input.successCriteria,
		})
		return { goalId: goal.id, goal }
	},
}

export const goalListAction: ActionDefinition<GoalListInput, GoalListOutput> = {
	id:           'org.cognitive-brain.goals.list',
	name:         'goals.list',
	description:  'List goals from the Cognitive Brain goal store, optionally filtered by status.',
	version:      '1.0.0',
	category:     'goals',
	capabilities: [],
	inputSchema:  listInputSchema,
	outputSchema: listOutputSchema,
	fallbackToLLM: false,
	timeoutMs:     5_000,
	userInvocable: true,

	async execute(input, ctx: ActionContext): Promise<GoalListOutput> {
		const gm = ctx.goalManager
		if (!gm) throw new Error('[goals.list] GoalManager not available in ActionContext')
		const goals = await gm.getGoals(
			input.status ? { status: input.status } : {},
		)
		return { goals }
	},
}

export const goalCloseAction: ActionDefinition<GoalCloseInput, GoalCloseOutput> = {
	id:           'org.cognitive-brain.goals.close',
	name:         'goals.close',
	description:  'Close a goal with a final outcome (success or failure).',
	version:      '1.0.0',
	category:     'goals',
	capabilities: [],
	inputSchema:  closeInputSchema,
	outputSchema: closeOutputSchema,
	fallbackToLLM: false,
	timeoutMs:     5_000,
	userInvocable: true,

	async execute(input, ctx: ActionContext): Promise<GoalCloseOutput> {
		const gm = ctx.goalManager
		if (!gm) throw new Error('[goals.close] GoalManager not available in ActionContext')
		const goal = await gm.closeGoal(input.id, input.outcome, input.linkedEpisodeId)
		if (!goal) throw new Error(`[goals.close] Goal not found: ${input.id}`)
		return { goal }
	},
}

export const goalGetAction: ActionDefinition<GoalGetInput, GoalGetOutput> = {
	id:           'org.cognitive-brain.goals.get',
	name:         'goals.get',
	description:  'Retrieve a single goal by its ID.',
	version:      '1.0.0',
	category:     'goals',
	capabilities: [],
	inputSchema:  getInputSchema,
	outputSchema: getOutputSchema,
	fallbackToLLM: false,
	timeoutMs:     5_000,
	userInvocable: true,

	async execute(input, ctx: ActionContext): Promise<GoalGetOutput> {
		const gm = ctx.goalManager
		if (!gm) throw new Error('[goals.get] GoalManager not available in ActionContext')
		const goal = await gm.getGoal(input.id)
		return { goal }
	},
}
