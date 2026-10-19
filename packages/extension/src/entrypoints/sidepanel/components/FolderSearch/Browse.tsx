import { ArrowDown, ArrowUp, FileText, Music, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
	type BrowseSort,
	type BrowseSortKey,
	browsableFiles,
	fileDir,
	fileExt,
	fileName,
	filesKey,
	sortFiles,
} from '@/folder-search/browse'
import { getImageDims, getMediaUnit, unitIdOf } from '@/folder-search/db'
import { formatBytes } from '@/folder-search/modelCatalog'
import type { FileKind, FileRecord, FolderRecord, MediaHit, SearchKindFilter } from '@/folder-search/types'
import { formatDuration } from '@/folder-search/waveform'

import { AUDIO_TILE_ASPECT } from './glass/drawWaveform'
import { GlassWall } from './glass/GlassWall'
import { MediaViewer } from './MediaViewer'
import { Lightbox, open } from './Results'
import { useInView, useThumbUrl } from './thumbs'

type FolderMap = Map<string, FolderRecord>

/** Tiles shown before "Show more": bounds the DOM (one button per tile) and the layout work. */
const MAX_WALL_TILES = 1000

const COLUMNS: { key: BrowseSortKey; label: string; className: string }[] = [
	{ key: 'name', label: 'Name', className: 'min-w-0 flex-1' },
	{ key: 'mtime', label: 'Modified', className: 'hidden w-24 shrink-0 sm:block' },
	{ key: 'type', label: 'Type', className: 'hidden w-12 shrink-0 sm:block' },
	{ key: 'size', label: 'Size', className: 'w-16 shrink-0 text-right' },
]

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function asHit(f: FileRecord): MediaHit {
	return { folderId: f.folderId, fileId: f.fileId, relPath: f.relPath, kind: 'image', score: 0, calibrated: 0 }
}

/** Explorer-style "details" list: sortable Name / Modified / Type / Size. */
function FileTable({ files, folders }: { files: FileRecord[]; folders: FolderMap }) {
	const [sort, setSort] = useState<BrowseSort>({ key: 'name', dir: 'asc' })
	const rows = useMemo(() => sortFiles(files, sort), [files, sort])
	const toggle = (key: BrowseSortKey) =>
		setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'mtime' || key === 'size' ? 'desc' : 'asc' }))

	return (
		<div role="table" aria-label="Files" className="rounded-md border text-xs">
			<div role="row" className="flex gap-2 border-b bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
				{COLUMNS.map(c => (
					<button
						key={c.key}
						role="columnheader"
						aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
						onClick={() => toggle(c.key)}
						className={`flex items-center gap-0.5 hover:text-foreground ${c.className} ${c.className.includes('text-right') ? 'justify-end' : ''}`}
					>
						{c.label}
						{sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
					</button>
				))}
			</div>
			{rows.map(f => (
				<button
					key={f.fileId}
					role="row"
					onClick={() => void open(folders, f.folderId, f.relPath)}
					title={f.relPath}
					className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:ring-2 ring-ring outline-none"
				>
					<span className="flex min-w-0 flex-1 items-center gap-1.5">
						{f.kind === 'audio' ? <Music className="size-3.5 shrink-0 text-muted-foreground" /> : f.kind === 'video' ? <Play className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
						<span className="min-w-0">
							<span className="block truncate">{fileName(f.relPath)}</span>
							{fileDir(f.relPath) && <span className="block truncate text-[10px] text-muted-foreground">{fileDir(f.relPath)}</span>}
						</span>
					</span>
					<span className="hidden w-24 shrink-0 text-muted-foreground sm:block">{dateFmt.format(f.mtime)}</span>
					<span className="hidden w-12 shrink-0 text-muted-foreground sm:block">{fileExt(f.relPath)}</span>
					<span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
				</button>
			))}
		</div>
	)
}

/** The CSS wall's card: tilts toward the pointer. Images and video show their picture; audio a plain card. */
function CssCard({ file, onOpen }: { file: FileRecord; onOpen: () => void }) {
	const [ref, visible] = useInView<HTMLButtonElement>()
	const isAudio = file.kind === 'audio'
	const url = useThumbUrl(
		file.kind === 'image' ? { kind: 'image', fileId: file.fileId } : { kind: 'video', fileId: file.fileId, startSec: 0 },
		visible && !isAudio
	)
	const shine = useRef<HTMLSpanElement>(null)
	const name = fileName(file.relPath)

	const move = (e: React.PointerEvent<HTMLButtonElement>) => {
		const el = e.currentTarget
		const r = el.getBoundingClientRect()
		const x = (e.clientX - r.left) / r.width - 0.5
		const y = (e.clientY - r.top) / r.height - 0.5
		el.style.transform = `perspective(600px) rotateX(${(-y * 14).toFixed(1)}deg) rotateY(${(x * 14).toFixed(1)}deg) translateZ(12px) scale(1.04)`
		if (shine.current) shine.current.style.background = `radial-gradient(circle at ${(x + 0.5) * 100}% ${(y + 0.5) * 100}%, rgba(255,255,255,.35), transparent 55%)`
	}
	const leave = (e: React.PointerEvent<HTMLButtonElement>) => {
		e.currentTarget.style.transform = ''
		if (shine.current) shine.current.style.background = ''
	}

	return (
		<button
			ref={ref}
			onClick={onOpen}
			onPointerMove={move}
			onPointerLeave={leave}
			title={file.relPath}
			style={{ minHeight: url ? undefined : 96 }}
			className="group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-2xl border border-white/20 bg-muted/60 shadow-md transition-[transform,box-shadow] duration-150 ease-out hover:z-10 hover:shadow-xl focus-visible:ring-2 ring-ring outline-none motion-reduce:transition-none motion-reduce:hover:transform-none"
		>
			{isAudio ? (
				<span className="grid aspect-[4/3] place-items-center bg-gradient-to-br from-[#12363d] via-[#0c202b] to-[#080e1b] text-white/80">
					<Music className="size-8" aria-hidden />
				</span>
			) : url ? (
				<img src={url} alt={name} className="block h-auto w-full" draggable={false} />
			) : (
				<span className="absolute inset-0 grid place-items-center p-2 text-center text-[10px] text-muted-foreground break-all">{name}</span>
			)}
			{(file.kind === 'video' || isAudio) && (
				<span className="pointer-events-none absolute inset-x-[9%] top-[9%] flex items-center justify-between text-[11px] text-white/90">
					<span className="flex items-center gap-1.5 rounded-full border border-white/20 bg-[#07161c]/40 px-2 py-0.5 backdrop-blur-sm">
						<Play className="size-2.5 fill-current" aria-hidden />
						{isAudio ? 'Audio' : 'Video'}
					</span>
					<span className="tabular-nums [text-shadow:0_1px_6px_#0008]">{formatDuration(file.duration)}</span>
				</span>
			)}
			<span ref={shine} aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden" />
			<span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">{name}</span>
		</button>
	)
}

/** The previous wall: CSS columns with a pointer tilt. Used when the glass wall cannot run. */
function CssWall({ items, wide, onOpen }: { items: FileRecord[]; wide: boolean; onOpen: (index: number) => void }) {
	return (
		<div style={{ perspective: 800 }} className={wide ? 'columns-3 gap-2 lg:columns-4' : 'columns-2 gap-2'}>
			{items.map((f, i) => (
				<CssCard key={f.fileId} file={f} onOpen={() => onOpen(i)} />
			))}
		</div>
	)
}

/**
 * The index refreshes `files` many times while it rescans, each time with a new array holding the same
 * files. Anything keyed on the array's identity would then reset (the wall would drop its textures and
 * re-layout on every refresh), so keep the previous array until a file is added, removed or changed.
 */
function useStableFiles(files: FileRecord[]): FileRecord[] {
	const key = filesKey(files)
	return useMemo(() => files, [key])
}

interface LaidOut {
	items: FileRecord[]
	/** width / height of each item, aligned with `items` */
	aspects: number[]
}

async function thumbAspect(blob: Blob): Promise<number> {
	const bitmap = await createImageBitmap(blob)
	const aspect = bitmap.width / bitmap.height
	bitmap.close()
	return aspect
}

/** Shape of every tile, so the wall can be laid out before any picture loads. */
async function loadAspects(items: FileRecord[]): Promise<number[]> {
	const dims = await getImageDims(items.filter(f => f.kind === 'image').map(f => f.fileId))
	return Promise.all(
		items.map(async f => {
			if (f.kind === 'image') {
				const d = dims.get(f.fileId)
				return d && d.width > 0 && d.height > 0 ? d.width / d.height : 4 / 3
			}
			if (f.kind === 'audio') return AUDIO_TILE_ASPECT
			if (f.width && f.height) return f.width / f.height
			// A video indexed before its size was stored: take the shape of its poster frame.
			try {
				const blob = (await getMediaUnit(unitIdOf(f.fileId, 0)))?.thumbnail
				return blob ? await thumbAspect(blob) : 16 / 9
			} catch {
				return 16 / 9
			}
		})
	)
}

/**
 * The shapes of `items`, read from the index. The last good result is kept while a new one loads: the
 * wall must never unmount just because the list changed.
 */
function useLaidOut(items: FileRecord[], enabled: boolean): LaidOut | null {
	const [loaded, setLoaded] = useState<LaidOut | null>(null)
	useEffect(() => {
		if (!enabled) return
		let stale = false
		loadAspects(items)
			.then(aspects => !stale && setLoaded({ items, aspects }))
			.catch(e => console.warn('[folder-search] could not read item sizes for the wall', e))
		return () => {
			stale = true
		}
	}, [items, enabled])
	return loaded
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const WALL_KINDS: FileKind[] = ['image', 'video', 'audio']

/** Images, videos and audio on the glass wall. Documents are not here: they are in the table. */
function MediaWall({ files, title, folders, wide, onSimilar }: { files: FileRecord[]; title: string; folders: FolderMap; wide: boolean; onSimilar: (h: MediaHit) => void }) {
	// Newest first; identical copies carry no thumbnail, so they are left out of the wall.
	const all = useStableFiles(useMemo(() => sortFiles(files.filter(f => !f.duplicateOf), { key: 'mtime', dir: 'desc' }), [files]))
	const [limit, setLimit] = useState(MAX_WALL_TILES)
	const wanted = useMemo(() => all.slice(0, limit), [all, limit])
	const [lightbox, setLightbox] = useState<number | null>(null)
	const [viewing, setViewing] = useState<FileRecord | null>(null)
	const returnFocus = useRef<HTMLElement | null>(null)
	// Glass by default; CSS when asked for reduced motion, or when WebGL turns out to be unavailable.
	const [css, setCss] = useState(prefersReducedMotion)
	const wall = useLaidOut(wanted, !css)
	// What is on screen: the wall's own (possibly slightly older) list, so a click opens what was clicked.
	const items = css ? wanted : (wall?.items ?? wanted)
	const imageItems = useMemo(() => items.filter(f => f.kind === 'image'), [items])
	const hits = useMemo(() => imageItems.map(asHit), [imageItems])

	const openItem = (i: number) => {
		const item = items[i]
		if (!item) return
		returnFocus.current = document.activeElement as HTMLElement | null
		if (item.kind === 'image') setLightbox(imageItems.indexOf(item))
		else setViewing(item)
	}
	const close = () => {
		setLightbox(null)
		setViewing(null)
		returnFocus.current?.focus()
	}
	return (
		<section aria-label={title}>
			<h3 className="mb-1.5 text-xs font-medium">{title} · {all.length}</h3>
			{css ? (
				<CssWall items={items} wide={wide} onOpen={openItem} />
			) : wall ? (
				<GlassWall items={wall.items} aspects={wall.aspects} folders={folders} paused={lightbox !== null || viewing !== null} onOpen={openItem} onUnsupported={() => setCss(true)} />
			) : (
				<p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
			)}
			{all.length > limit && (
				<button className="mx-auto mt-2 block text-xs underline text-muted-foreground" onClick={() => setLimit(l => l + MAX_WALL_TILES)}>
					Show {Math.min(MAX_WALL_TILES, all.length - limit)} more
				</button>
			)}
			{lightbox !== null && hits[lightbox] && (
				<Lightbox
					hits={hits}
					index={lightbox}
					folders={folders}
					onIndex={setLightbox}
					onClose={close}
					onSimilar={h => {
						close()
						onSimilar(h)
					}}
				/>
			)}
			{viewing && (
				<MediaViewer
					item={viewing}
					folder={folders.get(viewing.folderId)}
					onClose={close}
					onOpenOriginal={() => void open(folders, viewing.folderId, viewing.relPath)}
				/>
			)}
		</section>
	)
}

const WALL_TITLE: Record<SearchKindFilter, string> = {
	all: 'Media',
	images: 'Images',
	documents: 'Media',
	'audio-video': 'Audio & video',
}

/** What the panel shows while the search box is empty: the indexed files under the active chip. */
export function BrowseView({
	files,
	filter,
	folders,
	wide,
	onSimilar,
}: {
	files: FileRecord[]
	filter: SearchKindFilter
	folders: FolderMap
	wide: boolean
	onSimilar: (h: MediaHit) => void
}) {
	const listed = useMemo(() => browsableFiles(files, filter), [files, filter])
	const media = useMemo(() => listed.filter(f => WALL_KINDS.includes(f.kind)), [listed])
	const documents = useMemo(() => listed.filter(f => !WALL_KINDS.includes(f.kind)), [listed])

	if (!listed.length) return <p className="py-6 text-center text-xs text-muted-foreground">No indexed files of this type yet.</p>
	return (
		<div className="space-y-4">
			{media.length > 0 && <MediaWall files={media} title={WALL_TITLE[filter]} folders={folders} wide={wide} onSimilar={onSimilar} />}
			{documents.length > 0 && (
				<section aria-label="Documents" className="space-y-1.5">
					{filter === 'all' && media.length > 0 && <h3 className="text-xs font-medium">Documents · {documents.length}</h3>}
					<FileTable files={documents} folders={folders} />
				</section>
			)}
		</div>
	)
}
