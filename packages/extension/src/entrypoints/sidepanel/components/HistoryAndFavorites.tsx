import { ArrowLeft, CheckCircle, Loader2, Star, Trash2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { deleteFavorite, deleteSession, listFavorites, listSessions } from '@/lib/db'

function timeAgo(ts: number): string {
	const seconds = Math.floor((Date.now() - ts) / 1000)
	if (seconds < 60) return 'just now'
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

export function HistoryAndFavorites({
	onHistorySelect,
	onFavoriteSelect,
	onBack,
}: {
	onHistorySelect: (id: string) => void
	onFavoriteSelect: (prompt: string) => void
	onBack: () => void
}) {
	const [activeTab, setActiveTab] = useState<'history' | 'favorites'>('history')

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium flex-1">History & Favorites</span>
			</header>

			{/* Tabs */}
			<div className="flex border-b">
				<button
					className={`flex-1 py-2 px-3 text-xs font-medium transition-colors ${
						activeTab === 'history'
							? 'text-foreground border-b-2 border-primary'
							: 'text-muted-foreground hover:text-foreground'
					}`}
					onClick={() => setActiveTab('history')}
				>
					History
				</button>
				<button
					className={`flex-1 py-2 px-3 text-xs font-medium transition-colors ${
						activeTab === 'favorites'
							? 'text-foreground border-b-2 border-primary'
							: 'text-muted-foreground hover:text-foreground'
					}`}
					onClick={() => setActiveTab('favorites')}
				>
					Favorites
				</button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === 'history' ? (
					<div className="flex flex-col h-full">
						{/* Remove header from HistoryList */}
						<div className="flex-1 overflow-y-auto">
							<HistoryListContent onSelect={onHistorySelect} />
						</div>
					</div>
				) : (
					<div className="flex flex-col h-full">
						{/* Remove header from FavoritesList */}
						<div className="flex-1 overflow-y-auto">
							<FavoritesListContent onSelect={onFavoriteSelect} />
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// Extract content from HistoryList without header
function HistoryListContent({ onSelect }: { onSelect: (id: string) => void }) {
	const [sessions, setSessions] = useState<any[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const load = async () => {
			setSessions(await listSessions())
			setLoading(false)
		}
		load()
	}, [])

	// Poll while any session is in_progress
	useEffect(() => {
		const hasInProgress = sessions.some((s: any) => s.status === 'in_progress')
		if (!hasInProgress) return
		const interval = setInterval(() => {
			const load = async () => {
				setSessions(await listSessions())
			}
			load()
		}, 2000)
		return () => clearInterval(interval)
	}, [sessions])

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation()
		await deleteSession(id)
		setSessions((prev) => prev.filter((s: any) => s.id !== id))
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
				Loading...
			</div>
		)
	}

	if (sessions.length === 0) {
		return (
			<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
				No history yet
			</div>
		)
	}

	return (
		<div>
			{sessions.map((session: any) => (
				<div
					key={session.id}
					role="button"
					tabIndex={0}
					onClick={() => onSelect(session.id)}
					onKeyDown={(e) => e.key === 'Enter' && onSelect(session.id)}
					className="w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors cursor-pointer flex items-start gap-2 group"
				>
					{/* Status icon */}
					{session.status === 'completed' && <CheckCircle className="size-3.5 text-green-500 shrink-0 mt-0.5" />}
					{session.status === 'in_progress' && <Loader2 className="size-3.5 text-blue-500 shrink-0 mt-0.5 animate-spin" />}
					{session.status === 'failed' && <XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />}

					{/* Content */}
					<div className="flex-1 min-w-0">
						<p className="text-xs font-medium truncate">{session.task}</p>
						<p className="text-[10px] text-muted-foreground mt-0.5">
							{session.status === 'in_progress'
								? `Running · ${session.history.length} steps so far`
								: `${timeAgo(session.updatedAt ?? session.createdAt)} · ${session.history.length} steps`}
						</p>
					</div>

					{/* Delete */}
					<button
						type="button"
						onClick={(e) => handleDelete(e, session.id)}
						className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive cursor-pointer shrink-0"
					>
						<Trash2 className="size-3" />
					</button>
				</div>
			))}
		</div>
	)
}

// Extract content from FavoritesList without header
function FavoritesListContent({ onSelect }: { onSelect: (prompt: string) => void }) {
	const [favorites, setFavorites] = useState<any[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const load = async () => {
			setFavorites(await listFavorites())
			setLoading(false)
		}
		load()
	}, [])

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation()
		await deleteFavorite(id)
		setFavorites((prev) => prev.filter((f: any) => f.id !== id))
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
				Loading...
			</div>
		)
	}

	if (favorites.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
				<Star className="size-8 mb-2 opacity-50" />
				<p>No favorites yet</p>
				<p className="text-[10px] mt-1">Star your frequent prompts for quick access</p>
			</div>
		)
	}

	return (
		<div>
			{favorites.map((favorite: any) => (
				<div
					key={favorite.id}
					role="button"
					tabIndex={0}
					onClick={() => onSelect(favorite.prompt)}
					onKeyDown={(e) => e.key === 'Enter' && onSelect(favorite.prompt)}
					className="w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors cursor-pointer flex items-start gap-2 group"
				>
					{/* Star icon */}
					<Star className="size-3.5 text-yellow-500 shrink-0 mt-0.5 fill-yellow-500" />

					{/* Content */}
					<div className="flex-1 min-w-0">
						<p className="text-xs font-medium truncate">{favorite.prompt}</p>
						<p className="text-[10px] text-muted-foreground mt-0.5">
							{timeAgo(favorite.createdAt)}
						</p>
					</div>

					{/* Delete */}
					<button
						type="button"
						onClick={(e) => handleDelete(e, favorite.id)}
						className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive cursor-pointer shrink-0"
					>
						<Trash2 className="size-3" />
					</button>
				</div>
			))}
		</div>
	)
}