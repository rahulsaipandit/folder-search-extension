/**
 * TrajectoryCollector — Phase 1 of the ActionOpt integration.
 *
 * Scores completed agent sessions and enqueues low-scoring ones as 'pending'
 * ActionTrajectoryRecords. The ActionOptimizationWidget drains this queue and
 * feeds the trajectories into the FORGE→TRAIN DAG in WorkflowExecutor.
 *
 * Design: packages/extension/docs/SkillOptDesign.md (Phase 1 — Passive collection)
 */

import {
	getActionTrajectories,
	saveActionTrajectory,
	updateActionTrajectoryStatus,
	type SessionRecord,
	type ActionTrajectoryRecord,
} from '../lib/db'

/** Sessions scoring below this threshold are queued for optimization. */
const LOW_SCORE_THRESHOLD = 7

/**
 * Minimum pending trajectories required before optimizeSkill() is worth running.
 * Prevents optimization on a single anecdote.
 */
export const MIN_TRAJECTORIES_TO_OPTIMIZE = 2

/**
 * Score a completed session on a 0–10 scale using outcome heuristics.
 *
 * Rationale:
 *   error status         → 2: agent crashed; strong learning signal
 *   completed, ≤1 step   → 5: suspiciously brief; task may have been trivial or wrong
 *   completed, 2–4 steps → 7: marginal; room for improvement
 *   completed, 5+ steps  → 9: rich trajectory; likely a good outcome
 *
 * These are intentionally conservative — a score of 7 still queues the trajectory
 * but with lower priority than a crash (score 2).
 */
function scoreSession(session: SessionRecord): number {
	if (session.status === 'error') return 2
	const steps = session.history.length
	if (steps <= 1) return 5
	if (steps <= 4) return 7
	return 9
}

/**
 * Cheap djb2 hash of a string.
 * Used only for deduplication — not cryptographic.
 */
function djb2Hash(s: string): string {
	let h = 5381
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
	return (h >>> 0).toString(16)
}

/**
 * Record a completed session as a trajectory for the given skill.
 *
 * Sessions scoring below LOW_SCORE_THRESHOLD are stored as 'pending' (queued
 * for optimization). Higher-scoring sessions are stored as 'skipped' for audit.
 * Duplicate (sessionId, actionId) pairs are silently ignored.
 *
 * Call this after `finalizeSession()` when the session was driven by a skill:
 *   const session = await getSession(sessionId)
 *   if (session) await recordTrajectory(session, 'some-skill-id')
 */
export async function recordTrajectory(session: SessionRecord, actionId: string): Promise<void> {
	const score = scoreSession(session)
	const trajectoryHash = djb2Hash(`${session.id}:${actionId}`)

	// Dedup: skip if this (session, skill) pair was already recorded
	const existing = await getActionTrajectories(actionId)
	if (existing.some((t) => t.trajectoryHash === trajectoryHash)) return

	const record: ActionTrajectoryRecord = {
		id: crypto.randomUUID(),
		actionId,
		sessionId: session.id,
		score,
		trajectoryHash,
		status: score < LOW_SCORE_THRESHOLD ? 'pending' : 'skipped',
		createdAt: Date.now(),
	}

	await saveActionTrajectory(record)
}

/**
 * Load pending trajectories for a skill, up to maxCount.
 * Returns an empty array when fewer than MIN_TRAJECTORIES_TO_OPTIMIZE are pending,
 * so the caller can skip optimization until more data is available.
 */
export async function getPendingTrajectories(
	actionId: string,
	maxCount = 10,
): Promise<ActionTrajectoryRecord[]> {
	const all = await getActionTrajectories(actionId)
	const pending = all.filter((t) => t.status === 'pending').slice(0, maxCount)
	if (pending.length < MIN_TRAJECTORIES_TO_OPTIMIZE) return []
	return pending
}

/**
 * Mark trajectory records as processed after a successful optimization run.
 * Prevents them from being fed into future FORGE→TRAIN runs.
 */
export async function markTrajectoriesProcessed(ids: string[]): Promise<void> {
	await Promise.all(ids.map((id) => updateActionTrajectoryStatus(id, 'processed')))
}

/**
 * Count pending trajectories for a skill.
 * Used by AgentLibrary to show the optimization badge.
 * Returns 0 if below MIN_TRAJECTORIES_TO_OPTIMIZE (badge is hidden until useful).
 */
export async function getPendingTrajectoryCount(actionId: string): Promise<number> {
	const all = await getActionTrajectories(actionId)
	const count = all.filter((t) => t.status === 'pending').length
	return count >= MIN_TRAJECTORIES_TO_OPTIMIZE ? count : 0
}

/**
 * Build a human-readable summary of a trajectory for FORGE context.
 * Keeps the output compact (one paragraph) to fit multiple trajectories in the prompt.
 */
export function buildTrajectorySummary(
	session: SessionRecord,
	trajectory: ActionTrajectoryRecord,
): string {
	const outcome = session.status === 'error' ? 'crashed' : 'completed'
	const steps = session.history.length
	const snippet = session.task.slice(0, 120)
	return `Session ${trajectory.sessionId} (score ${trajectory.score}/10): task="${snippet}", ${outcome} in ${steps} step(s).`
}
