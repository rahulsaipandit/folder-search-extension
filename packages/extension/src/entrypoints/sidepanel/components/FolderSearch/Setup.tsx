import { AlertTriangle, Download, FolderOpen, Loader2, Lock, Monitor, Search, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SKIP_REASON_LABEL } from '@/folder-search/classify'
import {
	COMPONENT_LABEL,
	componentBytes,
	type DownloadSnapshot,
	type ModelComponent,
	formatBytes,
	selectionBytes,
} from '@/folder-search/modelCatalog'
import { DEFAULT_SETTINGS, type FolderSearchSettings } from '@/folder-search/settings'
import type { FolderRecord, ModelDtype, ScanSummary } from '@/folder-search/types'

function formatEta(sec: number | null): string {
	if (sec === null) return 'unknown'
	if (sec < 90) return 'about a minute'
	if (sec < 3600) return `~${Math.round(sec / 60)} min`
	return `~${(sec / 3600).toFixed(1)} h`
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-lg border bg-card p-4 space-y-3">
			<h2 className="text-sm font-medium">{title}</h2>
			{children}
		</div>
	)
}

const EXAMPLE_QUERIES = ['beach photo with dog', 'Q3 invoice from Acme', 'slides about onboarding']

const TRUST_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
	{ icon: Monitor, title: 'Runs on your device', body: 'Indexing and search happen locally.' },
	{ icon: ShieldCheck, title: 'Read-only', body: 'Files are never uploaded or changed.' },
	{ icon: FolderOpen, title: 'You pick the folder', body: 'Only that folder is ever searched.' },
]

export function Welcome({ onStart }: { onStart: () => void }) {
	const [example, setExample] = useState<string | null>(null)
	// Honest about the cost up front: the model is approved before any folder is picked (design §2.2).
	const downloadSize = formatBytes(selectionBytes(DEFAULT_SETTINGS.selection))
	return (
		<div className="flex flex-1 flex-col">
			<div className="flex-1 space-y-5 px-1 pt-3">
				<div>
					<span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#f1effe] px-2.5 py-1 text-xs font-semibold text-[#3d33c4] dark:bg-[#2a2748] dark:text-[#cfcaff]">
						<Lock className="size-3" aria-hidden /> Private, on your device
					</span>
					<h2 className="text-2xl font-semibold leading-tight tracking-tight">Find any file by describing it</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						Search your folder in plain English. Nothing leaves your computer.
					</p>
				</div>

				<div className="space-y-2">
					<div
						aria-disabled="true"
						className="flex items-center gap-2.5 rounded-xl border-[1.5px] bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground"
					>
						<Search className="size-4 shrink-0" aria-hidden />
						<span className="truncate">{example ? `“${example}”` : 'Set up to start searching'}</span>
					</div>
					<div className="flex flex-wrap gap-2" role="group" aria-label="Example searches">
						{EXAMPLE_QUERIES.map(q => (
							<button
								key={q}
								type="button"
								onClick={() => setExample(q)}
								className="cursor-pointer rounded-full bg-[#f1effe] px-3 py-1.5 text-[13px] text-[#3d33c4] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b4ef0] dark:bg-[#2a2748] dark:text-[#cfcaff]"
							>
								{q}
							</button>
						))}
					</div>
				</div>

				<ul className="space-y-3.5">
					{TRUST_POINTS.map(({ icon: Icon, title, body }) => (
						<li key={title} className="flex items-start gap-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1effe] text-[#5b4ef0] dark:bg-[#2a2748] dark:text-[#8b80ff]">
								<Icon className="size-4" aria-hidden />
							</span>
							<div>
								<b className="block text-sm font-semibold">{title}</b>
								<span className="text-[13px] text-muted-foreground">{body}</span>
							</div>
						</li>
					))}
				</ul>
			</div>

			<div className="sticky bottom-0 -mx-3 -mb-3 border-t bg-background px-5 pb-4 pt-3.5">
				<Button
					className="h-11 w-full gap-2 rounded-xl bg-[#5b4ef0] text-sm font-semibold text-white hover:bg-[#5b4ef0]/90 active:scale-[0.985] dark:bg-[#8b80ff] dark:text-[#14121f]"
					onClick={onStart}
				>
					<Download className="size-4" aria-hidden /> Set up (one-time {downloadSize} download)
				</Button>
				<p className="mt-2 text-center text-[13px] text-muted-foreground">
					You’ll approve the download first, then choose a folder. Files are never uploaded or changed.
				</p>
			</div>
		</div>
	)
}

export function Unsupported() {
	return (
		<Card title="Folder access isn’t available in this browser">
			<p className="text-xs text-muted-foreground">
				Folder Search needs the File System Access API (Chrome, Edge and other Chromium browsers). A one-time
				import for other browsers isn’t built yet.
			</p>
		</Card>
	)
}

interface ConsentProps {
	settings: FolderSearchSettings
	/** A WebGPU adapter was obtained. */
	webgpu: boolean
	/** Why WebGPU is unavailable or failed to start, if known. */
	webgpuProblem: string | null
	error: string | null
	onChange: (patch: Partial<FolderSearchSettings>) => void
	onDownload: () => void
	/** The user explicitly approved the fp16 CPU fallback (design §14.5). */
	onApproveCpu: () => void
	onCancel?: () => void
}

/**
 * Step 1: nothing is downloaded until the user clicks “Download & continue” (design §2.2a).
 * WebGPU is required; when it does not work, the normal download is blocked and the fp16 CPU
 * fallback is offered as a separate, explicit approval (design §14.5).
 */
export function ModelConsent({ settings, webgpu, webgpuProblem, error, onChange, onDownload, onApproveCpu, onCancel }: ConsentProps) {
	const sel = settings.selection
	const cpuApproved = settings.cpuFallbackApproved
	const gpuBroken = (!webgpu || webgpuProblem !== null) && !cpuApproved
	const cpuBytes = selectionBytes({ ...sel, dtype: 'fp16' })
	const [lowStorage, setLowStorage] = useState<string | null>(null)
	const total = selectionBytes(sel)

	useEffect(() => {
		navigator.storage
			?.estimate?.()
			.then(({ quota, usage }) => {
				if (quota && usage !== undefined && quota - usage < total * 1.5) {
					setLowStorage(`Only about ${formatBytes(quota - usage)} of browser storage is free.`)
				} else setLowStorage(null)
			})
			.catch(() => setLowStorage(null))
	}, [total])

	const setSel = (patch: Partial<typeof sel>) => onChange({ selection: { ...sel, ...patch } })
	const row = (label: string, c: ModelComponent, checked: boolean, locked: boolean, onToggle?: (v: boolean) => void, hint?: string) => (
		<label className="flex items-center gap-2 text-xs">
			<input
				type="checkbox"
				checked={checked}
				disabled={locked}
				onChange={e => onToggle?.(e.target.checked)}
				className="size-3.5"
			/>
			<span className="flex-1">
				{label}
				{hint && <span className="text-muted-foreground"> · {hint}</span>}
			</span>
			<span className="text-muted-foreground tabular-nums">{formatBytes(componentBytes(sel.dtype, c))}</span>
		</label>
	)

	return (
		<Card title="Step 1 of 3 · Download search model">
			<p className="text-xs text-muted-foreground">
				To understand images and text, a model must be saved on this computer once.
			</p>
			<div className="space-y-2">
				{row(COMPONENT_LABEL.text, 'text', true, true, undefined, 'required')}
				{row(COMPONENT_LABEL.vision, 'vision', sel.vision, false, v => setSel({ vision: v }), 'photos, PDF pages, video')}
				{row(COMPONENT_LABEL.audio, 'audio', sel.audio, false, v => setSel({ audio: v }), 'spoken audio search')}
			</div>
			<p className="text-xs">
				Total: <b>{formatBytes(total)}</b> · from huggingface.co. Stored in this browser; your files never leave
				the device.
			</p>
			{cpuApproved ? (
				<Warn>
					CPU mode (fp16) is approved because WebGPU does not work here. Indexing will be much slower
					(roughly 15× in one published comparison).
				</Warn>
			) : (
				<div className="flex items-center gap-3 text-xs">
					<span className="text-muted-foreground">Quality:</span>
					{(['q4', 'q8'] as ModelDtype[]).map(d => (
						<label key={d} className="flex items-center gap-1">
							<input type="radio" checked={sel.dtype === d} onChange={() => setSel({ dtype: d })} />
							{d === 'q4' ? 'Fast (q4)' : 'High (q8)'}
						</label>
					))}
				</div>
			)}
			{gpuBroken && (
				<div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
					<p className="font-medium">WebGPU is required but isn’t working here</p>
					<p className="text-muted-foreground break-words">
						{webgpuProblem ?? 'No WebGPU adapter was found.'} Try updating your browser or graphics driver, or
						enabling hardware acceleration.
					</p>
					<p className="text-muted-foreground">
						Alternatively, you can approve a slower CPU mode. It needs the larger fp16 model (
						<b>{formatBytes(cpuBytes)}</b> for your selection) and indexing can take 15× longer or more.
						Nothing is downloaded unless you approve.
					</p>
					<Button size="sm" variant="outline" className="h-8 w-full text-xs" onClick={onApproveCpu}>
						Allow CPU fallback (fp16, {formatBytes(cpuBytes)}) and download
					</Button>
				</div>
			)}
			{lowStorage && <Warn>{lowStorage} The download may fail.</Warn>}
			{error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}
			<div className="flex gap-2 justify-end">
				{onCancel && (
					<Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel}>
						Cancel
					</Button>
				)}
				<Button size="sm" className="h-8 text-xs" disabled={gpuBroken} onClick={onDownload}>
					{error && !gpuBroken ? 'Retry' : 'Download & continue'}
				</Button>
			</div>
		</Card>
	)
}

function Warn({ children }: { children: React.ReactNode }) {
	return (
		<p className="flex gap-1.5 text-xs rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 p-2" role="status">
			<AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
			<span>{children}</span>
		</p>
	)
}
export { Warn }

export function ModelProgress({ snapshot, onCancel }: { snapshot: DownloadSnapshot | null; onCancel: () => void }) {
	const comps = Object.entries(snapshot?.components ?? {}) as [ModelComponent, { loaded: number; total: number }][]
	return (
		<Card title="Downloading models…">
			{comps.length === 0 && <p className="text-xs text-muted-foreground">Starting…</p>}
			{comps.map(([c, p]) => {
				const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0
				return (
					<div key={c} className="space-y-1">
						<div className="flex justify-between text-xs">
							<span>{COMPONENT_LABEL[c]}</span>
							<span className="tabular-nums text-muted-foreground">
								{pct}% · {formatBytes(p.loaded)}/{formatBytes(p.total)}
							</span>
						</div>
						<div className="h-1.5 rounded bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={COMPONENT_LABEL[c]}>
							<div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
						</div>
					</div>
				)
			})}
			{snapshot?.phase === 'warming' && (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2 className="size-3 animate-spin" /> Warming up…
				</p>
			)}
			<div className="flex justify-end">
				<Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel}>
					Back
				</Button>
			</div>
			<p className="text-[11px] text-muted-foreground">
				The download continues in the background. Finished files are kept, so a retry resumes where it stopped.
			</p>
		</Card>
	)
}

export function FolderStep({ error, onChoose }: { error: string | null; onChoose: () => void }) {
	return (
		<Card title="Step 2 of 3 · Choose a folder">
			<p className="text-xs text-muted-foreground">Pick the folder you want to search. Subfolders are included.</p>
			<Button size="sm" className="h-8 w-full text-xs" onClick={onChoose}>
				<FolderOpen className="size-3.5" /> Choose folder…
			</Button>
			<p className="text-[11px] text-muted-foreground">Tip: avoid choosing your whole home folder or drive.</p>
			{error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}
		</Card>
	)
}

interface PreScanProps {
	folder: FolderRecord
	scan: ScanSummary | null
	scanning: boolean
	error: string | null
	onStart: () => void
	onChooseDifferent: () => void
	onExcludes: (excludes: string[]) => void
	onKinds: (k: FolderRecord['kinds']) => void
}

/** Step 3: pre-scan summary (metadata only; no file contents read yet) and the Start button. */
export function PreScan({ folder, scan, scanning, error, onStart, onChooseDifferent, onExcludes, onKinds }: PreScanProps) {
	const [showSkipped, setShowSkipped] = useState(false)
	const [excludeText, setExcludeText] = useState(folder.excludes.join('\n'))
	const broad = Boolean(scan?.broadFolderWarning)
	const k = folder.kinds
	const toggle = (key: keyof FolderRecord['kinds']) => onKinds({ ...k, [key]: !k[key] })
	return (
		<Card title={`Step 3 of 3 · ${folder.name}`}>
			{scanning && (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2 className="size-3 animate-spin" /> Looking at what’s in the folder…
				</p>
			)}
			{scan && (
				<div className="text-xs space-y-1">
					<div className="flex justify-between"><span>🖼 Images</span><span>{scan.counts.image.files.toLocaleString()} · {formatBytes(scan.counts.image.bytes)}</span></div>
					<div className="flex justify-between"><span>📄 Documents</span><span>{scan.counts.document.files.toLocaleString()} · {formatBytes(scan.counts.document.bytes)}</span></div>
					{(scan.counts.audio.files > 0 || scan.counts.video.files > 0) && (
						<div className="flex justify-between"><span>🎞 Audio / video</span><span>{(scan.counts.audio.files + scan.counts.video.files).toLocaleString()}</span></div>
					)}
					<div className="flex justify-between">
						<span>⏭ Skipped</span>
						<button className="underline" onClick={() => setShowSkipped(v => !v)}>
							{scan.skippedCount.toLocaleString()} · {showSkipped ? 'Hide' : 'View'}
						</button>
					</div>
					{showSkipped && (
						<ul className="max-h-32 overflow-auto rounded border p-1.5 text-[11px] text-muted-foreground">
							{scan.skipped.map(s => (
								<li key={s.relPath} className="truncate" title={s.relPath}>{s.relPath} — {SKIP_REASON_LABEL[s.reason]}</li>
							))}
							{scan.skippedCount > scan.skipped.length && <li>…and {scan.skippedCount - scan.skipped.length} more</li>}
						</ul>
					)}
					<p className="text-muted-foreground">Rough time estimate: {formatEta(scan.estimatedSeconds)} (a guess, not a measurement)</p>
				</div>
			)}
			{scan?.broadFolderWarning && <Warn>{scan.broadFolderWarning}</Warn>}
			<fieldset className="flex flex-wrap gap-3 text-xs">
				<legend className="text-muted-foreground mb-1">Index</legend>
				{(['documents', 'images', 'audio', 'video'] as const).map(key => (
					<label key={key} className="flex items-center gap-1 capitalize">
						<input type="checkbox" checked={k[key]} onChange={() => toggle(key)} /> {key}
					</label>
				))}
			</fieldset>
			<details className="text-xs">
				<summary className="cursor-pointer">Exclude folders or files…</summary>
				<textarea
					className="mt-1.5 w-full h-16 rounded border bg-background p-1.5 text-xs"
					placeholder={'One pattern per line, e.g.\nArchive\n*.tmp'}
					value={excludeText}
					onChange={e => setExcludeText(e.target.value)}
					onBlur={() => onExcludes(excludeText.split('\n').map(s => s.trim()).filter(Boolean))}
				/>
			</details>
			{error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}
			<div className="flex gap-2 justify-end">
				<Button size="sm" variant={broad ? 'default' : 'outline'} className="h-8 text-xs" onClick={onChooseDifferent}>
					Choose different
				</Button>
				<Button size="sm" variant={broad ? 'outline' : 'default'} className="h-8 text-xs" disabled={scanning || !scan} onClick={onStart}>
					Start indexing
				</Button>
			</div>
		</Card>
	)
}
