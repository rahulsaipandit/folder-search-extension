import { ArrowLeft, MessageSquarePlus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SessionRecord, deleteSession, getSession } from '@/lib/db'

import { FavoriteButton } from '../entrypoints/sidepanel/components/FavoriteButton'
import { EventCard } from './cards'
import { SessionWorkflowStrip } from '../entrypoints/sidepanel/components/SessionWorkflowStrip'

export function HistoryDetail({
	sessionId,
	onBack,
	onContinue,
	onRetry,
}: {
	sessionId: string
	onBack: () => void
	onContinue: (sessionId: string) => void
	onRetry: (sessionId: string) => void
}) {
	const [session, setSession] = useState<SessionRecord | null>(null)

	useEffect(() => {
		getSession(sessionId).then((s) => setSession(s ?? null))
	}, [sessionId])

	if (!session) {
		return (
			<div className="flex items-center justify-center h-screen text-xs text-muted-foreground">
				Loading...
			</div>
		)
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium truncate flex-1">History</span>
				<FavoriteButton prompt={session.task} />
			</header>

			{/* Task */}
			<div className="border-b px-3 py-2 bg-muted/30">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide">Task</div>
				<div className="text-xs font-medium" title={session.task}>
					{session.task}
				</div>
				<div className="mt-2 flex items-center gap-2">
					<button
						type="button"
						onClick={async () => {
							await deleteSession(sessionId)
							onBack()
						}}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
					>
						<Trash2 className="size-3" />
						Delete
					</button>
				</div>
			</div>

			{/* Workflow step strip */}
			<SessionWorkflowStrip history={session.history} status={session.status} />

			{/* Events (read-only) */}
			<div className="flex-1 overflow-y-auto p-3 space-y-2">
				{session.history.map((event, index) => (
					// eslint-disable-next-line react-x/no-array-index-key
					<EventCard key={index} event={event} />
				))}
			</div>

			{/* Actions - only shown for actionable statuses */}
			{session.status === 'completed' && (
				<div className="border-t px-3 py-2 bg-background">
					<Button
						className="w-full text-xs"
						onClick={() => onContinue(session.id)}
					>
						<MessageSquarePlus className="size-3.5 mr-1.5" />
						Continue this conversation
					</Button>
				</div>
			)}
			{session.status === 'error' && (
				<div className="border-t px-3 py-2 bg-background">
					<Button
						className="w-full text-xs"
						variant="secondary"
						onClick={() => onRetry(session.id)}
					>
						<RotateCcw className="size-3.5 mr-1.5" />
						Retry with prior context
					</Button>
				</div>
			)}
		</div>
	)
}
