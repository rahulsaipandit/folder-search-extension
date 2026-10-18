import { FolderPlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'

import { Button } from '@/components/ui/button'
import { SKIP_REASON_LABEL } from '@/folder-search/classify'
import { pickFolder } from '@/folder-search/fileAccess'
import {
	COMPONENT_LABEL,
	type ModelComponent,
	formatBytes,
	selectionBytes,
} from '@/folder-search/modelCatalog'
import type { FolderRecord, ModelDtype } from '@/folder-search/types'

import { ModelProgress } from './Setup'
import { useFolderSearch } from './useFolderSearch'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-lg border bg-card p-4 space-y-3">
			<h2 className="text-sm font-semibold">{title}</h2>
			{children}
		</section>
	)
}

const MB = 1024 * 1024

function FolderCard({ folder, fs }: { folder: FolderRecord; fs: ReturnType<typeof useFolderSearch> }) {
	const [excludes, setExcludes] = useState(folder.excludes.join('\n'))
	const [showSkipped, setShowSkipped] = useState(false)
	const access = fs.access[folder.folderId]
	const mine = fs.activeFolder?.folderId === folder.folderId ? fs.files : []
	const skipped = mine.filter(f => f.indexState === 'skipped')
	const k = folder.kinds

	const remove = () => {
		const ok = window.confirm(
			`Remove “${folder.name}” from Folder Search?\n\nThis deletes the search index, thumbnails and saved folder access for it. Your original files are never touched. The downloaded models are kept.`
		)
		if (ok) void fs.removeFolder(folder.folderId)
	}

	return (
		<div className="rounded-md border p-3 space-y-3 text-xs">
			<div className="flex items-center gap-2">
				<b className="text-sm">{folder.name}</b>
				<span className="text-muted-foreground">
					{folder.lastIndexedAt ? `last scan ${new Date(folder.lastIndexedAt).toLocaleString()}` : 'never scanned'} · access: {access ?? 'checking'}
				</span>
				<span className="ml-auto flex gap-1.5">
					{access && access !== 'granted' && access !== 'missing' && (
						<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void fs.reconnect(folder)}>Reconnect</Button>
					)}
					<Button size="sm" variant="outline" className="h-7 text-xs" disabled={fs.running || access !== 'granted'} onClick={() => void fs.startIndexing({}, folder.folderId)}>
						<RefreshCw className="size-3" /> Rescan now
					</Button>
					<Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={remove}>
						<Trash2 className="size-3" /> Remove
					</Button>
				</span>
			</div>

			<fieldset className="flex flex-wrap gap-4">
				<legend className="mb-1 text-muted-foreground">Index these types</legend>
				{(['documents', 'images', 'audio', 'video'] as const).map(key => (
					<label key={key} className="flex items-center gap-1 capitalize">
						<input type="checkbox" checked={k[key]} onChange={() => void fs.updateFolder({ kinds: { ...k, [key]: !k[key] } }, folder.folderId)} />
						{key}
					</label>
				))}
			</fieldset>

			<div className="grid grid-cols-3 gap-2">
				{([['documentBytes', 'Max document (MB)'], ['imageBytes', 'Max image (MB)'], ['mediaBytes', 'Max audio/video (MB)']] as const).map(([key, label]) => (
					<label key={key} className="space-y-1">
						<span className="text-muted-foreground">{label}</span>
						<input
							type="number"
							min={1}
							className="h-8 w-full rounded border bg-background px-2"
							defaultValue={Math.round(folder.caps[key] / MB)}
							onBlur={e => {
								const mb = Number(e.target.value)
								if (Number.isFinite(mb) && mb >= 1) void fs.updateFolder({ caps: { ...folder.caps, [key]: mb * MB } }, folder.folderId)
							}}
						/>
					</label>
				))}
			</div>

			<label className="block space-y-1">
				<span className="text-muted-foreground">Exclude patterns (one per line, * wildcard, matched against folder and file names)</span>
				<textarea
					className="h-16 w-full rounded border bg-background p-1.5"
					value={excludes}
					onChange={e => setExcludes(e.target.value)}
					onBlur={() => void fs.updateFolder({ excludes: excludes.split('\n').map(s => s.trim()).filter(Boolean) }, folder.folderId)}
				/>
			</label>
			<p className="text-muted-foreground">Changes apply on the next rescan.</p>

			{skipped.length > 0 && (
				<div>
					<button className="underline" onClick={() => setShowSkipped(v => !v)}>
						{showSkipped ? 'Hide' : 'Show'} skipped files ({skipped.length})
					</button>
					{showSkipped && (
						<ul className="mt-1 max-h-40 overflow-auto rounded border p-1.5 text-[11px] text-muted-foreground">
							{skipped.slice(0, 500).map(f => (
								<li key={f.fileId} className="truncate" title={f.relPath}>{f.relPath} — {f.skipReason ? SKIP_REASON_LABEL[f.skipReason] : ''}</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	)
}

export function ManagePage() {
	const fs = useFolderSearch()
	const { settings, model, download, screen } = fs
	const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)

	useEffect(() => {
		navigator.storage?.estimate?.().then(e => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => undefined)
	}, [fs.progress?.phase, model?.cachedBytes])

	if (!settings || screen === 'loading') return <Loader2 className="mx-auto mt-10 size-5 animate-spin" />
	const sel = settings.selection
	const cached = model?.cached
	const missing = (['text', 'vision', 'audio'] as ModelComponent[]).filter(
		c => (c === 'text' || sel[c]) && !cached?.[c]
	)

	const setDtype = (dtype: ModelDtype) => {
		if (dtype === sel.dtype) return
		const ok = window.confirm(
			'Changing model precision means the current index no longer matches. You will need to download the other precision and re-index your folders. Continue?'
		)
		if (ok) void fs.startDownload({ selection: { ...sel, dtype } })
	}

	return (
		<div className="mx-auto max-w-3xl space-y-4 p-4">
			<h1 className="text-lg font-semibold">Folder Search · Manage</h1>
			{fs.error && <p className="text-xs text-destructive break-words" role="alert">{fs.error}</p>}

			<Section title="Models">
				{screen === 'downloading' && <ModelProgress snapshot={download} onCancel={() => fs.setScreen('main')} />}
				<div className="text-xs space-y-1.5">
					{(['text', 'vision', 'audio'] as ModelComponent[]).map(c => (
						<div key={c} className="flex items-center gap-2">
							{c !== 'text' ? (
								<label className="flex items-center gap-1.5 flex-1">
									<input type="checkbox" checked={sel[c]} onChange={e => void fs.patchSettings({ selection: { ...sel, [c]: e.target.checked } })} />
									{COMPONENT_LABEL[c]}
								</label>
							) : (
								<span className="flex-1">{COMPONENT_LABEL[c]} (required)</span>
							)}
							<span className="text-muted-foreground">{cached?.[c] ? '✓ downloaded' : 'not downloaded'}</span>
						</div>
					))}
					<p className="text-muted-foreground">
						Selected: {formatBytes(selectionBytes(sel))} · on disk: {formatBytes(model?.cachedBytes ?? 0)} · device: {model?.device ?? (model?.webgpu ? 'WebGPU (idle)' : 'WebGPU unavailable')}
					</p>
				</div>
				{settings.cpuFallbackApproved ? (
					<div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
						<p className="font-medium">CPU mode (fp16) is on</p>
						<p className="text-muted-foreground">
							You approved the slower CPU fallback because WebGPU did not work. Turn it off to go back to the
							WebGPU models; this downloads them if needed and requires a re-index.
						</p>
						<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void fs.revokeCpuFallback()}>
							Turn off CPU mode
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-4 text-xs">
						<span className="text-muted-foreground">Quality</span>
						{(['q4', 'q8'] as ModelDtype[]).map(d => (
							<label key={d} className="flex items-center gap-1">
								<input type="radio" checked={sel.dtype === d} onChange={() => setDtype(d)} />
								{d === 'q4' ? 'Fast (q4)' : 'High (q8)'}
							</label>
						))}
					</div>
				)}
				<div className="flex gap-2">
					{missing.length > 0 && (
						<Button size="sm" className="h-8 text-xs" onClick={() => void fs.startDownload()}>
							Download {missing.map(c => COMPONENT_LABEL[c]).join(', ')}
						</Button>
					)}
					<Button
						size="sm"
						variant="outline"
						className="h-8 text-xs text-destructive"
						onClick={() => {
							if (window.confirm('Remove the downloaded models from this browser? Searching and indexing stop working until you download them again. Your index and files are not affected.')) void fs.removeModels()
						}}
					>
						<Trash2 className="size-3" /> Remove models
					</Button>
				</div>
			</Section>

			<Section title="Folders">
				{fs.folders.length === 0 && <p className="text-xs text-muted-foreground">No folder yet.</p>}
				{fs.folders.map(f => <FolderCard key={f.folderId} folder={f} fs={fs} />)}
				<Button
					size="sm"
					variant="outline"
					className="h-8 text-xs"
					onClick={async () => {
						try {
							const f = await pickFolder()
							if (!f) return
							await fs.patchSettings({ activeFolderId: f.folderId, setupStep: 'index' })
							await fs.refreshFolders()
							window.alert('Folder added. Open Folder Search to review it and start indexing.')
						} catch (e) {
							fs.setError(e instanceof Error ? e.message : String(e))
						}
					}}
				>
					<FolderPlus className="size-3.5" /> Add another folder
				</Button>
			</Section>

			<Section title="Storage">
				<p className="text-xs text-muted-foreground">
					{usage
						? `This extension is using ${formatBytes(usage.used)} of about ${formatBytes(usage.quota)} available browser storage (models, vectors and thumbnails together).`
						: 'Storage estimate unavailable.'}
				</p>
				<p className="text-xs text-muted-foreground">
					Optional “Answer from these files” uses your text AI provider:{' '}
					<a className="underline" href={chrome.runtime.getURL('ai-provider-settings.html')} target="_blank" rel="noreferrer">AI provider settings</a>.
				</p>
			</Section>
			<Toaster />
		</div>
	)
}
