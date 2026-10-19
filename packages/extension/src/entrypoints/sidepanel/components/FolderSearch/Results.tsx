import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Layers, Loader2, Music, Play, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { type AskSource, buildAskMessages, citedSources, pickSources } from '@/folder-search/ask'
import { openResult, readFolderFile } from '@/folder-search/fileAccess'
import { highlightParts } from '@/folder-search/highlight'
import type { DocumentHit, FolderRecord, MediaHit, SearchResponse } from '@/folder-search/types'
import { useScopedLLM } from '@/llm/useScopedLLM'
import { type UnifiedSettings, loadSettings } from '@/shared/settings'

import { useInView, useThumbUrl } from './thumbs'

type FolderMap = Map<string, FolderRecord>

const INITIAL_MEDIA = 9
const INITIAL_DOCS = 6

export async function open(folders: FolderMap, folderId: string, relPath: string, at: { page?: number; startSec?: number } = {}) {
	const folder = folders.get(folderId)
	if (!folder) return toast.error('That folder is no longer indexed')
	try {
		const how = await openResult(folder, relPath, at)
		if (how === 'downloaded') toast.success('Saved a copy to your downloads')
	} catch (e) {
		toast.error(`Couldn’t open the file. If the browser restarted, reconnect the folder. ${e instanceof Error ? e.message : ''}`)
	}
}

export function fmtTime(sec: number): string {
	const m = Math.floor(sec / 60)
	return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

function Tile({ hit, onOpen }: { hit: MediaHit; onOpen: () => void }) {
	const [ref, visible] = useInView<HTMLButtonElement>()
	const url = useThumbUrl(
		{ kind: hit.kind, fileId: hit.fileId, startSec: hit.startSec },
		visible && hit.kind !== 'audio'
	)
	const name = hit.relPath.split('/').pop() ?? hit.relPath
	return (
		<button
			ref={ref}
			onClick={onOpen}
			title={`${hit.relPath}${hit.duplicates?.length ? `\nAlso at: ${hit.duplicates.join(', ')}` : ''}`}
			className="group relative aspect-square overflow-hidden rounded-md bg-muted/60 border focus-visible:ring-2 ring-ring outline-none"
		>
			{url && <img src={url} alt={name} className="size-full object-cover" draggable={false} />}
			{hit.kind === 'audio' && <Music className="absolute inset-0 m-auto size-6 text-muted-foreground" />}
			{hit.kind === 'video' && <Play className="absolute right-1 top-1 size-3.5 text-white drop-shadow" />}
			{hit.startSec !== undefined && hit.kind !== 'image' && (
				<span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{fmtTime(hit.startSec)}</span>
			)}
			{hit.duplicates?.length ? (
				<span className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
					<Layers className="size-2.5" />{hit.duplicates.length + 1}
				</span>
			) : null}
			<span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
				<span className="block truncate">{name}</span>
				{/* Raw similarity, as in the EmbeddingGemma demo. Filename-only matches have no vector score. */}
				{hit.score > 0 && (
					<span className="block tabular-nums text-white/75" title="Cosine similarity to the query">
						Relevance <span className="text-white">{hit.score.toFixed(3)}</span>
					</span>
				)}
			</span>
		</button>
	)
}

export function MediaSection({
	hits,
	folders,
	wide,
	onSimilar,
}: {
	hits: MediaHit[]
	folders: FolderMap
	wide: boolean
	onSimilar: (h: MediaHit) => void
}) {
	const [all, setAll] = useState(false)
	const [lightbox, setLightbox] = useState<number | null>(null)
	const returnFocus = useRef<HTMLElement | null>(null)
	const shown = all ? hits : hits.slice(0, INITIAL_MEDIA)
	const images = hits.filter(h => h.kind === 'image')

	const openHit = (h: MediaHit) => {
		returnFocus.current = document.activeElement as HTMLElement | null
		if (h.kind === 'image') setLightbox(images.findIndex(i => i.fileId === h.fileId))
		else void open(folders, h.folderId, h.relPath, { startSec: h.startSec })
	}
	const close = () => {
		setLightbox(null)
		returnFocus.current?.focus()
	}

	return (
		<section aria-label="Media">
			<header className="flex items-center justify-between mb-1.5">
				<h3 className="text-xs font-medium">Media · {hits.length}</h3>
				{hits.length > INITIAL_MEDIA && (
					<button className="text-xs underline text-muted-foreground" onClick={() => setAll(v => !v)}>
						{all ? 'Show fewer' : 'See all'}
					</button>
				)}
			</header>
			<div className={`grid gap-1.5 ${wide ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8' : 'grid-cols-3'}`}>
				{shown.map(h => <Tile key={`${h.fileId}@${h.startSec ?? 0}`} hit={h} onOpen={() => openHit(h)} />)}
			</div>
			{lightbox !== null && images[lightbox] && (
				<Lightbox
					hits={images}
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

export function Lightbox({
	hits,
	index,
	folders,
	onIndex,
	onClose,
	onSimilar,
}: {
	hits: MediaHit[]
	index: number
	folders: FolderMap
	onIndex: (i: number) => void
	onClose: () => void
	onSimilar: (h: MediaHit) => void
}) {
	const hit = hits[index]!
	const [src, setSrc] = useState<string | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const [zoom, setZoom] = useState(false)
	const closeBtn = useRef<HTMLButtonElement>(null)
	const thumb = useThumbUrl({ kind: 'image', fileId: hit.fileId }, true)

	useEffect(() => {
		let url: string | null = null
		let dead = false
		setSrc(null)
		setErr(null)
		setZoom(false)
		const folder = folders.get(hit.folderId)
		if (!folder) return
		readFolderFile(folder, hit.relPath)
			.then(f => {
				if (dead) return
				url = URL.createObjectURL(f)
				setSrc(url)
			})
			.catch(e => !dead && setErr(`Original unavailable (reconnect the folder to view it): ${e instanceof Error ? e.message : e}`))
		return () => {
			dead = true
			if (url) URL.revokeObjectURL(url)
		}
	}, [hit.fileId, hit.folderId, hit.relPath, folders])

	const step = useCallback((d: number) => onIndex((index + d + hits.length) % hits.length), [index, hits.length, onIndex])
	useEffect(() => {
		closeBtn.current?.focus()
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
			else if (e.key === 'ArrowRight') step(1)
			else if (e.key === 'ArrowLeft') step(-1)
		}
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [onClose, step])

	return (
		<div role="dialog" aria-modal="true" aria-label={hit.relPath} className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white">
			<div className="flex items-center gap-2 p-2 text-xs">
				<span className="flex-1 truncate" title={hit.relPath}>{hit.relPath}</span>
				<Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-white/10" onClick={() => onSimilar(hit)}>
					<Sparkles className="size-3" /> Find similar
				</Button>
				<Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-white/10" onClick={() => navigator.clipboard.writeText(hit.relPath).then(() => toast.success('Path copied'))}>
					<Copy className="size-3" /> Copy path
				</Button>
				<Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-white/10" onClick={() => void open(folders, hit.folderId, hit.relPath)}>
					<ExternalLink className="size-3" /> Open original
				</Button>
				<Button ref={closeBtn} size="icon-sm" variant="ghost" className="size-7 text-white hover:bg-white/10" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
			</div>
			<div className="relative flex-1 min-h-0 flex items-center justify-center overflow-auto">
				{hits.length > 1 && (
					<>
						<button className="absolute left-1 z-10 rounded-full bg-black/50 p-1.5" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft className="size-5" /></button>
						<button className="absolute right-1 z-10 rounded-full bg-black/50 p-1.5" onClick={() => step(1)} aria-label="Next"><ChevronRight className="size-5" /></button>
					</>
				)}
				{err ? (
					<div className="text-center space-y-2 p-4">
						{thumb && <img src={thumb} alt={hit.relPath} className="mx-auto max-h-64 opacity-80" />}
						<p className="text-xs text-amber-300 break-words">{err}</p>
					</div>
				) : src ? (
					<img
						src={src}
						alt={hit.relPath}
						onClick={() => setZoom(z => !z)}
						className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full object-contain cursor-zoom-in'}
					/>
				) : (
					<Loader2 className="size-6 animate-spin" />
				)}
			</div>
			<p className="p-1.5 text-center text-[11px] text-white/70">
				{index + 1} / {hits.length}
				{hit.duplicates?.length ? ` · identical copies: ${hit.duplicates.join(', ')}` : ''}
			</p>
		</div>
	)
}

function DocumentCard({ hit, folders, query }: { hit: DocumentHit; folders: FolderMap; query: string }) {
	const [ref, visible] = useInView<HTMLButtonElement>()
	const thumb = useThumbUrl({ kind: 'page', fileId: hit.fileId, page: hit.page }, visible && hit.hasPageThumbnail)
	const name = hit.relPath.split('/').pop() ?? hit.relPath
	const dir = hit.relPath.includes('/') ? hit.relPath.slice(0, hit.relPath.lastIndexOf('/')) : ''
	const terms = hit.matchedTerms.length ? hit.matchedTerms : query.split(/\s+/)
	return (
		<button
			ref={ref}
			onClick={() => void open(folders, hit.folderId, hit.relPath, { page: hit.page })}
			className="flex w-full gap-2 rounded-md border p-2 text-left hover:bg-accent/50 focus-visible:ring-2 ring-ring outline-none"
		>
			<FileText className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
			<span className="min-w-0 flex-1 space-y-0.5">
				<span className="flex items-baseline gap-2 text-xs">
					<span className="truncate font-medium" title={hit.relPath}>{name}</span>
					{hit.page && <span className="text-muted-foreground">p.{hit.page}</span>}
					<span className="ml-auto tabular-nums text-muted-foreground" title="Match strength (standard deviations above typical)">
						{hit.calibrated.toFixed(1)}σ
					</span>
				</span>
				{dir && <span className="block truncate text-[11px] text-muted-foreground">{dir}</span>}
				{hit.snippet && (
					<span className="block text-xs text-muted-foreground line-clamp-3">
						{highlightParts(hit.snippet, terms).map((p, i) =>
							p.hit ? <mark key={i} className="bg-yellow-300/50 dark:bg-yellow-500/30 text-foreground rounded-sm">{p.text}</mark> : <span key={i}>{p.text}</span>
						)}
					</span>
				)}
				{thumb && <img src={thumb} alt={`Page ${hit.page} of ${name}`} className="mt-1 h-24 rounded border object-contain bg-white" />}
			</span>
		</button>
	)
}

export function DocumentSection({ hits, folders, query }: { hits: DocumentHit[]; folders: FolderMap; query: string }) {
	const [all, setAll] = useState(false)
	const shown = all ? hits : hits.slice(0, INITIAL_DOCS)
	return (
		<section aria-label="Documents">
			<header className="flex items-center justify-between mb-1.5">
				<h3 className="text-xs font-medium">Documents · {hits.length}</h3>
				{hits.length > INITIAL_DOCS && (
					<button className="text-xs underline text-muted-foreground" onClick={() => setAll(v => !v)}>
						{all ? 'Show fewer' : 'See all'}
					</button>
				)}
			</header>
			<div className="space-y-1.5">{shown.map(h => <DocumentCard key={`${h.fileId}:${h.page ?? ''}`} hit={h} folders={folders} query={query} />)}</div>
		</section>
	)
}

/** Optional cited answers (phase 3). Retrieval above never depends on an LLM being configured. */
export function AskPanel({ query, docs, folders }: { query: string; docs: DocumentHit[]; folders: FolderMap }) {
	const [settings, setSettings] = useState<UnifiedSettings | null>(null)
	useEffect(() => {
		loadSettings().then(setSettings).catch(e => console.error('[folder-search] settings load failed', e))
	}, [])
	if (!settings) return null
	return <AskInner settings={settings} query={query} docs={docs} folders={folders} />
}

function AskInner({ settings, query, docs, folders }: { settings: UnifiedSettings; query: string; docs: DocumentHit[]; folders: FolderMap }) {
	const llm = useScopedLLM(settings)
	const [busy, setBusy] = useState(false)
	const [answer, setAnswer] = useState<{ text: string; sources: AskSource[] } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const abort = useRef<AbortController | null>(null)
	const sources = pickSources(docs)

	useEffect(() => () => abort.current?.abort(), [])
	useEffect(() => setAnswer(null), [query])

	if (!sources.length) return null
	const ask = async () => {
		if (!llm) return
		abort.current?.abort()
		abort.current = new AbortController()
		setBusy(true)
		setError(null)
		try {
			const text = await llm.invokeText(buildAskMessages(query, sources), abort.current.signal)
			setAnswer({ text, sources })
		} catch (e) {
			if ((e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<section aria-label="Ask" className="rounded-lg border p-2.5 space-y-2">
			<div className="flex items-center gap-2">
				<h3 className="text-xs font-medium flex-1">Answer from these files</h3>
				<Button size="sm" variant="outline" className="h-7 text-xs" disabled={!llm || busy} onClick={ask} title={llm ? undefined : 'Choose a private AI provider first'}>
					{busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Ask
				</Button>
			</div>
			{!llm && (
				<p className="text-[11px] text-muted-foreground">
					Needs a private AI provider (a local server or an in-browser model). Search works without one.{' '}
					<button
						className="underline"
						onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('ai-provider-settings.html') })}
					>
						Choose provider
					</button>
				</p>
			)}
			{error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}
			{answer && (
				<div className="space-y-1.5 text-xs">
					<p className="whitespace-pre-wrap">{answer.text}</p>
					<ul className="space-y-0.5 text-[11px] text-muted-foreground">
						{citedSources(answer.text, answer.sources).map(s => (
							<li key={s.n}>
								<button className="underline" onClick={() => void open(folders, s.folderId, s.relPath, { page: s.page })}>
									[{s.n}] {s.relPath}{s.page ? ` p.${s.page}` : ''}
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	)
}

export function SearchResults({
	response,
	query,
	folders,
	wide,
	onSimilar,
}: {
	response: SearchResponse
	query: string
	folders: FolderMap
	wide: boolean
	onSimilar: (h: MediaHit) => void
}) {
	const { media, documents, leading } = response
	if (!media.length && !documents.length) {
		return (
			<p className="text-xs text-muted-foreground py-6 text-center">
				Nothing matched. Try fewer words, or describe what’s in it.
				{response.partialIndex && ' Indexing is still running, so more may appear.'}
			</p>
		)
	}
	const mediaEl = media.length ? (
		<MediaSection key="m" hits={media} folders={folders} wide={wide} onSimilar={onSimilar} />
	) : (
		<p key="m" className="text-xs text-muted-foreground">No media matched.</p>
	)
	const docsEl = documents.length ? (
		<DocumentSection key="d" hits={documents} folders={folders} query={query} />
	) : (
		<p key="d" className="text-xs text-muted-foreground">No documents matched.</p>
	)
	return (
		<div className="space-y-4">
			{response.partialIndex && <p className="text-[11px] text-amber-600 dark:text-amber-400">Partial index: results may be incomplete.</p>}
			{response.exactStyle && documents.length > 0 && <p className="text-[11px] text-muted-foreground">Exact-text matches first.</p>}
			{documents.length > 0 && <AskPanel query={query} docs={documents} folders={folders} />}
			{leading === 'media' ? [mediaEl, docsEl] : [docsEl, mediaEl]}
		</div>
	)
}
