import type { SessionRecord } from '@/lib/db'

// ── Keyframe animations injected once into the document head ─────────────────

const STRIP_STYLES = `
@keyframes wfDashMove {
  from { background-position-x: 0px; }
  to   { background-position-x: 12px; }
}
@keyframes wfPulseRing {
  0%,100% { box-shadow: 0 0 0 2px rgba(59,130,246,0.8); }
  50%     { box-shadow: 0 0 0 5px rgba(59,130,246,0.15); }
}
@keyframes wfErrorFlash {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.5; }
}
.wf-connector-active {
  background-image: repeating-linear-gradient(
    to right,
    #10b981 0px, #10b981 6px,
    transparent 6px, transparent 12px
  );
  animation: wfDashMove 1.1s linear infinite;
}
.wf-connector-pending {
  background-image: repeating-linear-gradient(
    to right,
    #d1d5db 0px, #d1d5db 4px,
    transparent 4px, transparent 9px
  );
}
.wf-node-running  { animation: wfPulseRing  1.4s ease-in-out infinite; }
.wf-node-failed   { animation: wfErrorFlash 1.0s ease-in-out infinite; }
`

let stylesInjected = false
function injectStyles() {
	if (stylesInjected) return
	stylesInjected = true
	const tag = document.createElement('style')
	tag.textContent = STRIP_STYLES
	document.head.appendChild(tag)
}

// ── Action name → short label ─────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
	open_new_tab:              'Open Tab',
	click_element_by_index:    'Click',
	navigate_to_url:           'Navigate',
	input_text:                'Type',
	scroll:                    'Scroll',
	select_dropdown_option:    'Select',
	wait:                      'Wait',
	done:                      'Done',
	ask_user:                  'Ask User',
	go_back:                   'Back',
	extract_page_content:      'Extract',
	take_screenshot:           'Screenshot',
	search_google:             'Search',
	save_to_memory:            'Remember',
}

function toTitleCase(snake: string): string {
	return snake
		.replace(/_/g, ' ')
		.replace(/([A-Z])/g, ' $1')
		.replace(/^(.)/, (s) => s.toUpperCase())
		.trim()
}

function actionLabel(name: string): string {
	return ACTION_LABELS[name] ?? toTitleCase(name)
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionStatus = SessionRecord['status']

type StepStatus = 'completed' | 'running' | 'failed' | 'pending'

interface StepNode {
	label: string
	tooltip: string
	status: StepStatus
}

type ConnectorStatus = 'done' | 'active' | 'pending'

// ── Derivation ────────────────────────────────────────────────────────────────

function deriveNodes(
	history: SessionRecord['history'],
	sessionStatus: SessionStatus,
): StepNode[] {
	const steps = history.filter((e) => e.type === 'step')
	if (steps.length === 0) return []

	return steps.map((event, idx) => {
		const isLast = idx === steps.length - 1
		let status: StepStatus

		if (sessionStatus === 'completed') {
			status = 'completed'
		} else if (sessionStatus === 'error' && isLast) {
			status = 'failed'
		} else if (sessionStatus === 'in_progress' && isLast) {
			status = 'running'
		} else {
			status = 'completed'
		}

		const name = event.action?.name ?? 'step'
		const label = actionLabel(name)
		const tooltip = event.reflection?.next_goal ?? label

		return { label, tooltip, status }
	})
}

function connectorStatus(left: StepNode, right: StepNode): ConnectorStatus {
	if (left.status === 'completed' && right.status === 'completed') return 'done'
	if (left.status === 'completed') return 'active'
	return 'pending'
}

// ── Node styling ──────────────────────────────────────────────────────────────

const NODE_CLASSES: Record<StepStatus, string> = {
	completed: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300',
	running:   'bg-blue-100 text-blue-800 ring-1 ring-blue-400 wf-node-running',
	failed:    'bg-red-100 text-red-800 ring-1 ring-red-400 wf-node-failed',
	pending:   'bg-muted text-muted-foreground ring-1 ring-border',
}

const NODE_ICON: Record<StepStatus, string> = {
	completed: '✓',
	running:   '●',
	failed:    '✕',
	pending:   '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionWorkflowStrip({
	history,
	status,
}: {
	history: SessionRecord['history']
	status: SessionStatus
}) {
	injectStyles()

	const nodes = deriveNodes(history, status)
	if (nodes.length === 0) return null

	return (
		<div className="border-b overflow-x-auto bg-muted/20 shrink-0">
			<div className="flex items-center px-3 py-2 gap-0 min-w-max">
				{nodes.map((node, i) => {
					const icon = NODE_ICON[node.status]

					return (
						<>
							{/* Step pill */}
							<div
								key={node.label + i}
								className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${NODE_CLASSES[node.status]}`}
								title={node.tooltip}
							>
								{icon && <span className="text-[9px] leading-none">{icon}</span>}
								<span>{node.label}</span>
							</div>

							{/* Connector */}
							{i < nodes.length - 1 && (() => {
								const cs = connectorStatus(node, nodes[i + 1])
								const connCls =
									cs === 'done'   ? 'h-0.5 w-8 flex-shrink-0 bg-emerald-400'
									: cs === 'active' ? 'h-0.5 w-8 flex-shrink-0 wf-connector-active'
									:                   'h-0.5 w-8 flex-shrink-0 wf-connector-pending'
								return <div key={`conn-${i}`} className={connCls} />
							})()}
						</>
					)
				})}
			</div>
		</div>
	)
}
