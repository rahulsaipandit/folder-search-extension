import { getDB } from './db'
import { reclaimExpiredLeases, startLeaseHeartbeat } from './leaseManager'
import { executeStep, getRegisteredWidget } from './widgetRuntime'
import type { WidgetInstance, WorkQueueItem } from './db'

declare const chrome: any

const SCHEDULER_INTERVAL = 1000
const MAX_CONCURRENT_WIDGETS = 8

const activeInstances = new Set<string>()
let schedulerRunning = false
let schedulerInterval: number | null = null

// ── Recording hook ─────────────────────────────────────────────────────────
// background.ts registers this to start/stop tab capture alongside agent tasks.
export type AgentRecordingEvent = 'start' | 'stop'
export type AgentRecordingHook = (
  instanceId: string,
  tabId: number | undefined,
  event: AgentRecordingEvent,
  taskLabel: string,
) => void

let _recordingHook: AgentRecordingHook | null = null

export function setAgentRecordingHook(hook: AgentRecordingHook): void {
  _recordingHook = hook
}

function fireRecordingHook(instance: WidgetInstance, event: AgentRecordingEvent): void {
  _recordingHook?.(instance.instanceId, instance.ownedTabId, event, instance.widgetId ?? 'AgentTask')
}

/**
 * Start the widget scheduler loop
 * Runs in service worker context
 */
export function startWidgetScheduler(): void {
  if (schedulerRunning) return

  schedulerRunning = true
  startLeaseHeartbeat(activeInstances)

  schedulerInterval = self.setInterval(async () => {
    try {
      await runSchedulerCycle()
    } catch {
      // Ignore errors; next cycle will retry
    }
  }, SCHEDULER_INTERVAL)
}

/**
 * Stop the widget scheduler
 */
export function stopWidgetScheduler(): void {
  schedulerRunning = false
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

/**
 * Run single scheduler cycle
 */
async function runSchedulerCycle(): Promise<void> {
  if (activeInstances.size >= MAX_CONCURRENT_WIDGETS) return

  const db = await getDB()

  await reclaimExpiredLeases()

  const now = Date.now()
  const queueItems = await db.getAllFromIndex('work_queue', 'nextRunAt' as any, IDBKeyRange.upperBound(now))

  for (const item of queueItems) {
    if (activeInstances.size >= MAX_CONCURRENT_WIDGETS) break
    if (activeInstances.has(item.instanceId)) continue

    const instance = await db.get('widget_instances', item.instanceId as any)
    if (!instance) continue

    if (
      instance.status !== 'idle' &&
      instance.status !== 'scheduled' &&
      instance.status !== 'waiting'
    ) continue

    activeInstances.add(item.instanceId)

    void executeWidgetInstance(instance).finally(() => {
      activeInstances.delete(item.instanceId)
    })
  }
}

async function broadcastWidgetUpdate(instance: WidgetInstance, eventType: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: `widget:${eventType}`,
      instanceId: instance.instanceId,
      instance,
    })
  } catch {
    // Sidepanel not open - ignore
  }
}

async function executeWidgetInstance(instance: WidgetInstance): Promise<void> {
  const db = await getDB()

  const widget = getRegisteredWidget(instance.widgetId)
  if (!widget) {
    instance.status = 'failed'
    instance.updatedAt = Date.now()
    await db.put('widget_instances', instance)
    await broadcastWidgetUpdate(instance, 'failed')
    return
  }

  instance.status = 'running'
  instance.lastRunAt = Date.now()
  await db.put('widget_instances', instance)
  await broadcastWidgetUpdate(instance, 'started')
  fireRecordingHook(instance, 'start')

  // Resume from currentStep (set when a timer/signal pauses the widget) or start from the first step
  const stepNames = Object.keys(widget.steps)
  let currentStep = instance.currentStep && widget.steps[instance.currentStep]
    ? instance.currentStep
    : stepNames[0]

  while (currentStep && instance.status === 'running') {
    const result = await executeStep(instance, currentStep)

    if (result.pause) {
      instance.status = 'waiting'
      await db.put('widget_instances', instance)
      await broadcastWidgetUpdate(instance, 'paused')
      return
    }

    if (!result.success) {
      if (result.nextStep) {
        // Still retrying - scheduler will re-run after backoff
        instance.status = 'scheduled'
        instance.currentStep = result.nextStep
        await db.put('widget_instances', instance)
        await broadcastWidgetUpdate(instance, 'retrying')
      } else {
        // Exceeded max retries
        instance.status = 'failed'
        instance.updatedAt = Date.now()
        await db.put('widget_instances', instance)
        await broadcastWidgetUpdate(instance, 'failed')
        fireRecordingHook(instance, 'stop')
        await maybeWakeParent(instance)
        await closeOwnedTab(instance)
      }
      return
    }

    if (result.nextStep) {
      currentStep = result.nextStep
      instance.currentStep = currentStep
      await db.put('widget_instances', instance)
      await broadcastWidgetUpdate(instance, 'step_updated')
    } else {
      break
    }
  }

  if (instance.status === 'running') {
    instance.status = 'completed'
    instance.output = { ...instance.state }
    instance.updatedAt = Date.now()
    await db.put('widget_instances', instance)
    await broadcastWidgetUpdate(instance, 'completed')
    fireRecordingHook(instance, 'stop')
    await maybeWakeParent(instance)
    await closeOwnedTab(instance)
  }
}

/**
 * After a child agent completes (or fails), check whether all siblings are
 * done. If they are, wake the parent out of its collect-wait.
 */
async function maybeWakeParent(child: WidgetInstance): Promise<void> {
  if (!child.parentInstanceId) return

  const db = await getDB()
  const parent = await db.get('widget_instances', child.parentInstanceId as any)
  if (!parent || parent.status !== 'waiting') return

  // Check that the parent is actually waiting for a collect (has _collectingFor)
  const collectingFor = parent.state._collectingFor as string[] | undefined
  if (!collectingFor || collectingFor.length === 0) return

  const siblings = await Promise.all(collectingFor.map(id => db.get('widget_instances', id as any)))
  const allDone = siblings.every(
    s => s?.status === 'completed' || s?.status === 'failed' || s?.status === 'cancelled'
  )
  if (!allDone) return

  parent.status = 'scheduled'
  parent.nextRunAt = Date.now()
  parent.updatedAt = Date.now()
  await db.put('widget_instances', parent)
  await db.put('work_queue', {
    instanceId: parent.instanceId,
    priority: 5,
    nextRunAt: parent.nextRunAt,
  } as WorkQueueItem)
}

/** Close the tab owned by an agent when it finishes. */
async function closeOwnedTab(instance: WidgetInstance): Promise<void> {
  if (!instance.ownedTabId) return
  try {
    await chrome.tabs.remove(instance.ownedTabId)
  } catch {
    // Tab may already be closed
  }
}

/**
 * Startup recovery algorithm
 * Runs on extension / service worker startup
 */
export async function runStartupRecovery(): Promise<number> {
  const db = await getDB()

  await reclaimExpiredLeases()

  // Collect all widgets that should be runnable: running (interrupted), scheduled, waiting, and idle
  const runningWidgets   = await db.getAllFromIndex('widget_instances', 'by-status', 'running')
  const scheduledWidgets = await db.getAllFromIndex('widget_instances', 'by-status', 'scheduled')
  const waitingWidgets   = await db.getAllFromIndex('widget_instances', 'by-status', 'waiting')
  const idleWidgets      = await db.getAllFromIndex('widget_instances', 'by-status', 'idle')

  const allRunnable = [...runningWidgets, ...scheduledWidgets, ...waitingWidgets, ...idleWidgets]

  for (let i = 0; i < allRunnable.length; i++) {
    const instance = allRunnable[i]
    instance.status = 'scheduled'
    instance.nextRunAt = Date.now() + i  // +i ensures unique nextRunAt keys in the work_queue store
    await db.put('widget_instances', instance)

    await db.put('work_queue', {
      instanceId: instance.instanceId,
      priority: 5,
      nextRunAt: instance.nextRunAt,
    } as WorkQueueItem)
  }

  return allRunnable.length
}
