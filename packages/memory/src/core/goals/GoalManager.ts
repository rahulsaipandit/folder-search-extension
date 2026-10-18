/**
 * GoalManager - CB port of GA's lib/memory/GoalManager.ts
 *
 * Goals are stored as MemoryEntry records with type='goal'.
 * All goal-specific fields live in entry.metadata.goal so the standard
 * cognitive pipeline (salience, entity extraction, etc.) can process them.
 *
 * Key differences from the GA version:
 *  - Persistence is delegated to IMemoryService instead of memsoftstore.
 *  - priority is numeric 1–5 (MemoryEntry.importance) not 'high'|'medium'|'low'.
 *  - initialize() calls memory.initialize() rather than loading a flat JSON blob.
 */

import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry } from '../../types'
import type { Goal, GoalQuery, GoalStatus, GoalOutcome } from './Goal'

// ── Internal helpers ─────────────────────────────────────────────────────────

function generateId(): string {
	return `goal-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/** Extract a Goal from a raw MemoryEntry. Returns null if the entry is not a goal. */
function entryToGoal(entry: MemoryEntry): Goal | null {
	const g = entry.metadata?.goal as Partial<Goal> | undefined
	if (!g) return null
	return {
		...g,
		id: entry.id,
		title: (g.title ?? entry.title) as string,
		description: g.description ?? entry.content ?? undefined,
		status: (g.status ?? 'pending') as GoalStatus,
		priority: g.priority ?? entry.importance ?? 3,
		createdAt: g.createdAt ?? entry.createdAt,
		updatedAt: g.updatedAt ?? entry.updatedAt,
	} as Goal
}

type GoalClosedCallback = (goal: Goal) => void

// ── GoalManager class ────────────────────────────────────────────────────────

export class GoalManager {
	private _initialized = false
	private _lastPersistError: Error | null = null
	private goalClosedCallbacks: GoalClosedCallback[] = []

	private memory: IMemoryService
	constructor(memory: IMemoryService) { this.memory = memory }

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this._initialized) return
		await this.memory.initialize()
		this._initialized = true
	}

	get initialized(): boolean {
		return this._initialized
	}

	get lastPersistError(): Error | null {
		return this._lastPersistError
	}

	get isPersistHealthy(): boolean {
		return this._lastPersistError === null
	}

	private requireInitialized(): void {
		if (!this._initialized) {
			throw new Error('[GoalManager] Not initialized - call initialize() first')
		}
	}

	// ── CRUD ───────────────────────────────────────────────────────────────────

	/**
	 * Create a new goal or upsert an existing one (when goal.id is provided).
	 * Mirrors GA's storeGoal() contract.
	 */
	async storeGoal(goal: Partial<Goal> & { title: string }): Promise<Goal> {
		this.requireInitialized()

		const now = new Date().toISOString()
		const id = goal.id ?? generateId()

		// Check whether an entry with this ID already exists so we can merge.
		let existing: Goal | null = null
		try {
			const entry = await this.memory.get(id)
			if (entry) existing = entryToGoal(entry)
		} catch {
			// not found - treat as new
		}

		const merged: Goal = {
			category: undefined,
			priority: 3,
			status: 'pending' as GoalStatus,
			successCriteria: [],
			...existing,
			...goal,
			id,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		}

		try {
			if (existing) {
				// Update the backing MemoryEntry in-place.
				await this.memory.update(id, {
					title: merged.title,
					content: merged.description ?? '',
					importance: merged.priority,
					tags: ['goal', ...(merged.category ? [merged.category] : [])],
					metadata: { goal: merged },
					updatedAt: now,
				})
			} else {
				// Create a fresh MemoryEntry; the generated ID is embedded in metadata.goal.
				await this.memory.create({
					type: 'goal',
					title: merged.title,
					content: merged.description ?? '',
					importance: merged.priority,
					tags: ['goal', ...(merged.category ? [merged.category] : [])],
					metadata: { goal: merged },
				})
				// Note: memory.create() returns the assigned ID but we pre-generated ours.
				// For stores that ignore our id hint the returned id might differ - callers
				// should use the Goal.id returned from this method, not the raw MemoryEntry id.
			}
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] Persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}

		return merged
	}

	/** createGoal is an alias for storeGoal to match the CB naming convention. */
	async createGoal(goal: Partial<Goal> & { title: string }): Promise<Goal> {
		return this.storeGoal(goal)
	}

	/** List goals, with optional filtering by category, status, and limit. */
	async getGoals(query: GoalQuery = {}): Promise<Goal[]> {
		this.requireInitialized()

		const page = await this.memory.list({
			filter: { type: ['goal'] },
			limit: query.limit && query.limit > 0 ? query.limit : undefined,
			orderBy: 'createdAt',
			order: 'asc',
		})

		let goals: Goal[] = page.items
			.map(entryToGoal)
			.filter((g): g is Goal => g !== null)

		if (query.category) {
			goals = goals.filter(g => g.category === query.category)
		}

		if (query.status) {
			const statusArr = Array.isArray(query.status) ? query.status : [query.status]
			goals = goals.filter(g => statusArr.includes(g.status))
		}

		// Re-apply limit after in-memory filtering (the store limit is a hint only).
		if (query.limit && query.limit > 0) {
			goals = goals.slice(0, query.limit)
		}

		return goals
	}

	/** Retrieve a single goal by its MemoryEntry ID. */
	async getGoal(id: string): Promise<Goal | null> {
		this.requireInitialized()
		const entry = await this.memory.get(id)
		if (!entry) return null
		return entryToGoal(entry)
	}

	/** Apply a partial update to an existing goal. */
	async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
		this.requireInitialized()

		const existing = await this.getGoal(id)
		if (!existing) return null

		const now = new Date().toISOString()
		const updated: Goal = { ...existing, ...updates, id, updatedAt: now }

		try {
			await this.memory.update(id, {
				title: updated.title,
				content: updated.description ?? '',
				importance: updated.priority,
				tags: ['goal', ...(updated.category ? [updated.category] : [])],
				metadata: { goal: updated },
				updatedAt: now,
			})
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] updateGoal persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}

		return updated
	}

	/** Soft-delete a goal by its ID. */
	async deleteGoal(id: string): Promise<void> {
		this.requireInitialized()
		try {
			await this.memory.delete(id)
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] deleteGoal persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}
	}

	/**
	 * Close a goal with an explicit outcome.
	 * Sets status='completed', records outcome and closedAt, then fires
	 * all registered onGoalClosed callbacks (errors in callbacks are swallowed).
	 */
	async closeGoal(
		id: string,
		outcome: GoalOutcome,
		linkedEpisodeId?: string,
	): Promise<Goal | null> {
		this.requireInitialized()

		const now = new Date().toISOString()
		const closed = await this.updateGoal(id, {
			status: 'completed' as GoalStatus,
			outcome,
			closedAt: now,
			...(linkedEpisodeId ? { linkedEpisodeId } : {}),
		})

		if (!closed) return null

		// Fire callbacks - errors must not fail the close operation.
		for (const cb of this.goalClosedCallbacks) {
			try {
				cb(closed)
			} catch (e) {
				console.warn('[GoalManager] onGoalClosed callback error:', e)
			}
		}

		return closed
	}

	// ── Callback bus ───────────────────────────────────────────────────────────

	/**
	 * Register a listener that fires whenever a goal is closed via closeGoal().
	 * Returns a deregistration function (unsubscribe).
	 */
	onGoalClosed(callback: GoalClosedCallback): () => void {
		this.goalClosedCallbacks.push(callback)
		return () => {
			this.goalClosedCallbacks = this.goalClosedCallbacks.filter(cb => cb !== callback)
		}
	}

	/** Remove a previously registered onGoalClosed callback. */
	offGoalClosed(callback: GoalClosedCallback): void {
		this.goalClosedCallbacks = this.goalClosedCallbacks.filter(cb => cb !== callback)
	}

	// ── Convenience ────────────────────────────────────────────────────────────

	/**
	 * Synchronously return all goals from the last list() call.
	 * Not available in CB (no in-memory cache) - included for API parity with GA.
	 * Use getGoals() for a fresh read from the backing store.
	 *
	 * @deprecated Prefer await getGoals() - this method always returns [] in CB.
	 */
	getAllGoals(): Goal[] {
		console.warn(
			'[GoalManager] getAllGoals() is not supported in CB - use await getGoals() instead',
		)
		return []
	}
}

export default GoalManager
