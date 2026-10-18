import React from 'react'
import type { WidgetInstance } from '../../../extension/src/lib/db'
import { getRegisteredWidget } from '../../../extension/src/lib/widgetRuntime'
import styles from './WorkflowStepStrip.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type StepStatus =
  | 'completed'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'failed'
  | 'retrying'
  | 'pending'

type ConnectorStatus = 'done' | 'active' | 'pending'

interface StepNode {
  name: string
  label: string
  status: StepStatus
  attempt?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toLabel(camel: string): string {
  return camel
    .replace(/([A-Z])/g, ' $1')
    .replace(/^(.)/, s => s.toUpperCase())
    .trim()
}

function deriveStatus(
  idx: number,
  currentIdx: number,
  inst: WidgetInstance,
): StepStatus {
  if (inst.status === 'completed') return 'completed'
  if (inst.status === 'cancelled') return idx <= currentIdx ? 'completed' : 'pending'
  if (idx < currentIdx) return 'completed'
  if (idx === currentIdx) {
    if (inst.status === 'failed')  return 'failed'
    if (inst.status === 'waiting') return 'waiting'
    if (inst.status === 'paused')  return 'paused'
    if (inst.attempt > 1)          return 'retrying'
    return 'running'
  }
  return 'pending'
}

function buildNodes(inst: WidgetInstance): StepNode[] {
  const def = getRegisteredWidget(inst.widgetId)

  if (!def) {
    if (!inst.currentStep) return []
    const s: StepStatus =
      inst.status === 'failed'    ? 'failed'
      : inst.status === 'completed' ? 'completed'
      : inst.status === 'waiting'   ? 'waiting'
      : inst.status === 'paused'    ? 'paused'
      : inst.attempt > 1            ? 'retrying'
      : 'running'
    return [{ name: inst.currentStep, label: toLabel(inst.currentStep), status: s }]
  }

  const names = Object.keys(def.steps)
  const currentIdx = inst.currentStep ? names.indexOf(inst.currentStep) : -1

  return names.map((name, idx) => {
    const status = deriveStatus(idx, currentIdx, inst)
    return {
      name,
      label: toLabel(name),
      status,
      attempt: status === 'retrying' ? inst.attempt : undefined,
    }
  })
}

function connectorStatus(left: StepNode, right: StepNode): ConnectorStatus {
  if (left.status === 'completed' && right.status === 'completed') return 'done'
  if (left.status === 'completed') return 'active'
  return 'pending'
}

// ── Style maps ───────────────────────────────────────────────────────────────

const NODE_BG: Record<StepStatus, string> = {
  completed: 'bg-emerald-600',
  running:   'bg-blue-600',
  waiting:   'bg-amber-500',
  paused:    'bg-orange-500',
  failed:    'bg-red-600',
  retrying:  'bg-violet-600',
  pending:   'bg-gray-700',
}

const NODE_ICON: Record<StepStatus, string> = {
  completed: '✓',
  running:   '●',
  waiting:   '⏳',
  paused:    '⏸',
  failed:    '✕',
  retrying:  '↺',
  pending:   '',
}

const NODE_ANIM: Record<StepStatus, string> = {
  running:   styles.nodeRunning,
  waiting:   styles.nodeWaiting,
  retrying:  styles.nodeRetrying,
  failed:    styles.nodeFailed,
  completed: '',
  paused:    '',
  pending:   '',
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  instance: WidgetInstance
  compact?: boolean
}

const WorkflowStepStrip: React.FC<Props> = ({ instance, compact = false }) => {
  const ns = buildNodes(instance)
  if (ns.length === 0) return null

  const pill = compact
    ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap text-white'
    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap text-white'

  const connectorH = compact ? 'h-px' : 'h-0.5'
  const connectorW = compact ? 'w-7'  : 'w-10'

  const items: React.ReactNode[] = []

  ns.forEach((node: StepNode, i: number) => {
    const anim = NODE_ANIM[node.status] ?? ''
    const icon = NODE_ICON[node.status]

    items.push(
      <div
        key={node.name}
        className={`${pill} ${NODE_BG[node.status]} ${anim}`}
        title={node.attempt ? `${node.name} - attempt ${node.attempt}` : node.name}
      >
        {icon && <span className="leading-none text-[9px]">{icon}</span>}
        <span>{node.label}</span>
        {node.attempt && node.attempt > 1 && (
          <span className="opacity-70">×{node.attempt}</span>
        )}
      </div>
    )

    if (i < ns.length - 1) {
      const cs = connectorStatus(node, ns[i + 1])
      const connCls =
        cs === 'done'   ? styles.connectorDone
        : cs === 'active' ? styles.connectorActive
        :                   styles.connectorPending

      items.push(
        <div
          key={`conn-${node.name}`}
          className={`${connectorH} ${connectorW} flex-shrink-0 ${connCls}`}
        />
      )
    }
  })

  return (
    <div className="overflow-x-auto border-t border-gray-100 bg-gray-50">
      <div className="flex items-center px-4 py-2 gap-0 min-w-max">
        {items}
      </div>
    </div>
  )
}

export default WorkflowStepStrip
