import { z } from 'zod'

import { getDB, readTaskScratchpad, writeTaskScratchpad } from './db'
import type { WidgetEvent, WidgetInstance } from './db'
import { acquireLease, releaseLease } from './leaseManager'
import { getWidgetLLMBridge } from './widgetLLMBridge'
import { getAdvancedTools } from './advancedTools'
import { globalActionExecutionEngine } from '../actions'

declare const chrome: any

export { z }

export type { WidgetInstance }

const STEP_TIMEOUT = 30000
const MAX_RETRIES = 5

export type StepHandler = (ctx: WidgetContext) => Promise<unknown>

export interface SpawnRequest {
  role: string
  widgetId: string
  input: Record<string, unknown>
}

export interface WidgetDefinition {
	id: string
	name: string
	version: string
	description: string
	capabilities: string[]
	input: z.ZodType
	steps: Record<string, StepHandler>
}

export interface WidgetContext {
  instanceId: string
  state: Record<string, unknown>
  input: Record<string, unknown>
  browser: {
    tabs: {
      query: (filter: Record<string, unknown>) => Promise<unknown[]>
      create: (createProperties: { url?: string, active?: boolean }) => Promise<unknown>
      update: (tabId: number, updateProperties: { url?: string, active?: boolean }) => Promise<unknown>
      remove: (tabId: number) => Promise<boolean>
    }
    windows: {
      getAll: () => Promise<unknown[]>
    }
  }
  page: {
    extract: (opts: { tabId: number }) => Promise<string>
    clickElement: (tabId: number, index: number) => Promise<unknown>
    inputText: (tabId: number, index: number, text: string) => Promise<unknown>
    scroll: (tabId: number, direction: 'up' | 'down', numPages?: number) => Promise<unknown>
  }
  llm: {
    complete: (prompt: string) => Promise<string>
    extract: <T>(content: string, schema: z.ZodType<T>) => Promise<T>
  }
  storage: {
    put: (key: string, value: unknown) => Promise<void>
    get: (key: string) => Promise<unknown>
  }
  timer: {
    wait: (durationMs: number) => Promise<void>
    schedule: (timestamp: number) => Promise<void>
    cron: (expression: string) => Promise<void>
  }
  signals: {
    wait: (signalName: string) => Promise<unknown>
    send: (instanceId: string, signalName: string, payload?: Record<string, unknown>) => Promise<void>
  }
  tools: {
    executeBash: (command: string, cwd?: string) => Promise<{ stdout: string, stderr: string, exitCode: number }>
    readFile: (path: string) => Promise<Uint8Array>
    readFileAsText: (path: string) => Promise<string>
    writeFile: (path: string, content: Uint8Array | string) => Promise<void>
    listFiles: (path?: string) => Promise<string[]>
    deleteFile: (path: string) => Promise<void>
    fileExists: (path: string) => Promise<boolean>
    getFileInfo: (path: string) => Promise<{ size: number; lastModified: number } | null>
    fetchUrl: (url: string, options?: RequestInit) => Promise<{ status: number, headers: Record<string, string>, body: string }>
    updateMemory: (key: string, content: string) => Promise<void>
    readMemory: (key: string) => Promise<string | null>
  }
  /** Spawn parallel child agents. Returns their instanceIds. */
  spawn: (requests: SpawnRequest[]) => Promise<string[]>
  /**
   * Collect outputs from child agents. Suspends until all are complete.
   * Re-entrant: safe to call again after resuming from a collect pause.
   */
  collect: (childInstanceIds: string[]) => Promise<Array<Record<string, unknown>>>
  /** Task-scoped shared memory readable and writable by any agent in the same task tree. */
  taskMemory: {
    read: (key: string) => Promise<unknown>
    write: (key: string, value: unknown) => Promise<void>
  }
  skills: {
    invoke: (actionId: string, input: Record<string, unknown>) => Promise<unknown>
  }
}

// Thrown inside a step to pause execution until a timer fires
class TimerPauseSignal extends Error {
  readonly nextRunAt: number
  constructor(nextRunAt: number) {
    super('TIMER_PAUSE')
    this.name = 'TimerPauseSignal'
    this.nextRunAt = nextRunAt
  }
}

// Thrown inside a step to pause execution until a named signal arrives
class SignalPauseSignal extends Error {
  readonly signalName: string
  constructor(signalName: string) {
    super('SIGNAL_PAUSE')
    this.name = 'SignalPauseSignal'
    this.signalName = signalName
  }
}

// Thrown inside a step to pause execution until all child agents complete
class CollectPauseSignal extends Error {
  readonly childInstanceIds: string[]
  constructor(childInstanceIds: string[]) {
    super('COLLECT_PAUSE')
    this.name = 'CollectPauseSignal'
    this.childInstanceIds = childInstanceIds
  }
}

export async function hashEvent(seq: number, type: string, payload: unknown, prevHash: string): Promise<string> {
  const data = JSON.stringify({ seq, type, payload, prevHash })
  const encoded = new TextEncoder().encode(data)
  const buf = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)
    ),
  ])
}

function calculateBackoff(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 60000)
}

function parseDowSet(dowPart: string): Set<number> {
  const days = new Set<number>()
  for (const segment of dowPart.split(',')) {
    if (segment.includes('-')) {
      const [a, b] = segment.split('-').map(Number)
      for (let d = a; d <= b; d++) days.add(d % 7)
    } else {
      days.add(Number(segment) % 7)
    }
  }
  return days
}

function parseCronNext(expression: string): number {
  // Parses minute, hour (fields 0-1) and day-of-week (field 4).
  // Sufficient for all schedule types the UI generates.
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) return Date.now() + 3_600_000

  const [minutePart, hourPart, , , dowPart] = parts
  const minute = minutePart === '*' ? 0 : parseInt(minutePart, 10)
  const hour = hourPart === '*' ? -1 : parseInt(hourPart, 10)

  const now = new Date()
  const next = new Date(now)

  if (hour >= 0 && !isNaN(hour)) {
    next.setHours(hour, isNaN(minute) ? 0 : minute, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  } else {
    next.setHours(now.getHours() + 1, isNaN(minute) ? 0 : minute, 0, 0)
  }

  if (dowPart && dowPart !== '*') {
    const allowed = parseDowSet(dowPart)
    for (let i = 0; i < 7; i++) {
      if (allowed.has(next.getDay())) break
      next.setDate(next.getDate() + 1)
    }
  }

  return next.getTime()
}

export function assertCapability(widget: WidgetDefinition, capability: string): void {
  if (!widget.capabilities.includes(capability)) {
    throw new Error(`Capability denied: '${capability}' not declared for widget ${widget.id}`)
  }
}

async function buildWidgetContext(instance: WidgetInstance, stepName: string): Promise<WidgetContext> {
  const db = await getDB()
  const llm = getWidgetLLMBridge()
  const tools = getAdvancedTools()
  const widget = getRegisteredWidget(instance.widgetId)!

  return {
    instanceId: instance.instanceId,
    state: instance.state,
    input: instance.input,

    browser: {
      tabs: {
        query: async (filter) => {
          assertCapability(widget, filter['url'] !== undefined ? 'tabs.read' : 'tabs.list')
          return chrome.tabs.query(filter)
        },
        create: async (props) => {
          assertCapability(widget, 'tab.create')
          return chrome.tabs.create(props)
        },
        update: async (tabId, props) => {
          assertCapability(widget, 'tab.navigate')
          return chrome.tabs.update(tabId, props)
        },
        remove: async (tabId) => {
          assertCapability(widget, 'tab.interact')
          await chrome.tabs.remove(tabId)
          return true
        },
      },
      windows: {
        getAll: async () => {
          assertCapability(widget, 'tabs.list')
          return chrome.windows.getAll()
        },
      },
    },

    page: {
      extract: async ({ tabId }) => {
        assertCapability(widget, 'tab.read')
        const result = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_EXTRACT' })
        if (!result) throw new Error(`No response from content script in tab ${tabId} - is a page loaded?`)
        return (result.content as string) ?? ''
      },
      clickElement: async (tabId, index) => {
        assertCapability(widget, 'tab.interact')
        return chrome.tabs.sendMessage(tabId, { type: 'PAGE_CLICK', index })
      },
      inputText: async (tabId, index, text) => {
        assertCapability(widget, 'tab.interact')
        return chrome.tabs.sendMessage(tabId, { type: 'PAGE_INPUT', index, text })
      },
      scroll: async (tabId, direction, numPages = 1) => {
        assertCapability(widget, 'tab.interact')
        return chrome.tabs.sendMessage(tabId, { type: 'PAGE_SCROLL', direction, numPages })
      },
    },

    llm: {
      complete: async (prompt) => {
        assertCapability(widget, 'llm.completion')
        return llm.complete(prompt)
      },
      extract: async (content, schema) => {
        assertCapability(widget, 'llm.completion')
        return llm.extract(content, schema)
      },
    },

    storage: {
      put: async (key, value) => {
        assertCapability(widget, 'storage.write')
        await db.put('kv_metadata', {
          key: `widget:${instance.instanceId}:${key}`,
          value,
          updatedAt: Date.now(),
        })
      },
      get: async (key) => {
        assertCapability(widget, 'storage.read')
        const entry = await db.get('kv_metadata', `widget:${instance.instanceId}:${key}` as any)
        return entry?.value ?? null
      },
    },

    timer: {
      wait: async (durationMs) => {
        const nextRunAt = Date.now() + durationMs
        instance.status = 'waiting'
        instance.nextRunAt = nextRunAt
        instance.currentStep = stepName
        instance.updatedAt = Date.now()
        await db.put('widget_instances', instance)
        await db.put('work_queue', { instanceId: instance.instanceId, priority: 5, nextRunAt })
        throw new TimerPauseSignal(nextRunAt)
      },
      schedule: async (timestamp) => {
        instance.status = 'waiting'
        instance.nextRunAt = timestamp
        instance.currentStep = stepName
        instance.updatedAt = Date.now()
        await db.put('widget_instances', instance)
        await db.put('work_queue', { instanceId: instance.instanceId, priority: 5, nextRunAt: timestamp })
        throw new TimerPauseSignal(timestamp)
      },
      cron: async (expression) => {
        const nextRunAt = parseCronNext(expression)
        instance.status = 'waiting'
        instance.nextRunAt = nextRunAt
        instance.currentStep = stepName
        instance.updatedAt = Date.now()
        await db.put('widget_instances', instance)
        await db.put('work_queue', { instanceId: instance.instanceId, priority: 5, nextRunAt })
        throw new TimerPauseSignal(nextRunAt)
      },
    },

    signals: {
      wait: async (signalName) => {
        const existing = await db.get('signals', [instance.instanceId, signalName] as any)
        if (existing) {
          await db.delete('signals', [instance.instanceId, signalName] as any)
          return existing.payload
        }
        instance.status = 'waiting'
        instance.currentStep = stepName
        instance.updatedAt = Date.now()
        await db.put('widget_instances', instance)
        throw new SignalPauseSignal(signalName)
      },
      send: async (targetInstanceId, signalName, payload = {}) => {
        await db.put('signals', {
          instanceId: targetInstanceId,
          signalName,
          payload,
          createdAt: Date.now(),
        })
        const target = await db.get('widget_instances', targetInstanceId as any)
        if (target?.status === 'waiting') {
          target.status = 'scheduled'
          target.nextRunAt = Date.now()
          target.updatedAt = Date.now()
          await db.put('widget_instances', target)
          await db.put('work_queue', { instanceId: targetInstanceId, priority: 5, nextRunAt: Date.now() })
        }
      },
    },

    tools: {
      executeBash: (command, cwd) => tools.executeBash(command, cwd),
      readFile: (path) => tools.readFile(instance.instanceId, path),
      readFileAsText: (path) => tools.readFileAsText(instance.instanceId, path),
      writeFile: (path, content) => tools.writeFile(instance.instanceId, path, content),
      listFiles: (path) => tools.listFiles(instance.instanceId, path),
      deleteFile: (path) => tools.deleteFile(instance.instanceId, path),
      fileExists: (path) => tools.fileExists(instance.instanceId, path),
      getFileInfo: (path) => tools.getFileInfo(instance.instanceId, path),
      fetchUrl: (url, options) => tools.fetchUrl(url, options),
      updateMemory: (key, content) => tools.updateMemory(instance.instanceId, key, content),
      readMemory: (key) => tools.readMemory(instance.instanceId, key),
    },

    spawn: async (requests) => {
      const childIds: string[] = []
      const taskId = instance.taskId ?? instance.instanceId
      for (const req of requests) {
        const childWidget = getRegisteredWidget(req.widgetId)
        if (!childWidget) throw new Error(`Widget ${req.widgetId} not registered`)
        const child = await createWidgetInstance(childWidget, req.input, {
          taskId,
          parentInstanceId: instance.instanceId,
          role: req.role,
        })
        childIds.push(child.instanceId)
      }
      return childIds
    },

    collect: async (childInstanceIds) => {
      const children = await Promise.all(
        childInstanceIds.map(id => db.get('widget_instances', id as any))
      )
      const allDone = children.every(
        c => c?.status === 'completed' || c?.status === 'failed' || c?.status === 'cancelled'
      )
      if (allDone) {
        return children.map(c => (c?.output ?? c?.state ?? {}) as Record<string, unknown>)
      }
      // Store collecting IDs so the scheduler knows what to watch
      instance.state = { ...instance.state, _collectingFor: childInstanceIds }
      instance.status = 'waiting'
      instance.currentStep = stepName
      instance.updatedAt = Date.now()
      await db.put('widget_instances', instance)
      throw new CollectPauseSignal(childInstanceIds)
    },

    taskMemory: {
      read: async (key) => {
        const taskId = instance.taskId ?? instance.instanceId
        return readTaskScratchpad(taskId, key)
      },
      write: async (key, value) => {
        const taskId = instance.taskId ?? instance.instanceId
        return writeTaskScratchpad(taskId, key, value)
      },
    },

    skills: {
      invoke: async (actionId, input) => {
        // Check if widget has skill capability
        const hasSkillCap = widget.capabilities.some(cap => cap.startsWith('skill.'))
        if (!hasSkillCap) {
          throw new Error(`Widget does not have skill capabilities`)
        }
        const startTime = Date.now()
        let status: 'success' | 'error' = 'success'
        let result: unknown
        let error: string | undefined
        try {
          result = await globalActionExecutionEngine.invoke(actionId, input, {
            agentId: instance.instanceId,
            instanceId: instance.instanceId,
            timestamp: startTime,
          })
        } catch (e) {
          status = 'error'
          error = e instanceof Error ? e.message : 'Unknown error'
          throw e
        } finally {
          // Log the skill invocation event with hash chaining
          const allEventsForSkill = await db.getAll(
            'widget_events',
            IDBKeyRange.bound([instance.instanceId, 0], [instance.instanceId, Number.MAX_SAFE_INTEGER])
          )
          const lastForSkill = allEventsForSkill.length > 0 ? allEventsForSkill[allEventsForSkill.length - 1] : null
          const skillSeq = lastForSkill ? lastForSkill.seq + 1 : 0
          const skillPrevHash = lastForSkill ? lastForSkill.eventHash : '0000000000000000'
          const skillPayload = {
            actionId,
            input,
            result: status === 'success' ? result : undefined,
            error,
            duration: Date.now() - startTime,
          }
          const skillHash = await hashEvent(skillSeq, 'skill_invocation', skillPayload, skillPrevHash)
          await db.put('widget_events', {
            instanceId: instance.instanceId,
            seq: skillSeq,
            type: 'skill_invocation',
            stepId: null,
            ts: startTime,
            payload: skillPayload,
            prevHash: skillPrevHash,
            eventHash: skillHash,
          })
        }
        return result
      },
    },
  }
}

/**
 * Define a new widget with type safety
 */
export function defineWidget<T extends z.ZodType>(def: {
	id: string
	name: string
	version: string
	description: string
	capabilities: string[]
	input: T
	steps: Record<string, StepHandler>
}): WidgetDefinition {
	return { ...def, input: def.input }
}

/**
 * Create a new widget instance.
 * opts.taskId - omit for root agents (taskId defaults to instanceId).
 * opts.parentInstanceId - set when spawned by a parent agent.
 * opts.role - defaults to 'worker'.
 */
export async function createWidgetInstance(
	widget: WidgetDefinition,
	input: Record<string, unknown>,
	opts?: { taskId?: string; parentInstanceId?: string; role?: string }
): Promise<WidgetInstance> {
	const db = await getDB()

	const instanceId = globalThis.crypto.randomUUID()
	const now = Date.now()

	const instance: WidgetInstance = {
		instanceId,
		widgetId: widget.id,
		version: widget.version,
		status: 'idle',
		currentStep: null,
		attempt: 0,
		input: widget.input.parse(input) as Record<string, unknown>,
		state: {},
		createdAt: now,
		updatedAt: now,
		lastRunAt: null,
		nextRunAt: now,
		taskId: opts?.taskId ?? instanceId,
		parentInstanceId: opts?.parentInstanceId,
		role: opts?.role ?? 'worker',
	}

	await db.put('widget_instances', instance)

	await db.put('work_queue', {
		instanceId,
		priority: 5,
		nextRunAt: now,
	})

	return instance
}

/**
 * Execute a single step on a widget instance.
 * Returns the step after this one, or null if this was the last step.
 * On timer/signal pause, returns pause=true and nextStep=stepName so the
 * scheduler re-enters the same step after the wait.
 */
export async function executeStep(
	instance: WidgetInstance,
	stepName: string
): Promise<{
	success: boolean
	nextStep: string | null
	pause: boolean
	error?: Error
}> {
	const db = await getDB()
	const widget = getRegisteredWidget(instance.widgetId)

	if (!widget) {
		return { success: false, nextStep: null, pause: false, error: new Error(`Widget ${instance.widgetId} not registered`) }
	}

	const stepHandler = widget.steps[stepName]
	if (!stepHandler) {
		return { success: false, nextStep: null, pause: false, error: new Error(`Step '${stepName}' not found in widget ${instance.widgetId}`) }
	}

	// Acquire distributed lease before touching instance state
	const leaseAcquired = await acquireLease(instance.instanceId)
	if (!leaseAcquired) {
		return { success: false, nextStep: stepName, pause: false, error: new Error('Could not acquire lease - another context is running this instance') }
	}

	try {
		// Get the last event for hash chaining using the compound key range
		const allEvents = await db.getAll(
			'widget_events',
			IDBKeyRange.bound([instance.instanceId, 0], [instance.instanceId, Number.MAX_SAFE_INTEGER])
		)
		const lastEvent = allEvents.length > 0 ? allEvents[allEvents.length - 1] : null
		const seq = lastEvent ? lastEvent.seq + 1 : 0
		const prevHash = lastEvent ? lastEvent.eventHash : '0000000000000000'

		// Write STEP_STARTED event
		const startedPayload = { stepName, attempt: instance.attempt }
		const startedHash = await hashEvent(seq, 'STEP_STARTED', startedPayload, prevHash)
		const startedEvent: WidgetEvent = {
			instanceId: instance.instanceId,
			seq,
			type: 'STEP_STARTED',
			stepId: stepName,
			ts: Date.now(),
			payload: startedPayload,
			prevHash,
			eventHash: startedHash,
		}
		await db.put('widget_events', startedEvent)

		const ctx = await buildWidgetContext(instance, stepName)

		let result: unknown
		let stepError: Error | undefined
		let isPause = false

		try {
			result = await withTimeout(stepHandler(ctx), STEP_TIMEOUT)
		} catch (e) {
			if (e instanceof TimerPauseSignal || e instanceof SignalPauseSignal || e instanceof CollectPauseSignal) {
				isPause = true
			} else {
				stepError = e instanceof Error ? e : new Error(String(e))
			}
		}

		if (isPause) {
			const pauseSeq = seq + 1
			const pausePayload = { stepName }
			const pauseHash = await hashEvent(pauseSeq, 'STEP_PAUSED', pausePayload, startedHash)
			await db.put('widget_events', {
				instanceId: instance.instanceId,
				seq: pauseSeq,
				type: 'STEP_PAUSED',
				stepId: stepName,
				ts: Date.now(),
				payload: pausePayload,
				prevHash: startedHash,
				eventHash: pauseHash,
			})
			return { success: true, nextStep: stepName, pause: true }
		}

		const resultSeq = seq + 1
		const resultType = stepError ? 'STEP_FAILED' : 'STEP_COMPLETED'
		const resultPayload = stepError
			? { stepName, error: stepError.message, attempt: instance.attempt }
			: { stepName, result: result ?? null }
		const resultHash = await hashEvent(resultSeq, resultType, resultPayload, startedHash)

		await db.put('widget_events', {
			instanceId: instance.instanceId,
			seq: resultSeq,
			type: resultType,
			stepId: stepName,
			ts: Date.now(),
			payload: resultPayload,
			prevHash: startedHash,
			eventHash: resultHash,
		})

		if (stepError) {
			instance.attempt++
			instance.updatedAt = Date.now()
			await db.put('widget_instances', instance)

			if (instance.attempt < MAX_RETRIES) {
				const backoff = calculateBackoff(instance.attempt)
				await db.put('work_queue', {
					instanceId: instance.instanceId,
					priority: 5,
					nextRunAt: Date.now() + backoff,
				})
				// Return the same step so the scheduler retries it
				return { success: false, nextStep: stepName, pause: false, error: stepError }
			}

			return { success: false, nextStep: null, pause: false, error: stepError }
		}

		// Merge step output into instance state
		if (result !== null && result !== undefined && typeof result === 'object') {
			instance.state = { ...instance.state, ...(result as Record<string, unknown>) }
		}
		instance.attempt = 0
		instance.updatedAt = Date.now()
		await db.put('widget_instances', instance)

		const stepNames = Object.keys(widget.steps)
		const currentIndex = stepNames.indexOf(stepName)
		const nextStep = currentIndex >= 0 && currentIndex < stepNames.length - 1
			? stepNames[currentIndex + 1]
			: null

		return { success: true, nextStep, pause: false }
	} finally {
		await releaseLease(instance.instanceId)
	}
}

const registeredWidgets = new Map<string, WidgetDefinition>()

export function registerWidget(widget: WidgetDefinition): void {
	registeredWidgets.set(widget.id, widget)
}

export function getRegisteredWidget(widgetId: string): WidgetDefinition | undefined {
	return registeredWidgets.get(widgetId)
}

/**
 * Get all active widget instances
 */
export async function getActiveInstances(): Promise<WidgetInstance[]> {
	const db = await getDB()
	const all = await db.getAll('widget_instances')
	return all.filter(
		(instance) =>
			instance.status === 'idle' ||
			instance.status === 'running' ||
			instance.status === 'scheduled' ||
			instance.status === 'waiting'
	)
}

/**
 * Stop a running widget instance
 */
export async function stopWidgetInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
	const db = await getDB()
	const instance = await db.get('widget_instances', instanceId as any)

	if (!instance) {
		return { success: false, error: 'Instance not found' }
	}

	if (instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled') {
		return { success: false, error: 'Instance is already stopped' }
	}

	await releaseLease(instanceId)

	instance.status = 'cancelled'
	instance.updatedAt = Date.now()
	await db.put('widget_instances', instance)

	const workItems = await db.getAllFromIndex('work_queue', 'by-instanceId', instanceId)
	for (const item of workItems) {
		await db.delete('work_queue', (item as any).nextRunAt)
	}

	return { success: true }
}

/**
 * Permanently delete a widget instance and all associated data
 */
export async function deleteWidgetInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
	const db = await getDB()
	const instance = await db.get('widget_instances', instanceId as any)

	if (!instance) {
		return { success: false, error: 'Instance not found' }
	}

	if (instance.status === 'running') {
		await stopWidgetInstance(instanceId)
	}

	await db.delete('widget_instances', instanceId as any)

	// Use compound key range - no separate by-instanceId index needed
	const events = await db.getAll(
		'widget_events',
		IDBKeyRange.bound([instanceId, 0], [instanceId, Number.MAX_SAFE_INTEGER])
	)
	for (const event of events) {
  await db.delete('widget_events', [event.instanceId, event.seq] as any)
	}

	const workItems = await db.getAllFromIndex('work_queue', 'by-instanceId', instanceId)
	for (const item of workItems) {
		await db.delete('work_queue', (item as any).nextRunAt)
	}

	return { success: true }
}
