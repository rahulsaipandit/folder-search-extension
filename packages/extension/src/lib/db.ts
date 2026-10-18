import type { HistoricalEvent } from '@page-agent/core'
import type { Skill } from '@page-agent/core/skills'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

const DB_NAME = 'page-agent-ext'
const DB_VERSION = 11

export interface SessionRecord {
	id: string
	task: string
	history: HistoricalEvent[]
	// 'stopped' mirrors the new AgentStatus value introduced by the upstream
	// agent-lifecycle rework (a user-initiated stop is no longer folded into 'error').
	status: 'in_progress' | 'completed' | 'error' | 'stopped'
	createdAt: number
	updatedAt: number
}

export interface FavoriteRecord {
	id: string
	prompt: string
	createdAt: number
	label?: string
}

// ========== WIDGET FRAMEWORK TYPES ==========

export interface WidgetInstance {
	instanceId: string
	widgetId: string
	version: string
	status:
		'idle' | 'running' | 'waiting' | 'scheduled' | 'completed' | 'failed' | 'paused' | 'cancelled'
	currentStep: string | null
	attempt: number
	input: Record<string, unknown>
	state: Record<string, unknown>
	createdAt: number
	updatedAt: number
	lastRunAt: number | null
	nextRunAt: number | null
	// Agent orchestration fields (added v5)
	taskId: string // top-level task; equals instanceId for root agents
	parentInstanceId?: string // parent agent; undefined for root agents
	role: string // 'planner' | 'researcher' | 'aggregator' | 'worker'
	ownedTabId?: number // tab this agent opened; closed by scheduler on completion
	output?: Record<string, unknown> // populated when status = 'completed'
}

export interface TaskScratchpad {
	taskId: string
	key: string
	value: unknown
	updatedAt: number
}

export interface WidgetEvent {
	instanceId: string
	seq: number
	type: string
	stepId: string | null
	ts: number
	payload: Record<string, unknown>
	prevHash: string
	eventHash: string
}

export interface Lease {
	instanceId: string
	ownerId: string
	expiresAt: number
	heartbeatAt: number
}

export interface WorkQueueItem {
	instanceId: string
	priority: number
	nextRunAt: number
}

export interface Signal {
	instanceId: string
	signalName: string
	payload: Record<string, unknown>
	createdAt: number
}

export interface Snapshot {
	snapshotId: string
	instanceId: string
	seq: number
	stateHash: string
	stateJson: string
	createdAt: number
}

export interface TabContext {
	tabId: number
	url: string
	title: string
	lastSeenAt: number
	domHash: string
}

export interface KVMetadata {
	key: string
	value: unknown
	updatedAt: number
}

interface PageAgentDB extends DBSchema {
	sessions: {
		key: string
		value: SessionRecord
		indexes: { 'by-created': number }
	}
	favorites: {
		key: string
		value: FavoriteRecord
		indexes: { 'by-created': number }
	}
	widget_instances: {
		key: 'instanceId'
		value: WidgetInstance
		indexes: {
			'by-status': string
			'by-widgetId': string
			'by-created': number
			'by-taskId': string
			'by-parentId': string
		}
	}
	task_scratchpad: {
		key: [string, string]
		value: TaskScratchpad
		indexes: { 'by-taskId': string }
	}
	widget_events: {
		key: ['instanceId', 'seq']
		value: WidgetEvent
		indexes: {
			'by-type': string
			'by-stepId': string
		}
	}
	work_queue: {
		key: 'nextRunAt'
		value: WorkQueueItem
		indexes: {
			'by-instanceId': string
			'by-priority': number
		}
	}
	leases: {
		key: 'instanceId'
		value: Lease
		indexes: {
			'by-expiresAt': number
			'by-owner': string
		}
	}
	signals: {
		key: ['instanceId', 'signalName']
		value: Signal
		indexes: {
			'by-createdAt': number
		}
	}
	snapshots: {
		key: 'snapshotId'
		value: Snapshot
		indexes: {
			'by-instanceId': string
			'by-seq': number
		}
	}
	tab_context: {
		key: 'tabId'
		value: TabContext
		indexes: {
			'by-lastSeenAt': number
		}
	}
	kv_metadata: {
		key: 'key'
		value: KVMetadata
	}
	// v7: ActionOpt integration — trajectory collection and optimization results
	skill_trajectories: {
		key: string
		value: ActionTrajectoryRecord
		indexes: {
			'by-actionId': string
			'by-status': string
			'by-created': number
		}
	}
	skill_training_records: {
		key: string
		value: ActionTrainingRecord
		indexes: {
			'by-actionId': string
			'by-accepted': number
			'by-created': number
		}
	}
	user_skills: {
		key: string
		value: Skill
		indexes: { 'by-name': string; 'by-tags': string }
	}
}

let dbPromise: Promise<IDBPDatabase<PageAgentDB>> | null = null

export function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<PageAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, _newVersion, transaction) {
				// The database version was historically held at 1 while stores were added
				// in later migrations. Leave retired stores in existing databases so local
				// data is preserved; create only stores still used by the extension.

				if (oldVersion < 1) {
					const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' })
					sessionStore.createIndex('by-created', 'createdAt')
				}
				if (oldVersion < 2 && !db.objectStoreNames.contains('favorites')) {
					const favoriteStore = db.createObjectStore('favorites', { keyPath: 'id' })
					favoriteStore.createIndex('by-created', 'createdAt')
				}
				if (oldVersion < 4 && !db.objectStoreNames.contains('widget_instances')) {
					// Widget Framework Stores
					const widgetInstances = db.createObjectStore('widget_instances', {
						keyPath: 'instanceId',
					})
					widgetInstances.createIndex('by-status', 'status')
					widgetInstances.createIndex('by-widgetId', 'widgetId')
					widgetInstances.createIndex('by-created', 'createdAt')

					const widgetEvents = db.createObjectStore('widget_events', {
						keyPath: ['instanceId', 'seq'],
					})
					widgetEvents.createIndex('by-type', 'type')
					widgetEvents.createIndex('by-stepId', 'stepId')

					const workQueue = db.createObjectStore('work_queue', { keyPath: 'nextRunAt' })
					workQueue.createIndex('by-instanceId', 'instanceId')
					workQueue.createIndex('by-priority', 'priority')

					const leases = db.createObjectStore('leases', { keyPath: 'instanceId' })
					leases.createIndex('by-expiresAt', 'expiresAt')
					leases.createIndex('by-owner', 'ownerId')

					const signals = db.createObjectStore('signals', { keyPath: ['instanceId', 'signalName'] })
					signals.createIndex('by-createdAt', 'createdAt')

					const snapshots = db.createObjectStore('snapshots', { keyPath: 'snapshotId' })
					snapshots.createIndex('by-instanceId', 'instanceId')
					snapshots.createIndex('by-seq', 'seq')

					const tabContext = db.createObjectStore('tab_context', { keyPath: 'tabId' })
					tabContext.createIndex('by-lastSeenAt', 'lastSeenAt')

					db.createObjectStore('kv_metadata', { keyPath: 'key' })
				}
				if (oldVersion < 5 && !db.objectStoreNames.contains('task_scratchpad')) {
					// Add orchestration indexes to existing widget_instances store
					const widgetStore = (transaction as any).objectStore('widget_instances')
					widgetStore.createIndex('by-taskId', 'taskId')
					widgetStore.createIndex('by-parentId', 'parentInstanceId')

					// Task-scoped shared memory between agents in the same tree
					const scratchpad = db.createObjectStore('task_scratchpad', { keyPath: ['taskId', 'key'] })
					scratchpad.createIndex('by-taskId', 'taskId')
				}
				if (oldVersion < 7) {
					// v7: ActionOpt integration — stores failure trajectories linked to skill IDs
					// and the resulting optimization records produced by the FORGE→TRAIN DAG.
					const trajectories = db.createObjectStore('skill_trajectories', { keyPath: 'id' })
					trajectories.createIndex('by-actionId', 'skillId')
					trajectories.createIndex('by-status', 'status')
					trajectories.createIndex('by-created', 'createdAt')

					const training = db.createObjectStore('skill_training_records', { keyPath: 'id' })
					training.createIndex('by-actionId', 'skillId')
					training.createIndex('by-accepted', 'accepted')
					training.createIndex('by-created', 'createdAt')
				}
				if (oldVersion < 8) {
					// v8: SkillFramework — user-authored LLM instruction packages stored per the
					// Agent Skills / SKILL.md open standard. Separate from src/actions/ (typed,
					// Zod-validated, executable TypeScript functions).
					const skillsStore = db.createObjectStore('user_skills', { keyPath: 'id' })
					skillsStore.createIndex('by-name', 'name', { unique: true })
					skillsStore.createIndex('by-tags', 'tags', { multiEntry: true })
				}
			},
		})
	}
	return dbPromise
}

/** Create a session at task start, persisted immediately as in_progress */
export async function createSession(task: string): Promise<SessionRecord> {
	const db = await getDB()
	const now = Date.now()
	const record: SessionRecord = {
		id: crypto.randomUUID(),
		task,
		history: [],
		status: 'in_progress',
		createdAt: now,
		updatedAt: now,
	}
	await db.put('sessions', record)
	return record
}

/** Incrementally persist history after each step */
export async function updateSession(id: string, history: HistoricalEvent[]): Promise<void> {
	const db = await getDB()
	const existing = await db.get('sessions', id)
	if (!existing) return
	await db.put('sessions', { ...existing, history, updatedAt: Date.now() })
}

/** Mark session as completed, errored, or user-stopped when done */
export async function finalizeSession(
	id: string,
	status: 'completed' | 'error' | 'stopped'
): Promise<void> {
	const db = await getDB()
	const existing = await db.get('sessions', id)
	if (!existing) return
	await db.put('sessions', { ...existing, status, updatedAt: Date.now() })
}

/** Finalize all in_progress sessions as error (called on startup when agent is not running) */
export async function cleanupStaleSessions(): Promise<void> {
	const db = await getDB()
	const all = await db.getAllFromIndex('sessions', 'by-created')
	const stale = all.filter((s) => s.status === 'in_progress')
	await Promise.all(
		stale.map((s) => db.put('sessions', { ...s, status: 'error', updatedAt: Date.now() }))
	)
}

/** @deprecated Use createSession + finalizeSession instead */
export async function saveSession(
	session: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<SessionRecord> {
	const db = await getDB()
	const now = Date.now()
	const record: SessionRecord = {
		...session,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	}
	await db.put('sessions', record)
	return record
}

/** List sessions, newest first */
export async function listSessions(): Promise<SessionRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('sessions', 'by-created')
	return all.reverse()
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
	const db = await getDB()
	return db.get('sessions', id)
}

export async function deleteSession(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('sessions', id)
}

export async function clearSessions(): Promise<void> {
	const db = await getDB()
	await db.clear('sessions')
}

// ============== Favorites ==============

export async function saveFavorite(prompt: string, label?: string): Promise<FavoriteRecord> {
	const db = await getDB()
	const record: FavoriteRecord = {
		id: crypto.randomUUID(),
		prompt,
		createdAt: Date.now(),
		label,
	}
	await db.put('favorites', record)
	return record
}

/** List favorites, newest first */
export async function listFavorites(): Promise<FavoriteRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('favorites', 'by-created')
	return all.reverse()
}

export async function getFavorite(id: string): Promise<FavoriteRecord | undefined> {
	const db = await getDB()
	return db.get('favorites', id)
}

export async function deleteFavorite(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('favorites', id)
}

export async function clearFavorites(): Promise<void> {
	const db = await getDB()
	await db.clear('favorites')
}

/** Check if a prompt is already favorited */
export async function isFavorite(prompt: string): Promise<boolean> {
	const db = await getDB()
	const all = await db.getAll('favorites')
	return all.some((f) => f.prompt === prompt)
}

/** Remove a favorite by prompt text */
export async function removeFavoriteByPrompt(prompt: string): Promise<void> {
	const db = await getDB()
	const all = await db.getAll('favorites')
	const found = all.find((f) => f.prompt === prompt)
	if (found) {
		await db.delete('favorites', found.id)
	}
}

// ============== Agent Orchestration ==============

/** All instances belonging to a task tree (same taskId) */
export async function getTaskTree(rootInstanceId: string): Promise<WidgetInstance[]> {
	const db = await getDB()
	try {
		return await db.getAllFromIndex('widget_instances', 'by-taskId', rootInstanceId)
	} catch {
		// Index may not exist for old DB versions opened before migration
		const all = await db.getAll('widget_instances')
		return all.filter((i) => (i.taskId ?? i.instanceId) === rootInstanceId)
	}
}

/** All child instances of a given parent */
export async function getChildInstances(parentInstanceId: string): Promise<WidgetInstance[]> {
	const db = await getDB()
	try {
		return await db.getAllFromIndex('widget_instances', 'by-parentId', parentInstanceId)
	} catch {
		const all = await db.getAll('widget_instances')
		return all.filter((i) => i.parentInstanceId === parentInstanceId)
	}
}

/** All instances across all tasks */
export async function getAllInstances(): Promise<WidgetInstance[]> {
	const db = await getDB()
	return db.getAll('widget_instances')
}

/** Read a value from the task-scoped shared scratchpad */
export async function readTaskScratchpad(taskId: string, key: string): Promise<unknown> {
	const db = await getDB()
	const entry = await db.get('task_scratchpad', [taskId, key])
	return entry?.value ?? null
}

/** Write a value to the task-scoped shared scratchpad */
export async function writeTaskScratchpad(
	taskId: string,
	key: string,
	value: unknown
): Promise<void> {
	const db = await getDB()
	await db.put('task_scratchpad', { taskId, key, value, updatedAt: Date.now() })
}

/** Read all scratchpad entries for a task */
export async function readAllTaskScratchpad(taskId: string): Promise<TaskScratchpad[]> {
	const db = await getDB()
	try {
		return await db.getAllFromIndex('task_scratchpad', 'by-taskId', taskId)
	} catch {
		return []
	}
}

// ============== Skill Optimization (SkillOpt integration) ==============
// See: packages/extension/docs/SkillOptDesign.md

/**
 * A single bounded text edit proposed by the TRAIN archetype.
 * Targets only natural-language fields of an ActionDefinition (never execute()).
 */
export interface ActionDocEdit {
	type: 'replace' | 'append' | 'delete'
	/** Which ActionDefinition field the edit targets. */
	target: 'instructionDoc' | 'triggers' | 'description'
	before: string
	after: string
	/** TRAIN's justification citing a specific trajectory or FORGE finding. */
	rationale: string
}

/**
 * A completed agent session linked to an action, scored and queued for optimization.
 * Sessions scoring below LOW_SCORE_THRESHOLD in TrajectoryCollector become 'pending'.
 */
export interface ActionTrajectoryRecord {
	id: string
	actionId: string
	sessionId: string
	/** Heuristic score 0–10 assigned by TrajectoryCollector based on session outcome. */
	score: number
	/** djb2 hash of sessionId+skillId for deduplication. */
	trajectoryHash: string
	/** Pending trajectories are queued for the next optimization run. */
	status: 'pending' | 'processed' | 'skipped'
	createdAt: number
	processedAt?: number
}

/**
 * The result of one optimization run for an action.
 * Proposed edits are stored here for user review (Phase 2) or auto-validation (Phase 3).
 */
export interface ActionTrainingRecord {
	id: string
	actionId: string
	/** IDs of ActionTrajectoryRecords that fed this run. */
	sourceTrajectoryIds: string[]
	/** The full proposed instructionDoc after applying edits. */
	proposedInstructionDoc: string
	/** Individual bounded edits proposed by TRAIN. */
	edits: ActionDocEdit[]
	/** Aggregate FORGE confidence score (0–10) for the failure patterns. */
	forgeScore?: number
	/** Validation score on the representative task batch before the edit. */
	validationScoreBefore?: number
	/** Validation score after applying the proposed edits. */
	validationScoreAfter?: number
	/** True once the edits have been applied to the live ActionDefinition. */
	accepted: boolean
	createdAt: number
	acceptedAt?: number
}

/** Persist a scored trajectory record for an action. Called by TrajectoryCollector. */
export async function saveActionTrajectory(record: ActionTrajectoryRecord): Promise<void> {
	const db = await getDB()
	await db.put('skill_trajectories', record)
}

/** Retrieve all trajectory records for an action, sorted by creation time (newest first). */
export async function getActionTrajectories(actionId: string): Promise<ActionTrajectoryRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('skill_trajectories', 'by-actionId', actionId)
	return all.sort((a, b) => b.createdAt - a.createdAt)
}

/** Update a trajectory's status (e.g. pending → processed after optimization). */
export async function updateActionTrajectoryStatus(
	id: string,
	status: ActionTrajectoryRecord['status']
): Promise<void> {
	const db = await getDB()
	const existing = await db.get('skill_trajectories', id)
	if (!existing) return
	await db.put('skill_trajectories', {
		...existing,
		status,
		...(status === 'processed' ? { processedAt: Date.now() } : {}),
	})
}

/** Persist an optimization result. Called by ActionOptimizationWidget after TRAIN runs. */
export async function saveActionTrainingRecord(record: ActionTrainingRecord): Promise<void> {
	const db = await getDB()
	await db.put('skill_training_records', record)
}

/** Retrieve all training records for an action, sorted by creation time (newest first). */
export async function getActionTrainingRecords(actionId: string): Promise<ActionTrainingRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('skill_training_records', 'by-actionId', actionId)
	return all.sort((a, b) => b.createdAt - a.createdAt)
}

/** Mark a training record as accepted and record the acceptance timestamp. */
export async function acceptActionTrainingRecord(id: string): Promise<void> {
	const db = await getDB()
	const existing = await db.get('skill_training_records', id)
	if (!existing) return
	await db.put('skill_training_records', { ...existing, accepted: true, acceptedAt: Date.now() })
}
