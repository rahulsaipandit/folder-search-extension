/**
 * Goal domain types for the Cognitive Brain memory platform.
 * Ported from GA's lib/memory/GoalManager.ts - priority is now numeric (1–5)
 * to align with MemoryEntry.importance, and category is optional.
 */

// ── Status / Outcome enums ────────────────────────────────────────────────────

export type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'paused'

export type GoalOutcome = 'success' | 'failure'

// ── Goal interface ────────────────────────────────────────────────────────────

export interface Goal {
	/** Stable identifier - matches the MemoryEntry.id that backs this goal. */
	id: string

	/** Short human-readable title. */
	title: string

	/** Optional longer description. */
	description?: string

	/** Workflow/lifecycle state. */
	status: GoalStatus

	/**
	 * Static importance score, 1 (lowest) – 5 (highest).
	 * Stored as MemoryEntry.importance so the pipeline can use it for salience.
	 */
	priority: number // 1–5

	/** Optional user-defined grouping tag (e.g. 'health', 'career'). */
	category?: string

	/** Free-text or structured acceptance criteria. */
	successCriteria?: string[]

	/** ISO-8601 target completion date. */
	targetDate?: string

	/** ISO-8601 creation timestamp. */
	createdAt: string

	/** ISO-8601 last-update timestamp. */
	updatedAt?: string

	/** Set when the goal is closed via closeGoal(). */
	outcome?: GoalOutcome

	/** ISO-8601 timestamp when the goal was closed. */
	closedAt?: string

	/** MemoryEntry ID of the episodic entry that triggered goal closure. */
	linkedEpisodeId?: string

	/** MemoryEntry ID of the procedure learned from this goal. */
	procedureId?: string

	/** Arbitrary extra fields - preserved for forward-compat with GA consumers. */
	[key: string]: unknown
}

// ── Query helper ─────────────────────────────────────────────────────────────

export interface GoalQuery {
	limit?: number
	category?: string
	status?: GoalStatus | GoalStatus[]
}
