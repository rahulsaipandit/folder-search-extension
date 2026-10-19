import { useCallback, useEffect, useRef, useState } from 'react'

import {
	folderIndexCancel,
	folderIndexPause,
	folderIndexRemove,
	folderIndexResume,
	folderIndexStart,
	folderIndexStatus,
	folderModelDownload,
	folderModelProgress,
	folderModelRemove,
	folderModelStatus,
	folderScan,
	folderSearch,
	folderSearchMedia,
	folderSimilar,
} from '@/folder-search/bridge'
import { getFiles, getFolder, listFolders, putFolder } from '@/folder-search/db'
import { FOLDER_EVENT, type FolderEvent } from '@/folder-search/events'
import {
	type FolderAccess,
	folderAccess,
	hasFileSystemAccess,
	pickFolder,
	reconnectFolder,
} from '@/folder-search/fileAccess'
import { type DownloadSnapshot, type ModelStatus, displayError, isWebGPUError } from '@/folder-search/modelCatalog'
import {
	type FolderSearchSettings,
	loadFolderSearchSettings,
	saveFolderSearchSettings,
} from '@/folder-search/settings'
import type {
	FileRecord,
	FolderRecord,
	IndexProgress,
	MediaHit,
	ScanSummary,
	SearchKindFilter,
	SearchResponse,
} from '@/folder-search/types'

import type { MediaQuery } from './mediaQuery'

export type Screen =
	| 'loading'
	| 'unsupported'
	| 'welcome'
	| 'model'
	| 'downloading'
	| 'folder'
	| 'prescan'
	| 'main'

const REINDEX_MARK = 'REINDEX_REQUIRED'

function errText(e: unknown): string {
	return displayError(e instanceof Error ? e.message : String(e))
}

export function useFolderSearch() {
	const [screen, setScreen] = useState<Screen>('loading')
	const [settings, setSettings] = useState<FolderSearchSettings | null>(null)
	const [folders, setFolders] = useState<FolderRecord[]>([])
	const [access, setAccess] = useState<Record<string, FolderAccess>>({})
	const [model, setModel] = useState<ModelStatus | null>(null)
	const [download, setDownload] = useState<DownloadSnapshot | null>(null)
	const [progress, setProgress] = useState<IndexProgress | null>(null)
	const [running, setRunning] = useState(false)
	const [scan, setScan] = useState<ScanSummary | null>(null)
	const [scanning, setScanning] = useState(false)
	const [files, setFiles] = useState<FileRecord[]>([])
	const [error, setError] = useState<string | null>(null)
	const [reindexNeeded, setReindexNeeded] = useState(false)
	/** Why WebGPU failed while loading (set by the engine); drives the CPU-fallback offer. */
	const [webgpuFailure, setWebgpuFailure] = useState<string | null>(null)

	const [query, setQueryRaw] = useState('')
	/** Path of the image whose neighbours are shown instead of text results. */
	const [similarTo, setSimilarTo] = useState<string | null>(null)
	const [kinds, setKinds] = useState<SearchKindFilter>('all')
	const [results, setResults] = useState<SearchResponse | null>(null)
	const [searching, setSearching] = useState(false)
	const [searchError, setSearchError] = useState<string | null>(null)
	const searchSeq = useRef(0)
	/** An image or recording used as the query (camera / microphone buttons). */
	const [mediaQuery, setMediaQuery] = useState<MediaQuery | null>(null)
	const setQuery = useCallback((q: string) => {
		setSimilarTo(null)
		setMediaQuery(null)
		setQueryRaw(q)
	}, [])

	const activeFolder = folders.find(f => f.folderId === settings?.activeFolderId) ?? folders[0] ?? null

	const refreshFolders = useCallback(async () => {
		const list = await listFolders()
		setFolders(list)
		const acc: Record<string, FolderAccess> = {}
		for (const f of list) {
			try {
				acc[f.folderId] = await folderAccess(f)
			} catch (e) {
				console.warn('[folder-search] permission check failed', e)
				acc[f.folderId] = 'denied'
			}
		}
		setAccess(acc)
		return list
	}, [])

	const refreshFiles = useCallback(async (folderId: string | undefined) => {
		setFiles(folderId ? await getFiles(folderId) : [])
	}, [])

	const decideScreen = useCallback(
		(s: FolderSearchSettings, m: ModelStatus | null, list: FolderRecord[], isRunning: boolean, prog: IndexProgress | null): Screen => {
			if (!hasFileSystemAccess()) return 'unsupported'
			if (s.setupStep === 'welcome' && !s.modelConsent && !list.length) return 'welcome'
			if (!s.modelConsent || !m?.cached.text) return 'model'
			if (!list.length) return 'folder'
			const f = list.find(x => x.folderId === s.activeFolderId) ?? list[0]!
			if (!f.lastIndexedAt && !isRunning && !prog && f.status === 'idle') return 'prescan'
			return 'main'
		},
		[]
	)

	// Initial load.
	useEffect(() => {
		let cancelled = false
		;(async () => {
			try {
				const s = await loadFolderSearchSettings()
				const list = await refreshFolders()
				let m: ModelStatus | null = null
				let st: { running: boolean; progress: IndexProgress | null } = { running: false, progress: null }
				try {
					;[m, st] = await Promise.all([folderModelStatus(s.selection), folderIndexStatus()])
				} catch (e) {
					setError(`Could not reach the on-device engine: ${errText(e)}`)
				}
				if (cancelled) return
				setSettings(s)
				setModel(m)
				setRunning(st.running)
				setProgress(st.progress)
				setScreen(decideScreen(s, m, list, st.running, st.progress))
			} catch (e) {
				if (!cancelled) {
					setError(errText(e))
					setScreen('welcome')
				}
			}
		})()
		return () => {
			cancelled = true
		}
	}, [decideScreen, refreshFolders])

	// Live events from the offscreen document.
	useEffect(() => {
		const onMessage = (msg: { type?: string } & Partial<FolderEvent>) => {
			if (msg?.type !== FOLDER_EVENT) return
			if (msg.event === 'index-progress' && msg.progress) {
				setProgress(msg.progress)
				const live = msg.progress.phase === 'scanning' || msg.progress.phase === 'indexing' || msg.progress.phase === 'paused'
				setRunning(live)
				if (msg.progress.phase === 'error' && msg.progress.message?.includes(REINDEX_MARK)) setReindexNeeded(true)
				if (msg.progress.phase === 'done' || msg.progress.phase === 'cancelled' || msg.progress.phase === 'error') {
					void refreshFolders()
					void refreshFiles(msg.progress.folderId)
				}
			}
			if (msg.event === 'model-progress' && msg.snapshot) setDownload(msg.snapshot)
		}
		chrome.runtime.onMessage.addListener(onMessage)
		return () => chrome.runtime.onMessage.removeListener(onMessage)
	}, [refreshFiles, refreshFolders])

	useEffect(() => {
		void refreshFiles(activeFolder?.folderId)
	}, [activeFolder?.folderId, refreshFiles, progress?.done])

	const patchSettings = useCallback(async (patch: Partial<FolderSearchSettings>) => {
		const next = await saveFolderSearchSettings(patch)
		setSettings(next)
		return next
	}, [])

	// ── actions ──
	const act = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
		setError(null)
		try {
			return await fn()
		} catch (e) {
			console.error('[folder-search]', e)
			if (e instanceof Error && isWebGPUError(e.message)) setWebgpuFailure(displayError(e.message))
			setError(errText(e))
			return undefined
		}
	}, [])

	const begin = () => patchSettings({ setupStep: 'model' }).then(() => setScreen('model'))

	const startDownload = (next?: Partial<FolderSearchSettings>) =>
		act(async () => {
			const s = await patchSettings({ ...next, modelConsent: true, setupStep: 'model' })
			setScreen('downloading')
			setDownload({ phase: 'downloading', components: {} })
			try {
				const m = await folderModelDownload(s.selection)
				setModel(m)
				const list = await refreshFolders()
				setScreen(list.length ? 'main' : 'folder')
				await patchSettings({ setupStep: 'folder' })
			} catch (e) {
				setScreen('model')
				throw e
			}
		})

	/**
	 * The user explicitly approved the slower fp16 CPU mode (design §14.5). Records the approval and
	 * the fp16 precision, then downloads. Never called implicitly.
	 */
	const approveCpuFallback = () =>
		act(async () => {
			if (!settings) return
			setWebgpuFailure(null)
			await patchSettings({ cpuFallbackApproved: true, selection: { ...settings.selection, dtype: 'fp16' } })
			await startDownload()
		})

	const revokeCpuFallback = () =>
		act(async () => {
			if (!settings) return
			const next = await patchSettings({ cpuFallbackApproved: false, selection: { ...settings.selection, dtype: 'q4' } })
			setModel(await folderModelStatus(next.selection))
			setScreen('model')
		})

	const cancelDownload = () => {
		// transformers.js cannot abort an in-flight fetch; completed files stay cached and a retry resumes.
		setScreen('model')
		void folderModelProgress().then(setDownload).catch(() => undefined)
	}

	const choose = () =>
		act(async () => {
			const f = await pickFolder()
			if (!f) return
			await patchSettings({ activeFolderId: f.folderId, setupStep: 'index' })
			await refreshFolders()
			setProgress(null)
			setScan(null)
			setScreen('prescan')
			setScanning(true)
			try {
				setScan(await folderScan(f.folderId))
			} finally {
				setScanning(false)
			}
		})

	const rescanSummary = () =>
		act(async () => {
			if (!activeFolder) return
			setScanning(true)
			try {
				setScan(await folderScan(activeFolder.folderId))
			} finally {
				setScanning(false)
			}
		})

	// Entering the prescan screen with an existing, never-indexed folder (e.g. panel reopened).
	useEffect(() => {
		if (screen === 'prescan' && activeFolder && !scan && !scanning && access[activeFolder.folderId] === 'granted') {
			void rescanSummary()
		}
	}, [screen, activeFolder?.folderId, access, scan])

	const updateFolder = (patch: Partial<FolderRecord>, folderId?: string) =>
		act(async () => {
			const target = folders.find(f => f.folderId === folderId) ?? activeFolder
			if (!target) return
			const latest = (await getFolder(target.folderId)) ?? target
			await putFolder({ ...latest, ...patch })
			await refreshFolders()
			setScan(null)
		})

	const startIndexing = (opts: { retryErrors?: boolean; reindex?: boolean } = {}, folderId?: string) =>
		act(async () => {
			const target = folders.find(f => f.folderId === folderId) ?? activeFolder
			if (!target) return
			setReindexNeeded(false)
			setRunning(true)
			await folderIndexStart(target.folderId, opts)
			await patchSettings({ setupStep: 'ready' })
			setScreen('main')
		})

	const reconnect = (folder: FolderRecord) =>
		act(async () => {
			const state = await reconnectFolder(folder)
			setAccess(a => ({ ...a, [folder.folderId]: state }))
			if (state === 'granted' && folder.status !== 'idle') await folderIndexStart(folder.folderId)
		})

	const chooseAgain = () => choose()

	const removeFolder = (folderId: string) =>
		act(async () => {
			await folderIndexRemove(folderId)
			const list = await refreshFolders()
			setResults(null)
			setProgress(null)
			if (settings?.activeFolderId === folderId) await patchSettings({ activeFolderId: list[0]?.folderId ?? null })
			if (!list.length) setScreen('folder')
		})

	const removeModels = () =>
		act(async () => {
			const r = await folderModelRemove()
			if (settings) setModel(await folderModelStatus(settings.selection))
			await patchSettings({ modelConsent: false, setupStep: 'model' })
			return r
		})

	const runSearch = useCallback(
		async (q: string, filter: SearchKindFilter) => {
			const seq = ++searchSeq.current
			if (!q.trim() || !folders.length) {
				setResults(null)
				setSearching(false)
				return
			}
			setSearching(true)
			setSearchError(null)
			try {
				const ids = folders.filter(f => access[f.folderId] !== 'missing').map(f => f.folderId)
				const r = await folderSearch(q, { folderIds: ids, kinds: filter })
				if (seq === searchSeq.current) setResults(r)
			} catch (e) {
				if (seq === searchSeq.current) {
					console.error('[folder-search] search failed', e)
					setSearchError(errText(e))
				}
			} finally {
				if (seq === searchSeq.current) setSearching(false)
			}
		},
		[access, folders]
	)

	// Debounced search while typing.
	useEffect(() => {
		if (screen !== 'main' || similarTo) return
		const t = setTimeout(() => void runSearch(query, kinds), 300)
		return () => clearTimeout(t)
	}, [query, kinds, screen, runSearch, similarTo])

	/** Enter in the search box: search now instead of waiting for the typing pause. */
	const submitSearch = () => {
		if (query.trim() && !similarTo && !mediaQuery) void runSearch(query, kinds)
	}

	const runMediaSearch = useCallback(
		async (mq: MediaQuery, filter: SearchKindFilter) => {
			const seq = ++searchSeq.current
			setSearching(true)
			setSearchError(null)
			try {
				const ids = folders.filter(f => access[f.folderId] !== 'missing').map(f => f.folderId)
				const r = await folderSearchMedia(mq.kind, mq.data, mq.mime, { folderIds: ids, kinds: filter })
				if (seq === searchSeq.current) setResults(r)
			} catch (e) {
				if (seq === searchSeq.current) {
					console.error('[folder-search] media search failed', e)
					setSearchError(errText(e))
					setResults(null)
				}
			} finally {
				if (seq === searchSeq.current) setSearching(false)
			}
		},
		[access, folders]
	)

	// Re-run the media query when the type chip changes.
	useEffect(() => {
		if (screen === 'main' && mediaQuery) void runMediaSearch(mediaQuery, kinds)
	}, [mediaQuery, kinds, screen, runMediaSearch])

	const searchByMedia = (mq: MediaQuery) => {
		setQueryRaw('')
		setSimilarTo(null)
		setMediaQuery(mq)
	}

	const findSimilar = (hit: MediaHit) =>
		act(async () => {
			setMediaQuery(null)
			const similar = await folderSimilar(hit.fileId, { folderId: hit.folderId })
			setQueryRaw('')
			setSimilarTo(hit.relPath)
			setResults({ query: '', media: similar, documents: [], leading: 'media', exactStyle: false, partialIndex: false, tookMs: 0 })
		})

	return {
		screen, setScreen, settings, folders, activeFolder, access, model, download, progress, running, scan, scanning, files,
		error, setError, reindexNeeded, query, setQuery, submitSearch, similarTo, mediaQuery, searchByMedia, kinds, setKinds, results, searching, searchError,
		webgpuProblem: webgpuFailure ?? model?.webgpuReason ?? null, approveCpuFallback, revokeCpuFallback,
		begin, startDownload, cancelDownload, choose, chooseAgain, rescanSummary, updateFolder, startIndexing, reconnect,
		removeFolder, removeModels, patchSettings, findSimilar, refreshFolders, refreshFiles, setModel,
		pause: () => act(folderIndexPause),
		resume: () => act(folderIndexResume),
		cancel: () => act(folderIndexCancel),
	}
}
