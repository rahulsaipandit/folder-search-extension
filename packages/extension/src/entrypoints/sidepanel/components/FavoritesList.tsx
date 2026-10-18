import { ArrowLeft, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type FavoriteRecord, clearFavorites, deleteFavorite, listFavorites } from '@/lib/db'

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

export function FavoritesList({
	onSelect,
	onBack,
}: {
	onSelect: (prompt: string) => void
	onBack: () => void
}) {
	const [favorites, setFavorites] = useState<FavoriteRecord[]>([])
	const [loading, setLoading] = useState(true)

	const load = useCallback(async () => {
		setFavorites(await listFavorites())
		setLoading(false)
	}, [])

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		load()
	}, [load])

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation()
		await deleteFavorite(id)
		setFavorites((prev) => prev.filter((f) => f.id !== id))
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<Star className="size-3.5 text-yellow-500" />
				<span className="text-sm font-medium flex-1">Favorites</span>
				{favorites.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						onClick={async () => {
							await clearFavorites()
							setFavorites([])
						}}
						className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer h-6 px-2"
					>
						<Trash2 className="size-3 mr-1" />
						Clear All
					</Button>
				)}
			</header>

			{/* List */}
			<div className="flex-1 overflow-y-auto">
				{loading && (
					<div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
						Loading...
					</div>
				)}

				{!loading && favorites.length === 0 && (
					<div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
						<Star className="size-8 mb-2 opacity-50" />
						<p>No favorites yet</p>
						<p className="text-[10px] mt-1">Star your frequent prompts for quick access</p>
					</div>
				)}

				{favorites.map((favorite) => (
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
		</div>
	)
}
