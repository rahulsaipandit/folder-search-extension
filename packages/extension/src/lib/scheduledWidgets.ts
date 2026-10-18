import { defineWidget, z } from './widgetRuntime'
import { getPendingTrajectories, markTrajectoriesProcessed, buildTrajectorySummary } from '../actions/TrajectoryCollector'
import { getSession, saveActionTrainingRecord, type ActionTrainingRecord } from './db'

export const GenericTaskWidget = defineWidget({
	id: 'org.page-agent.generic-task',
	name: 'Agent Task',
	version: '1.0.0',
	description: 'Generic user submitted task',
	capabilities: ['tabs.query', 'tab.read', 'tab.interact', 'llm.completion'],
	input: z.object({
		task: z.string(),
	}),
	steps: {
		execute: async (ctx) => {
			const task = ctx.input.task as string
			console.log('[GenericTaskWidget] Executing task:', task)
			await new Promise((resolve) => setTimeout(resolve, 1000))
			return {
				executedTask: task,
				completedAt: new Date().toISOString(),
				result: 'Task completed successfully',
			}
		},
	},
})

/**
 * ActionOptimizationWidget — Phase 2 of the ActionOpt integration.
 *
 * Drains pending ActionTrajectoryRecords for a given actionId, runs the
 * FORGE→TRAIN optimization DAG via a chrome.runtime message, and persists
 * the resulting ActionTrainingRecord for user review in AgentLibrary.
 *
 * Triggered manually from AgentLibrary (Phase 2: "Optimize" button) or
 * automatically on an interval (Phase 3: daily background run).
 *
 * The widget itself only prepares trajectory context and fires the message.
 * The actual WorkflowExecutor.optimizeSkill() call happens in the background
 * script (SKILL_OPTIMIZE_DUE handler) where the LLM config is available.
 *
 * See: packages/extension/docs/SkillOptDesign.md
 */
export const ActionOptimizationWidget = defineWidget({
	id: 'org.page-agent.action-optimizer',
	name: 'Action Optimizer',
	version: '1.0.0',
	description: 'Optimizes action instructionDocs from failure trajectories via FORGE→TRAIN',
	capabilities: ['llm.completion'],
	input: z.object({
		actionId: z.string(),
		/** Optional current instructionDoc to improve. Passed through to TRAIN. */
		currentInstructionDoc: z.string().optional(),
	}),
	steps: {
		collectTrajectories: async (ctx) => {
			const { actionId } = ctx.input as { actionId: string; currentInstructionDoc?: string }

			// Load pending trajectories and enrich with session summaries
			const trajectories = await getPendingTrajectories(actionId)
			if (trajectories.length === 0) {
				ctx.state.skipped = true
				ctx.state.reason = 'Not enough pending trajectories'
				return
			}

			// Hydrate each trajectory with its session for summary generation
			const enriched = await Promise.all(
				trajectories.map(async (t) => {
					const session = await getSession(t.sessionId)
					return {
						trajectoryId: t.id,
						sessionId: t.sessionId,
						score: t.score,
						actionId: t.actionId,
						sessionSummary: session ? buildTrajectorySummary(session, t) : undefined,
					}
				}),
			)

			// Store enriched trajectories in widget state for the optimize step
			ctx.state.trajectoryIds = trajectories.map((t) => t.id)
			ctx.state.enrichedTrajectories = enriched
		},

		optimize: async (ctx) => {
			if (ctx.state.skipped) return

			const { actionId, currentInstructionDoc } = ctx.input as {
				actionId: string
				currentInstructionDoc?: string
			}
			const trajectoryIds = ctx.state.trajectoryIds as string[]
			const enrichedTrajectories = ctx.state.enrichedTrajectories as Array<{
				trajectoryId: string
				sessionId: string
				score: number
				actionId: string
				sessionSummary?: string
			}>

			try {
				// Request optimization from the background script, which has access to
				// WorkflowExecutor and the user's LLM config
				const response: { edits?: unknown[]; forgeScore?: number; rawOutput?: string } | null =
					await (globalThis as any).chrome?.runtime?.sendMessage({
						type: 'SKILL_OPTIMIZE_DUE',
						actionId,
						currentInstructionDoc,
						trajectories: enrichedTrajectories,
					})

				if (response?.edits) {
					// Persist the training record so AgentLibrary can surface it for review
					const record: ActionTrainingRecord = {
						id: crypto.randomUUID(),
						actionId,
						sourceTrajectoryIds: trajectoryIds,
						proposedInstructionDoc: currentInstructionDoc ?? '',
						edits: (response.edits ?? []) as ActionTrainingRecord['edits'],
						forgeScore: response.forgeScore,
						accepted: false,
						createdAt: Date.now(),
					}
					await saveActionTrainingRecord(record)

					// Mark source trajectories as processed so they won't re-queue
					await markTrajectoriesProcessed(trajectoryIds)
					ctx.state.trainingRecordId = record.id
				}
			} catch {
				// Background script unavailable (sidepanel closed during optimization).
				// Trajectories remain pending and will be retried on the next run.
			}
		},
	},
})

