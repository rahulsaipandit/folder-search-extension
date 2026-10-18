import { ArrowLeft, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SessionRecord, listSessions } from '@/lib/db'

import { EventCard } from './cards'
import { SessionWorkflowStrip } from './SessionWorkflowStrip'

function StatusBadge({ status }: { status: SessionRecord['status'] }) {
	if (status === 'completed')
		return (
			<span className="flex items-center gap-1 text-green-600 text-xs font-medium">
				<CheckCircle className="size-3.5" /> Completed
			</span>
		)
	if (status === 'in_progress')
		return (
			<span className="flex items-center gap-1 text-blue-600 text-xs font-medium">
				<Loader2 className="size-3.5 animate-spin" /> Running
			</span>
		)
	return (
		<span className="flex items-center gap-1 text-destructive text-xs font-medium">
			<XCircle className="size-3.5" /> Error
		</span>
	)
}

export function AgentDashboard({ onBack }: { onBack: () => void }) {
	const [sessions, setSessions] = useState<SessionRecord[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	// Track whether we've auto-selected yet so we don't clobber a manual selection
	const autoSelectedRef = useRef(false)

	const load = useCallback(async () => {
		console.log('[AgentDashboard] Loading sessions from IndexedDB...')
		const all = await listSessions()
		console.log('[AgentDashboard] Loaded', all.length, 'sessions:', all.map((s) => ({ id: s.id, task: s.task, status: s.status, steps: s.history.length })))
		setSessions(all)
		setLoading(false)

		// Auto-select the most recent session on first load
		if (!autoSelectedRef.current && all.length > 0) {
			autoSelectedRef.current = true
			setSelectedId(all[0].id)
			console.log('[AgentDashboard] Auto-selected session:', all[0].id, '-', all[0].task)
		}
	}, [])

	useEffect(() => {
		load()
	}, [load])

	// Poll every 2 s while any session is in_progress
	useEffect(() => {
		const hasInProgress = sessions.some((s) => s.status === 'in_progress')
		if (!hasInProgress) return
		console.log('[AgentDashboard] In-progress session detected - polling every 2s')
		const interval = setInterval(load, 2000)
		return () => clearInterval(interval)
	}, [sessions, load])

	const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null

	console.log('[AgentDashboard] Render - selected session:', selected?.id, 'status:', selected?.status, 'steps:', selected?.history.length)

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2 shrink-0">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium flex-1">Agent Dashboard</span>
				{selected && <StatusBadge status={selected.status} />}
			</header>

			{loading && (
				<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
					Loading sessions…
				</div>
			)}

			{!loading && sessions.length === 0 && (
				<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
					No agent sessions yet. Run a task first.
				</div>
			)}

			{!loading && sessions.length > 0 && (
				<div className="flex flex-col flex-1 min-h-0">
					{/* Session selector - show up to 5 most recent */}
					{sessions.length > 1 && (
						<div className="border-b px-3 py-2 space-y-1 shrink-0">
							<div className="text-[10px] text-muted-foreground uppercase tracking-wide">
								Recent Sessions
							</div>
							<div className="space-y-1 max-h-28 overflow-y-auto">
								{sessions.slice(0, 5).map((s) => (
									<button
										key={s.id}
										type="button"
										onClick={() => {
											console.log('[AgentDashboard] User selected session:', s.id, '-', s.task)
											setSelectedId(s.id)
										}}
										className={`w-full text-left px-2 py-1 rounded text-xs truncate transition-colors ${
											s.id === (selectedId ?? sessions[0]?.id)
												? 'bg-muted font-medium'
												: 'hover:bg-muted/50 text-muted-foreground'
										}`}
									>
										{s.task}
									</button>
								))}
							</div>
						</div>
					)}

					{/* Selected session detail */}
					{selected && (
						<>
							{/* Task label */}
							<div className="border-b px-3 py-2 bg-muted/30 shrink-0">
								<div className="text-[10px] text-muted-foreground uppercase tracking-wide">Task</div>
								<div className="text-xs font-medium" title={selected.task}>
									{selected.task}
								</div>
							</div>

							{/* Workflow step strip */}
							<SessionWorkflowStrip history={selected.history} status={selected.status} />

							{/* History / response */}
							<div className="flex-1 overflow-y-auto p-3 space-y-2">
								{selected.status === 'in_progress' && selected.history.length === 0 && (
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<Loader2 className="size-3.5 animate-spin" />
										Agent is starting…
									</div>
								)}

								{selected.history.map((event, index) => (
									// eslint-disable-next-line react-x/no-array-index-key
									<EventCard key={index} event={event} />
								))}

								{selected.status === 'in_progress' && selected.history.length > 0 && (
									<div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
										<Loader2 className="size-3.5 animate-spin" />
										Running… {selected.history.length} step{selected.history.length !== 1 ? 's' : ''} so far
									</div>
								)}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	)
}
