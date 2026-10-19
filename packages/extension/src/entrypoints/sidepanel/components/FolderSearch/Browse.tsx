import { ArrowDown, ArrowUp, FileText, Music, Play } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import {
	type BrowseSort,
	type BrowseSortKey,
	browsableFiles,
	fileDir,
	fileExt,
	fileName,
	sortFiles,
} from '@/folder-search/browse'
import { formatBytes } from '@/folder-search/modelCatalog'
import type { FileRecord, FolderRecord, MediaHit, SearchKindFilter } from '@/folder-search/types'

import { Lightbox, open } from './Results'
import { useInView, useThumbUrl } from './thumbs'

type FolderMap = Map<string, FolderRecord>

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

/** Tilts toward the pointer and lifts, like the EmbeddingGemma demo. Disabled by `motion-reduce`. */
function ImageCard({ file, onOpen }: { file: FileRecord; onOpen: () => void }) {
	const [ref, visible] = useInView<HTMLButtonElement>()
	const url = useThumbUrl({ kind: 'image', fileId: file.fileId }, visible)
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
			{url ? (
				<img src={url} alt={name} className="block h-auto w-full" draggable={false} />
			) : (
				<span className="absolute inset-0 grid place-items-center p-2 text-center text-[10px] text-muted-foreground break-all">{name}</span>
			)}
			<span ref={shine} aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden" />
			<span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">{name}</span>
		</button>
	)
}

function ImageGallery({ files, folders, wide, onSimilar }: { files: FileRecord[]; folders: FolderMap; wide: boolean; onSimilar: (h: MediaHit) => void }) {
	// Newest first; identical copies carry no thumbnail, so they are left out of the wall.
	const images = useMemo(() => sortFiles(files.filter(f => !f.duplicateOf), { key: 'mtime', dir: 'desc' }), [files])
	const hits = useMemo(() => images.map(asHit), [images])
	const [lightbox, setLightbox] = useState<number | null>(null)
	const returnFocus = useRef<HTMLElement | null>(null)
	const close = () => {
		setLightbox(null)
		returnFocus.current?.focus()
	}
	return (
		<section aria-label="Images" style={{ perspective: 800 }}>
			<h3 className="mb-1.5 text-xs font-medium">Images · {images.length}</h3>
			<div className={wide ? 'columns-3 gap-2 lg:columns-4' : 'columns-2 gap-2'}>
				{images.map((f, i) => (
					<ImageCard
						key={f.fileId}
						file={f}
						onOpen={() => {
							returnFocus.current = document.activeElement as HTMLElement | null
							setLightbox(i)
						}}
					/>
				))}
			</div>
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
		</section>
	)
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
	const images = useMemo(() => listed.filter(f => f.kind === 'image'), [listed])
	const others = useMemo(() => listed.filter(f => f.kind !== 'image'), [listed])

	if (!listed.length) return <p className="py-6 text-center text-xs text-muted-foreground">No indexed files of this type yet.</p>
	return (
		<div className="space-y-4">
			{images.length > 0 && <ImageGallery files={images} folders={folders} wide={wide} onSimilar={onSimilar} />}
			{others.length > 0 && (
				<section aria-label="Files" className="space-y-1.5">
					{filter === 'all' && images.length > 0 && <h3 className="text-xs font-medium">Files · {others.length}</h3>}
					<FileTable files={others} folders={folders} />
				</section>
			)}
		</div>
	)
}
