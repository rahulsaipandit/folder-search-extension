import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { isFavorite, removeFavoriteByPrompt, saveFavorite } from '@/lib/db'

export function FavoriteButton({ prompt }: { prompt: string }) {
	const isEmpty = !prompt.trim()
	const [isFav, setIsFav] = useState(false)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		isFavorite(prompt).then((result) => {
			setIsFav(result)
			setLoading(false)
		})
	}, [prompt])

	const handleToggle = async () => {
		if (loading) return

		setLoading(true)
		try {
			if (isFav) {
				await removeFavoriteByPrompt(prompt)
				setIsFav(false)
				console.log('[SidePanel] Removed from favorites')
			} else {
				await saveFavorite(prompt)
				setIsFav(true)
				console.log('[SidePanel] Saved to favorites')
			}
		} catch (err) {
			console.error('[SidePanel] Failed to toggle favorite:', err)
		} finally {
			setLoading(false)
		}
	}

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={handleToggle}
			disabled={loading || isEmpty}
			className="p-0.5 cursor-pointer"
			title={isFav ? 'Remove from favorites' : 'Save to favorites'}
		>
			<Star className={`size-3.5 ${isEmpty ? 'text-muted-foreground/40' : isFav ? 'fill-yellow-500 text-yellow-500' : ''}`} />
		</Button>
	)
}
