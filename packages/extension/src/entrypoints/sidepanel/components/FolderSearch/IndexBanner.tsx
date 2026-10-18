import { Copy, FolderX, Pause, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SKIP_REASON_LABEL } from '@/folder-search/classify'
import { formatBytes } from '@/folder-search/modelCatalog'
import type { FileRecord, FolderRecord, IndexProgress } from '@/folder-search/types'

import { Warn } from './Setup'

function eta(sec: number | null): string {
	if (sec === null) return ''
	if (sec < 60) return ' · under a minute left'
	if (sec < 3600) return ` · ~${Math.round(sec / 60)} min left`
	return ` · ~${(sec / 3600).toFixed(1)} h left`
}

interface BannerProps {
	folder: FolderRecord
	progress: IndexProgress | null
	running: boolean
	files: FileRecord[]
	onPause: () => void
	onResume: () => void
	onCancel: () => void
	onRescan: () => void
	onRetryErrors: () => void
}

export function IndexBanner({ folder, progress, running, files, onPause, onResume, onCancel, onRescan, onRetryErrors }: BannerProps) {
	const [details, setDetails] = useState(false)
	const live = running && progress && ['scanning', 'indexing', 'paused'].includes(progress.phase)
	const errors = files.filter(f => f.indexState === 'error')
	const skipped = files.filter(f => f.indexState === 'skipped')
	const notes = files.filter(f => f.note)
	const pending = files.filter(f => f.indexState === 'pending').length
	const indexed = files.filter(f => f.indexState === 'indexed').length
	const paused = progress?.phase === 'paused'

	const copy = async () => {
		const lines = [
			...errors.map(f => `ERROR\t${f.relPath}\t${f.error ?? ''}`),
			...skipped.map(f => `SKIPPED\t${f.relPath}\t${f.skipReason ? SKIP_REASON_LABEL[f.skipReason] : ''}`),
			...notes.map(f => `NOTE\t${f.relPath}\t${f.note}`),
		]
		await navigator.clipboard.writeText(lines.join('\n'))
		toast.success('Copied')
	}

	if (!live) {
		const interrupted = (folder.status === 'indexing' || folder.status === 'paused') && !running
		return (
			<div className="rounded-lg border bg-card p-2.5 text-xs space-y-2">
				<div className="flex items-center gap-2">
					<span className={`size-2 rounded-full ${errors.length ? 'bg-amber-500' : 'bg-green-500'}`} aria-hidden />
					<span className="flex-1">
						{interrupted ? 'Indexing was interrupted' : 'Ready'} · {indexed.toLocaleString()} files
						{pending > 0 && ` · ${pending.toLocaleString()} waiting`}
					</span>
					{interrupted || pending > 0 ? (
						<Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRescan}>
							<Play className="size-3" /> Resume
						</Button>
					) : (
						<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRescan} title="Look for new, changed and deleted files">
							<RefreshCw className="size-3" /> Rescan
						</Button>
					)}
					{(errors.length > 0 || skipped.length > 0 || notes.length > 0) && (
						<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetails(v => !v)}>
							Details
						</Button>
					)}
				</div>
				{progress?.phase === 'error' && progress.message && (
					<p className="text-destructive break-words" role="alert">{progress.message}</p>
				)}
				{progress?.phase === 'cancelled' && <p className="text-muted-foreground">Stopped. Resume to finish the remaining files.</p>}
				{details && <Details errors={errors} skipped={skipped} notes={notes} onCopy={copy} onRetryErrors={onRetryErrors} />}
			</div>
		)
	}

	const p = progress!
	const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
	return (
		<div className="rounded-lg border bg-card p-2.5 text-xs space-y-2" aria-live="polite">
			<div className="flex items-center gap-2">
				<span className={`size-2 rounded-full ${paused ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} aria-hidden />
				<span className="flex-1 truncate">
					{p.phase === 'scanning'
						? (p.message ?? 'Scanning…')
						: paused
							? `Paused · ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`
							: `Indexing ${p.done.toLocaleString()} / ${p.total.toLocaleString()}${eta(p.etaSec)}`}
				</span>
				{paused ? (
					<Button size="sm" variant="outline" className="h-7 text-xs" onClick={onResume}><Play className="size-3" /> Resume</Button>
				) : (
					<Button size="sm" variant="outline" className="h-7 text-xs" onClick={onPause}><Pause className="size-3" /> Pause</Button>
				)}
				<Button size="icon-sm" variant="ghost" className="size-7" onClick={onCancel} aria-label="Stop indexing"><X className="size-3.5" /></Button>
			</div>
			{p.phase !== 'scanning' && (
				<div className="h-1 rounded bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Indexing progress">
					<div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
				</div>
			)}
			<p className="text-muted-foreground">
				Images {p.byKind.image.done}/{p.byKind.image.total} · Docs {p.byKind.document.done}/{p.byKind.document.total}
				{(p.byKind.audio.total > 0 || p.byKind.video.total > 0) &&
					` · Media ${p.byKind.audio.done + p.byKind.video.done}/${p.byKind.audio.total + p.byKind.video.total}`}
				{' · '}Results may be incomplete until done.
			</p>
			<button className="underline text-muted-foreground" onClick={() => setDetails(v => !v)}>
				{details ? 'Hide details' : 'Details'}
			</button>
			{details && (
				<>
					{p.currentFile && <p className="truncate text-muted-foreground" title={p.currentFile}>Now: {p.currentFile}</p>}
					<Details errors={errors} skipped={skipped} notes={notes} onCopy={copy} onRetryErrors={onRetryErrors} />
					<StorageLine />
				</>
			)}
		</div>
	)
}

function StorageLine() {
	const [text, setText] = useState('')
	useEffect(() => {
		navigator.storage
			?.estimate?.()
			.then(e => setText(`Browser storage used: ${formatBytes(e.usage ?? 0)}`))
			.catch(() => undefined)
	}, [])
	return text ? <p className="text-muted-foreground">{text}</p> : null
}

function Details({
	errors,
	skipped,
	notes,
	onCopy,
	onRetryErrors,
}: {
	errors: FileRecord[]
	skipped: FileRecord[]
	notes: FileRecord[]
	onCopy: () => void
	onRetryErrors: () => void
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex gap-2">
				<Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onCopy}><Copy className="size-3" /> Copy list</Button>
				{errors.length > 0 && (
					<Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onRetryErrors}><RefreshCw className="size-3" /> Retry errors</Button>
				)}
			</div>
			{errors.length > 0 && (
				<Section title={`Errors (${errors.length})`}>
					{errors.map(f => <li key={f.fileId} className="break-words text-destructive" title={f.error}>{f.relPath} — {f.error}</li>)}
				</Section>
			)}
			{notes.length > 0 && (
				<Section title={`Notes (${notes.length})`}>
					{notes.map(f => <li key={f.fileId} className="break-words">{f.relPath} — {f.note}</li>)}
				</Section>
			)}
			{skipped.length > 0 && (
				<Section title={`Skipped (${skipped.length})`}>
					{skipped.slice(0, 300).map(f => (
						<li key={f.fileId} className="truncate" title={f.relPath}>{f.relPath} — {f.skipReason ? SKIP_REASON_LABEL[f.skipReason] : ''}</li>
					))}
				</Section>
			)}
		</div>
	)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<p className="font-medium">{title}</p>
			<ul className="max-h-28 overflow-auto rounded border p-1.5 text-[11px] space-y-0.5">{children}</ul>
		</div>
	)
}

export function ReconnectCard({
	folder,
	state,
	onReconnect,
	onChooseAgain,
}: {
	folder: FolderRecord
	state: 'prompt' | 'denied' | 'missing'
	onReconnect: () => void
	onChooseAgain: () => void
}) {
	if (state === 'missing') {
		return (
			<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
				<p className="flex items-center gap-1.5 font-medium"><FolderX className="size-3.5" /> We can’t find “{folder.name}”</p>
				<p className="text-muted-foreground">It may have been moved, renamed or deleted. Your existing index is kept until you confirm a replacement.</p>
				<Button size="sm" className="h-7 text-xs" onClick={onChooseAgain}>Choose again</Button>
			</div>
		)
	}
	return (
		<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
			<p className="font-medium">Reconnect “{folder.name}” to keep searching</p>
			<p className="text-muted-foreground">
				{state === 'denied' ? 'Access was blocked.' : 'The browser forgets folder access after a restart.'} Searching the existing index still
				works; reconnecting lets you open originals and refresh the index.
			</p>
			<Button size="sm" className="h-7 text-xs" onClick={onReconnect}>Reconnect</Button>
		</div>
	)
}
