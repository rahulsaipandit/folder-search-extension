import React, { useState, useEffect, useMemo } from 'react'
import { stopWidgetInstance, deleteWidgetInstance } from '../../../extension/src/lib/widgetRuntime'
import { getAllInstances } from '../../../extension/src/lib/db'
import type { WidgetInstance } from '../../../extension/src/lib/db'
import WorkflowStepStrip from './WorkflowStepStrip'

type TerminalStatus = 'completed' | 'failed' | 'cancelled'

const TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled'])
const POLL_INTERVAL = 3000

interface TaskGroup {
  rootId: string
  root: WidgetInstance
  children: WidgetInstance[]
  expanded: boolean
}

// ── ActiveWidgets ─────────────────────────────────────────────────────────────

const ActiveWidgets: React.FC = () => {
  const [allInstances, setAllInstances] = useState<WidgetInstance[]>([])
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

  const load = async () => {
    try {
      setAllInstances(await getAllInstances())
    } catch (error) {
      console.error('Failed to load instances:', error)
    }
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(load, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const taskGroups = useMemo<TaskGroup[]>(() => {
    const byTaskId = new Map<string, WidgetInstance[]>()
    for (const inst of allInstances) {
      const tid = inst.taskId ?? inst.instanceId
      if (!byTaskId.has(tid)) byTaskId.set(tid, [])
      byTaskId.get(tid)!.push(inst)
    }

    const groups: TaskGroup[] = []
    for (const [taskId, members] of byTaskId) {
      const root = members.find(m => m.instanceId === taskId) ?? members[0]
      const children = members.filter(m => m.instanceId !== taskId)
      groups.push({ rootId: taskId, root, children, expanded: expandedTasks.has(taskId) })
    }
    return groups.sort((a, b) => b.root.createdAt - a.root.createdAt)
  }, [allInstances, expandedTasks])

  const toggleExpand = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const stop = async (instanceId: string) => {
    const result = await stopWidgetInstance(instanceId)
    if (!result.success) alert('Failed to stop: ' + result.error)
    else await load()
  }

  const remove = async (instanceId: string) => {
    if (!confirm('Delete this agent instance and all its data?')) return
    const result = await deleteWidgetInstance(instanceId)
    if (!result.success) alert('Failed to delete: ' + result.error)
    else await load()
  }

  return (
    <div className="active-widgets p-4">
      <h2 className="text-lg font-semibold mb-4">Agent Tasks</h2>

      {taskGroups.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No agent tasks yet</p>
          <p className="text-sm mt-2">Submit a query from the Agent tab to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {taskGroups.map(group => (
            <TaskCard
              key={group.rootId}
              group={group}
              onToggle={() => toggleExpand(group.rootId)}
              onStop={stop}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ActiveWidgets

// ── TaskCard ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  group: TaskGroup
  onToggle: () => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
}

const TaskCard: React.FC<TaskCardProps> = ({ group, onToggle, onStop, onDelete }) => {
  const { root, children, expanded } = group
  const hasChildren = children.length > 0
  const doneChildren = children.filter(c => TERMINAL.has(c.status)).length
  const taskDone = TERMINAL.has(root.status)

  return (
    <div className={`task-card border rounded-lg overflow-hidden ${taskDone ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {hasChildren && (
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-gray-700 w-5 text-xs flex-shrink-0"
            >
              {expanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <div className="w-5" />}

          <StatusDot status={root.status} />

          <div className="min-w-0">
            <div className="font-medium text-sm truncate">
              {(root.input?.query as string) || root.widgetId}
            </div>
            <div className="text-xs text-gray-500 flex items-center space-x-2">
              <span className="capitalize">{root.role ?? 'worker'}</span>
              <span>·</span>
              <span className="capitalize">{root.status}</span>
              {root.currentStep && (
                <>
                  <span>·</span>
                  <span>step: {root.currentStep}</span>
                </>
              )}
              {hasChildren && (
                <>
                  <span>·</span>
                  <span>{doneChildren}/{children.length} agents done</span>
                </>
              )}
            </div>
          </div>
        </div>

        <InstanceActions instance={root} onStop={onStop} onDelete={onDelete} />
      </div>

      <WorkflowStepStrip instance={root} />

      {expanded && hasChildren && (
        <div className="border-t">
          {children.map(child => (
            <ChildRow key={child.instanceId} child={child} onStop={onStop} onDelete={onDelete} />
          ))}
        </div>
      )}

      {taskDone && !!(root.output as Record<string, unknown> | null | undefined)?.aggregatedResult && (
        <div className="border-t p-4 text-sm text-gray-700 bg-white">
          <div className="font-medium text-xs text-gray-400 uppercase mb-1">Result</div>
          <pre className="whitespace-pre-wrap font-sans">{String((root.output as Record<string, unknown>).aggregatedResult ?? '')}</pre>
        </div>
      )}
    </div>
  )
}

// ── ChildRow ─────────────────────────────────────────────────────────────────

interface ChildRowProps {
  child: WidgetInstance
  onStop: (id: string) => void
  onDelete: (id: string) => void
}

const ChildRow: React.FC<ChildRowProps> = ({ child, onStop, onDelete }) => (
  <div className="border-b last:border-b-0">
    <div className="flex items-center justify-between px-4 py-3 pl-8 hover:bg-gray-50">
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        <div className="w-3 h-px bg-gray-300 flex-shrink-0" />
        <StatusDot status={child.status} size="sm" />
        <div className="min-w-0">
          <div className="text-sm truncate text-gray-700">
            {(child.input?.url as string) || child.widgetId}
          </div>
          <div className="text-xs text-gray-400 flex items-center space-x-2">
            <span className="capitalize">{child.role ?? 'worker'}</span>
            <span>·</span>
            <span className="capitalize">{child.status}</span>
            {child.currentStep && (
              <>
                <span>·</span>
                <span>{child.currentStep}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <InstanceActions instance={child} onStop={onStop} onDelete={onDelete} />
    </div>
    <WorkflowStepStrip instance={child} compact />
  </div>
)

// ── StatusDot ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  running:   'bg-green-500 animate-pulse',
  waiting:   'bg-yellow-400',
  scheduled: 'bg-blue-400',
  paused:    'bg-orange-400',
  failed:    'bg-red-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-gray-300',
  idle:      'bg-gray-300',
}

interface StatusDotProps {
  status: string
  size?: 'sm' | 'md'
}

const StatusDot: React.FC<StatusDotProps> = ({ status, size = 'md' }) => {
  const sz = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
  const color = STATUS_COLOR[status] ?? 'bg-gray-300'
  return <div className={`${sz} rounded-full flex-shrink-0 ${color}`} title={status} />
}

// ── InstanceActions ───────────────────────────────────────────────────────────

interface InstanceActionsProps {
  instance: WidgetInstance
  onStop: (id: string) => void
  onDelete: (id: string) => void
}

const InstanceActions: React.FC<InstanceActionsProps> = ({ instance, onStop, onDelete }) => {
  const canStop = instance.status === 'running' || instance.status === 'waiting'
  return (
    <div className="flex space-x-1 flex-shrink-0">
      {canStop && (
        <button
          onClick={() => onStop(instance.instanceId)}
          className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
        >
          Stop
        </button>
      )}
      <button
        onClick={() => onDelete(instance.instanceId)}
        className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs"
      >
        Delete
      </button>
    </div>
  )
}
