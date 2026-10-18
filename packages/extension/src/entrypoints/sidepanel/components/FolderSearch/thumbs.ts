import { useEffect, useRef, useState } from 'react'

import { VIDEO_SEGMENT_SEC } from '@/folder-search/videoPlan'
import { getChunk, getImageVector, getMediaUnit, pageChunkId, unitIdOf } from '@/folder-search/db'

export interface ThumbRef {
	kind: 'image' | 'video' | 'audio' | 'page'
	fileId: string
	page?: number
	startSec?: number
}

async function loadThumb(ref: ThumbRef): Promise<Blob | undefined> {
	if (ref.kind === 'image') return (await getImageVector(ref.fileId))?.thumbnail
	if (ref.kind === 'page') return (await getChunk(pageChunkId(ref.fileId, ref.page ?? 1)))?.thumbnail
	if (ref.kind === 'video') {
		// Soundtrack hits can start between segment boundaries; show the segment that contains them.
		const at = ref.startSec ?? 0
		const segment = Math.floor(at / VIDEO_SEGMENT_SEC) * VIDEO_SEGMENT_SEC
		return (
			(await getMediaUnit(unitIdOf(ref.fileId, at)))?.thumbnail ??
			(await getMediaUnit(unitIdOf(ref.fileId, segment)))?.thumbnail
		)
	}
	return undefined
}

/** True once the element has scrolled near the viewport, and false again when far away. */
export function useInView<T extends Element>(margin = '300px') {
	const ref = useRef<T | null>(null)
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const io = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? false), { rootMargin: margin })
		io.observe(el)
		return () => io.disconnect()
	}, [margin])
	return [ref, visible] as const
}

/**
 * Object URL for a stored thumbnail, created only while `enabled` and revoked when it leaves.
 * This is what keeps a large gallery cheap: off-screen tiles hold no decoded image.
 */
export function useThumbUrl(ref: ThumbRef, enabled: boolean): string | null {
	const [url, setUrl] = useState<string | null>(null)
	const { kind, fileId, page, startSec } = ref
	useEffect(() => {
		if (!enabled) return
		let revoked = false
		let made: string | null = null
		loadThumb({ kind, fileId, page, startSec })
			.then(blob => {
				if (!blob || revoked) return
				made = URL.createObjectURL(blob)
				setUrl(made)
			})
			.catch(e => console.warn('[folder-search] thumbnail load failed', e))
		return () => {
			revoked = true
			if (made) URL.revokeObjectURL(made)
			setUrl(null)
		}
	}, [enabled, kind, fileId, page, startSec])
	return url
}
