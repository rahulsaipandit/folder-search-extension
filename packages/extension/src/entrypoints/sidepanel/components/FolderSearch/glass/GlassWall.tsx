import { Pause, Play } from 'lucide-react'
import { type RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fileName } from '@/folder-search/browse'
import { getImageVector, getMediaUnit, patchFileMeta, unitIdOf } from '@/folder-search/db'
import { readFolderFile } from '@/folder-search/fileAccess'
import { type MediaMeta, definedOnly } from '@/folder-search/mediaMeta'
import type { FileRecord, FolderRecord } from '@/folder-search/types'
import { formatDuration } from '@/folder-search/waveform'

import { GLASS_PAD, GlassRenderer, type TileSource } from './GlassRenderer'
import { WallMedia } from './WallMedia'
import { type Tile, justifiedLayout, targetRowHeight, tilesInBand } from './layout'

const GAP = 8
/** After this long without the context coming back, give up on WebGL and use the CSS wall. */
const CONTEXT_RESTORE_MS = 2000

interface Props {
	/** Images, videos and audio files, in display order */
	items: FileRecord[]
	/** width / height of each item, aligned with `items` */
	aspects: number[]
	folders: Map<string, FolderRecord>
	/** A viewer is open: stop playing and animating behind it. */
	paused: boolean
	onOpen: (index: number) => void
	/** WebGL2 or the shaders are unavailable, or the context was lost for good. */
	onUnsupported: () => void
}

/** The nearest ancestor that scrolls (the side panel scrolls inside a div, not the window). */
function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const o = getComputedStyle(p).overflowY
		if (o === 'auto' || o === 'scroll' || o === 'overlay') return p
	}
	return null
}

/** The first picture of a tile: a stored thumbnail, or the audio card. */
async function poster(item: FileRecord, media: WallMedia | null): Promise<TileSource | undefined> {
	if (item.kind === 'image') return (await getImageVector(item.fileId))?.thumbnail
	if (item.kind === 'video') return (await getMediaUnit(unitIdOf(item.fileId, 0)))?.thumbnail
	if (item.kind === 'audio') return media?.audioPoster(item)
	return undefined
}

interface WallTileProps {
	item: FileRecord
	index: number
	rect: Tile
	playing: boolean
	/** Formatted length, or '' */
	duration: string
	renderer: RefObject<GlassRenderer | null>
	onOpen: (index: number) => void
}

/**
 * The transparent button over one tile: hit-testing, focus, the kind/length labels and the hover name.
 * Memoised, because up to a thousand of these exist and only a few change at a time (playing, a length
 * learned, a resize).
 */
const WallTile = memo(function WallTile({ item, index, rect, playing, duration, renderer, onOpen }: WallTileProps) {
	const name = fileName(item.relPath)
	const isMedia = item.kind === 'video' || item.kind === 'audio'
	return (
		<button
			type="button"
			aria-label={isMedia ? `${name}, ${item.kind}${duration ? `, ${duration}` : ''}` : name}
			title={item.relPath}
			onClick={() => onOpen(index)}
			onPointerEnter={e => {
				if (e.pointerType !== 'touch') renderer.current?.setHover(index)
			}}
			onPointerLeave={() => renderer.current?.setHover(null)}
			onFocus={e => {
				if (!e.currentTarget.matches(':focus-visible')) return
				renderer.current?.setFocus(index)
				renderer.current?.setHover(index)
			}}
			onBlur={() => {
				renderer.current?.setFocus(null)
				renderer.current?.setHover(null)
			}}
			className="group absolute z-10 cursor-pointer bg-transparent outline-none focus-visible:ring-2 ring-ring"
			style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: Math.min(rect.w, rect.h) * 0.16 }}
		>
			{isMedia && (
				<span className="pointer-events-none absolute inset-x-[9%] top-[9%] flex items-center justify-between text-[11px] text-white/90">
					<span className="flex items-center gap-1.5 rounded-full border border-white/20 bg-[#07161c]/40 px-2 py-0.5 backdrop-blur-sm">
						{playing ? <Pause className="size-2.5 fill-current" aria-hidden /> : <Play className="size-2.5 fill-current" aria-hidden />}
						{item.kind === 'audio' ? 'Audio' : 'Video'}
					</span>
					<span className="tabular-nums [text-shadow:0_1px_6px_#0008]">{duration}</span>
				</span>
			)}
			<span className="pointer-events-none absolute inset-x-2 bottom-2 truncate rounded-full bg-black/55 px-2 py-0.5 text-center text-[10px] text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
				{name}
			</span>
		</button>
	)
})

/**
 * The glass wall (design §4B.3). A tall wrapper provides native scrolling; a sticky canvas paints the
 * slice that is on screen; a transparent button per tile on top does hit-testing, focus, labels and clicks.
 */
export function GlassWall({ items, aspects, folders, paused, onOpen, onUnsupported }: Props) {
	const wrapRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const rendererRef = useRef<GlassRenderer | null>(null)
	const mediaRef = useRef<WallMedia | null>(null)
	const itemsRef = useRef(items)
	/** The list the renderer was last given, to tell "new files" from "same files, new rectangles". */
	const appliedItems = useRef<FileRecord[] | null>(null)
	const foldersRef = useRef(folders)
	const unsupportedRef = useRef(onUnsupported)
	const onOpenRef = useRef(onOpen)
	const [width, setWidth] = useState(0)
	const [viewH, setViewH] = useState(0)
	const [playing, setPlaying] = useState<ReadonlySet<number>>(new Set())
	/** Duration/size/peaks learned while showing files that were indexed without them. */
	const [learned, setLearned] = useState<ReadonlyMap<string, MediaMeta>>(new Map())

	useEffect(() => {
		unsupportedRef.current = onUnsupported
		foldersRef.current = folders
		onOpenRef.current = onOpen
	}, [onUnsupported, folders, onOpen])
	const open = useCallback((index: number) => onOpenRef.current(index), [])

	const layout = useMemo(
		() => justifiedLayout(aspects, width, GAP, targetRowHeight(width)),
		[aspects, width]
	)
	const canvasH = Math.max(1, Math.min(viewH || window.innerHeight, layout.height))

	// One renderer, and the media manager that animates its tiles, for the lifetime of the component.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		let lostTimer = 0
		const renderer = GlassRenderer.create(canvas, i => poster(itemsRef.current[i]!, mediaRef.current), {
			onContextLost: () => {
				lostTimer = window.setTimeout(() => unsupportedRef.current(), CONTEXT_RESTORE_MS)
			},
			onContextRestored: () => window.clearTimeout(lostTimer),
		})
		if (!renderer) {
			unsupportedRef.current()
			return
		}
		const media = new WallMedia({
			renderer,
			openFile: item => {
				const folder = foldersRef.current.get(item.folderId)
				if (!folder) throw new Error('The folder is no longer indexed')
				return readFolderFile(folder, item.relPath)
			},
			onPlaying: setPlaying,
			onMeta: (item, meta) => {
				const fresh = definedOnly(meta)
				if (!Object.keys(fresh).length) return
				setLearned(prev => new Map(prev).set(item.fileId, { ...prev.get(item.fileId), ...fresh }))
				patchFileMeta(item.fileId, item.mtime, fresh).catch(e => console.warn('[folder-search] could not save media details', e))
			},
		})
		rendererRef.current = renderer
		mediaRef.current = media
		appliedItems.current = null // a new renderer has no tiles yet
		return () => {
			window.clearTimeout(lostTimer)
			media.dispose()
			renderer.dispose()
			rendererRef.current = null
			mediaRef.current = null
		}
	}, [])

	// Track the wrapper's width and the scroller's height.
	useEffect(() => {
		const wrap = wrapRef.current
		if (!wrap) return
		const scroller = scrollParent(wrap)
		const measure = () => {
			setWidth(Math.floor(wrap.clientWidth))
			setViewH(scroller ? scroller.clientHeight : window.innerHeight)
		}
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(wrap)
		if (scroller) ro.observe(scroller)
		else window.addEventListener('resize', measure)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', measure)
		}
	}, [])

	// New files: start over. Same files in new places (the panel was resized): only move the rectangles,
	// so loaded pictures, hover and playing videos survive a drag of the panel edge.
	useEffect(() => {
		itemsRef.current = items
		const renderer = rendererRef.current
		if (appliedItems.current !== items) {
			appliedItems.current = items
			renderer?.setTiles(layout.tiles)
			mediaRef.current?.setItems(items)
		} else {
			renderer?.setLayout(layout.tiles)
		}
	}, [items, layout])
	useEffect(() => {
		rendererRef.current?.setViewport(width + 2 * GLASS_PAD, canvasH, window.devicePixelRatio || 1)
	}, [width, canvasH])
	useEffect(() => {
		mediaRef.current?.setPaused(paused)
	}, [paused])

	// Scroll: how far the sticky canvas has moved down inside the wrapper is the slice it must draw.
	// The same offset says which tiles are near enough to play or animate.
	useEffect(() => {
		const wrap = wrapRef.current
		const canvas = canvasRef.current
		if (!wrap || !canvas) return
		const target: HTMLElement | Window = scrollParent(wrap) ?? window
		const update = () => {
			const offset = Math.max(0, canvas.getBoundingClientRect().top - wrap.getBoundingClientRect().top)
			rendererRef.current?.setScroll(offset)
			const mid = offset + canvasH / 2
			const near = tilesInBand(layout.tiles, offset - canvasH * 0.25, offset + canvasH * 1.25)
				.map(i => ({ i, d: Math.abs(layout.tiles[i]!.y + layout.tiles[i]!.h / 2 - mid) }))
				.sort((a, b) => a.d - b.d)
				.map(x => x.i)
			mediaRef.current?.setNear(near)
		}
		update()
		target.addEventListener('scroll', update, { passive: true })
		return () => target.removeEventListener('scroll', update)
	}, [layout, canvasH, items])

	return (
		<div
			ref={wrapRef}
			className="relative"
			style={{ height: layout.height }}
			onPointerMove={e => {
				if (e.pointerType === 'touch') return
				const r = canvasRef.current?.getBoundingClientRect()
				if (!r) return
				rendererRef.current?.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
			}}
			onPointerLeave={() => rendererRef.current?.setPointer(null)}
		>
			<canvas
				ref={canvasRef}
				aria-hidden
				className="pointer-events-none sticky top-0 z-0 block max-w-none"
				style={{ width: width + 2 * GLASS_PAD, height: canvasH, marginLeft: -GLASS_PAD }}
			/>
			{layout.tiles.map((rect, i) => {
				const item = items[i]
				if (!item) return null
				return (
					<WallTile
						key={item.fileId}
						item={item}
						index={i}
						rect={rect}
						playing={playing.has(i)}
						duration={formatDuration(learned.get(item.fileId)?.duration ?? item.duration)}
						renderer={rendererRef}
						onOpen={open}
					/>
				)
			})}
		</div>
	)
}
