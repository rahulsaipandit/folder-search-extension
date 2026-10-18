import { ArrowLeft, ExternalLink, Loader2, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import type { SearchKindFilter } from '@/folder-search/types'

import { IndexBanner, ReconnectCard } from './IndexBanner'
import { SearchResults } from './Results'
import { FolderStep, ModelConsent, ModelProgress, PreScan, Unsupported, Welcome } from './Setup'
import { useFolderSearch } from './useFolderSearch'

const FILTERS: { id: SearchKindFilter; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'images', label: 'Images' },
	{ id: 'documents', label: 'Documents' },
	{ id: 'audio-video', label: 'Audio & video' },
]

interface Props {
	onBack?: () => void
	/** Wider layout for the full-tab page. */
	wide?: boolean
}

export function FolderSearch({ onBack, wide = false }: Props) {
	const fs = useFolderSearch()
	const searchRef = useRef<HTMLInputElement>(null)
	const {
		screen, settings, activeFolder, folders, access, model, progress, running, files, error, results, query, kinds,
		searching, searchError, scan, scanning,
	} = fs

	// `/` focuses search (design §4A.2 Screen 7).
	useEffect(() => {
		if (screen !== 'main') return
		const key = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement
			if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
				e.preventDefault()
				searchRef.current?.focus()
			}
		}
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [screen])

	// Quiet incremental rescan once per open, when access is already granted (design §4.2).
	const rescanned = useRef(false)
	useEffect(() => {
		if (rescanned.current || screen !== 'main' || !activeFolder || running) return
		if (access[activeFolder.folderId] !== 'granted' || !activeFolder.lastIndexedAt) return
		rescanned.current = true
		void fs.startIndexing()
	}, [screen, activeFolder, access, running])

	const folderMap = useMemo(() => new Map(folders.map(f => [f.folderId, f])), [folders])
	const examples = useMemo(() => {
		const names = new Set<string>()
		for (const f of files) {
			const base = f.relPath.split('/')[0]
			if (base && !base.includes('.') && names.size < 3) names.add(base)
		}
		return [...names].map(n => n.replace(/[-_]+/g, ' '))
	}, [files])

	const tabUrl = (p: string) => chrome.runtime.getURL(p)
	const header = (
		<div className="flex items-center gap-1.5">
			{onBack && (
				<Button size="icon-sm" variant="ghost" className="size-8" onClick={onBack} aria-label="Back">
					<ArrowLeft className="size-4" />
				</Button>
			)}
			<h1 className="flex-1 text-sm font-semibold">Folder Search</h1>
			{!wide && (
				<Button size="icon-sm" variant="ghost" className="size-8" title="Open in a tab" aria-label="Open in a tab" onClick={() => chrome.tabs.create({ url: tabUrl('folder-search.html') })}>
					<ExternalLink className="size-4" />
				</Button>
			)}
			<Button size="icon-sm" variant="ghost" className="size-8" title="Manage" aria-label="Manage" onClick={() => chrome.tabs.create({ url: tabUrl('folder-search-settings.html') })}>
				<Settings className="size-4" />
			</Button>
		</div>
	)

	let body: React.ReactNode
	switch (screen) {
		case 'loading':
			body = <Loader2 className="mx-auto mt-8 size-5 animate-spin text-muted-foreground" />
			break
		case 'unsupported':
			body = <Unsupported />
			break
		case 'welcome':
			body = <Welcome onStart={fs.begin} />
			break
		case 'model':
			body = settings && (
				<ModelConsent
					settings={settings}
					webgpu={model?.webgpu ?? 'gpu' in navigator}
					webgpuProblem={fs.webgpuProblem}
					onApproveCpu={() => void fs.approveCpuFallback()}
					error={error}
					onChange={p => void fs.patchSettings(p)}
					onDownload={() => void fs.startDownload()}
					onCancel={folders.length ? () => fs.setScreen('main') : undefined}
				/>
			)
			break
		case 'downloading':
			body = <ModelProgress snapshot={fs.download} onCancel={fs.cancelDownload} />
			break
		case 'folder':
			body = <FolderStep error={error} onChoose={() => void fs.choose()} />
			break
		case 'prescan':
			body = activeFolder && (
				<PreScan
					folder={activeFolder}
					scan={scan}
					scanning={scanning}
					error={error}
					onStart={() => void fs.startIndexing()}
					onChooseDifferent={() => void fs.choose()}
					onExcludes={excludes => void fs.updateFolder({ excludes })}
					onKinds={k => void fs.updateFolder({ kinds: k })}
				/>
			)
			break
		case 'main':
			body = (
				<div className="space-y-3">
					{activeFolder && (access[activeFolder.folderId] ?? 'granted') !== 'granted' && (
						<ReconnectCard
							folder={activeFolder}
							state={access[activeFolder.folderId] as 'prompt' | 'denied' | 'missing'}
							onReconnect={() => void fs.reconnect(activeFolder)}
							onChooseAgain={() => void fs.chooseAgain()}
						/>
					)}
					{activeFolder && (
						<IndexBanner
							folder={activeFolder}
							progress={progress}
							running={running}
							files={files}
							onPause={() => void fs.pause()}
							onResume={() => void fs.resume()}
							onCancel={() => void fs.cancel()}
							onRescan={() => void fs.startIndexing()}
							onRetryErrors={() => void fs.startIndexing({ retryErrors: true })}
						/>
					)}
					{fs.reindexNeeded && (
						<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2" role="alert">
							<p className="font-medium">Re-index required (model settings changed)</p>
							<p className="text-muted-foreground">The stored index was built with a different model, precision or size, so its results would be unreliable.</p>
							<Button size="sm" className="h-7 text-xs" onClick={() => void fs.startIndexing({ reindex: true })}>Re-index now</Button>
						</div>
					)}
					<div className="relative">
						<Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
						<Input
							ref={searchRef}
							value={query}
							onChange={e => fs.setQuery(e.target.value)}
							placeholder="Search your files…  ( / )"
							aria-label="Search your files"
							className="h-8 pl-8 pr-8 text-xs"
						/>
						{query && (
							<button className="absolute right-2 top-2 text-muted-foreground" onClick={() => fs.setQuery('')} aria-label="Clear search">
								<X className="size-4" />
							</button>
						)}
					</div>
					<div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
						{FILTERS.map(f => (
							<button
								key={f.id}
								aria-pressed={kinds === f.id}
								onClick={() => fs.setKinds(f.id)}
								className={`rounded-full border px-2.5 py-0.5 text-[11px] ${kinds === f.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
							>
								{f.label}
							</button>
						))}
					</div>
					{fs.similarTo && (
						<p className="flex items-center gap-1.5 text-xs">
							Similar to <b className="truncate">{fs.similarTo.split('/').pop()}</b>
							<button className="underline text-muted-foreground" onClick={() => fs.setQuery('')}>Clear</button>
						</p>
					)}
					{error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}
					{searchError && <p className="text-xs text-destructive break-words" role="alert">Search failed: {searchError}</p>}
					{searching && <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
					{!query && !fs.similarTo && examples.length > 0 && (
						<div className="flex flex-wrap gap-1.5 text-xs">
							<span className="text-muted-foreground">Try:</span>
							{examples.map(e => (
								<button key={e} className="underline" onClick={() => fs.setQuery(e)}>{e}</button>
							))}
						</div>
					)}
					{results && (query || fs.similarTo) && (
						<SearchResults response={results} query={query} folders={folderMap} wide={wide} onSimilar={h => void fs.findSimilar(h)} />
					)}
				</div>
			)
			break
	}

	return (
		<div className={`flex flex-col gap-3 p-3 ${wide ? 'mx-auto max-w-5xl' : 'min-h-screen'}`}>
			{header}
			{body}
			{screen !== 'main' && screen !== 'loading' && error && screen !== 'model' && screen !== 'folder' && screen !== 'prescan' && (
				<p className="text-xs text-destructive break-words" role="alert">{error}</p>
			)}
			<Toaster />
		</div>
	)
}
