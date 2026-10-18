/**
 * Indexing pipeline (design §5), offscreen document only:
 *
 *   walk → classify → skip rules → extract → chunk → embed → write → checkpoint
 *
 * One loop reads files and feeds the single embedder, so two models never share the GPU at once.
 * Every file is committed on its own, so the run is resumable after the browser closes the
 * offscreen document: unfinished files stay `pending` and are picked up by the next start.
 */
import { gemma } from '@/browser-ml/gemma-embeddings'

import { buildDocumentInput, chunkPages, chunkText } from './chunker'
import {
	chunkIdOf,
	clearFileDerived,
	deleteFileCascade,
	deleteFolderData,
	filesByHash,
	getFiles,
	getFolder,
	mergePostings,
	nameChunkId,
	pageChunkId,
	putChunks,
	putFiles,
	putFolder,
	putImageVector,
	putMediaUnits,
	SOUNDTRACK_SUFFIX,
	unitIdOf,
} from './db'
import { diffScan } from './diff'
import { extractDocumentText } from './extractors/text'
import {
	AUDIO_WINDOW_SEC,
	decodeAudioWindows,
	decodeImage,
	videoSegments,
} from './extractors/media'
import { PDF_FIRST_PAGES, PDF_MAX_PAGES, openPdf } from './extractors/pdf'
import { fingerprint } from './extractors/pure'
import { termFrequencies } from './keywords'
import { SOUNDTRACK_MAX_BYTES, VIDEO_MAX_SEGMENTS } from './videoPlan'
import { ensureLoaded } from './modelManager'
import type { SearchIndex } from './searchIndex'
import {
	compareSignatures,
	getStoredSignature,
	loadFolderSearchSettings,
	signatureFor,
	storeSignature,
} from './settings'
import type {
	ChunkRecord,
	EnabledKinds,
	FileRecord,
	FolderRecord,
	IndexProgress,
	MediaKindKey,
	MediaUnitRecord,
	ScanSummary,
} from './types'
import { type FsFileHandle, walk } from './walker'
import { broadFolderWarning } from './classify'

/** Raised when stored vectors were built with a different model/dtype/dim. UI offers a re-index. */
export const REINDEX_REQUIRED = 'REINDEX_REQUIRED'

const MAX_CHUNKS_PER_FILE = 4000
const PROGRESS_INTERVAL_MS = 250
/** Rough throughput used for the pre-scan estimate until real samples exist (design §10 targets). */
const EST_SECONDS_PER_ITEM: Record<MediaKindKey, number> = { image: 0.2, document: 0.6, audio: 3, video: 8 }

export interface IndexerDeps {
	index: SearchIndex
	emit(progress: IndexProgress): void
}

interface PermissionHandle {
	queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>
}

export async function assertReadable(folder: FolderRecord): Promise<void> {
	const state = await (folder.handle as unknown as PermissionHandle).queryPermission?.({ mode: 'read' })
	if (state !== 'granted') {
		throw new Error('Permission to read this folder has expired. Reconnect the folder and try again.')
	}
}

/** Kinds that can actually be embedded with the components the user downloaded. */
export function effectiveKinds(folder: FolderRecord, vision: boolean, audio: boolean): EnabledKinds {
	return {
		documents: folder.kinds.documents,
		images: folder.kinds.images && vision,
		video: folder.kinds.video && vision,
		audio: folder.kinds.audio && audio,
	}
}

const fileIdOf = (folderId: string, relPath: string) => `${folderId}:${relPath}`

function emptyProgress(folderId: string): IndexProgress {
	return {
		folderId,
		phase: 'idle',
		total: 0,
		done: 0,
		byKind: {
			image: { total: 0, done: 0 },
			document: { total: 0, done: 0 },
			audio: { total: 0, done: 0 },
			video: { total: 0, done: 0 },
		},
		currentFile: null,
		skipped: 0,
		errors: 0,
		startedAt: null,
		etaSec: null,
	}
}

/** Fast pre-scan for the confirmation screen: walks metadata only, reads no file contents. */
export async function scanFolder(folderId: string): Promise<ScanSummary> {
	const folder = await getFolder(folderId)
	if (!folder) throw new Error('Folder not found')
	await assertReadable(folder)
	const settings = await loadFolderSearchSettings()
	const kinds = effectiveKinds(folder, true, true)
	const counts: ScanSummary['counts'] = {
		image: { files: 0, bytes: 0 },
		document: { files: 0, bytes: 0 },
		audio: { files: 0, bytes: 0 },
		video: { files: 0, bytes: 0 },
		other: { files: 0, bytes: 0 },
	}
	const skipped: ScanSummary['skipped'] = []
	let skippedCount = 0
	let total = 0
	for await (const e of walk(folder.handle as never, { excludes: folder.excludes, caps: folder.caps, kinds })) {
		if (e.type === 'skipped-dir') {
			skippedCount++
			if (skipped.length < 500) skipped.push({ relPath: e.relPath, reason: e.reason })
			continue
		}
		if (e.type === 'error') continue
		total++
		if (e.skip) {
			skippedCount++
			if (skipped.length < 500) skipped.push({ relPath: e.relPath, reason: e.skip })
			continue
		}
		counts[e.kind].files++
		counts[e.kind].bytes += e.size
	}
	let est = 0
	for (const k of ['image', 'document', 'audio', 'video'] as const) est += counts[k].files * EST_SECONDS_PER_ITEM[k]
	return {
		folderName: folder.name,
		counts,
		skipped,
		skippedCount,
		totalFiles: total,
		broadFolderWarning: broadFolderWarning(folder.name, total),
		// Goal numbers from design §10, not measurements; the UI labels this as a rough guess.
		estimatedSeconds: settings.selection.vision || counts.document.files ? Math.round(est) : null,
	}
}

export class Indexer {
	private progress: IndexProgress | null = null
	private running: Promise<void> | null = null
	private paused = false
	private cancelled = false
	private waiters: (() => void)[] = []
	private lastEmit = 0
	private sampleStart = 0

	constructor(private deps: IndexerDeps) {}

	get isRunning(): boolean {
		return this.running !== null
	}
	status(): IndexProgress | null {
		return this.progress
	}

	start(folderId: string, opts: { retryErrors?: boolean; reindex?: boolean } = {}): void {
		if (this.running) throw new Error('Indexing is already running')
		this.paused = this.cancelled = false
		this.progress = { ...emptyProgress(folderId), phase: 'scanning', startedAt: Date.now() }
		this.running = this.run(folderId, opts)
			.catch(e => {
				const message = e instanceof Error ? e.message : String(e)
				console.error('[folder-search] indexing failed', e)
				this.update({ phase: 'error', message }, true)
			})
			.finally(async () => {
				this.running = null
				const f = this.progress ? await getFolder(this.progress.folderId) : undefined
				if (f && f.status === 'indexing') await putFolder({ ...f, status: this.paused ? 'paused' : 'idle' })
				await this.releaseEncoders()
			})
	}

	pause(): void {
		this.paused = true
		this.update({ phase: 'paused' }, true)
	}
	resume(): void {
		this.paused = false
		this.update({ phase: 'indexing' }, true)
		for (const w of this.waiters.splice(0)) w()
	}
	cancel(): void {
		this.cancelled = true
		for (const w of this.waiters.splice(0)) w()
	}

	private update(patch: Partial<IndexProgress>, force = false): void {
		if (!this.progress) return
		this.progress = { ...this.progress, ...patch }
		const now = Date.now()
		if (force || now - this.lastEmit >= PROGRESS_INTERVAL_MS) {
			this.lastEmit = now
			this.deps.emit(this.progress)
		}
	}

	private async gate(): Promise<void> {
		while (this.paused && !this.cancelled) await new Promise<void>(res => this.waiters.push(res))
		if (this.cancelled) throw new CancelledError()
	}

	/** Drop the vision/audio encoders when idle; the text path stays warm for queries (design §1.1). */
	private async releaseEncoders(): Promise<void> {
		try {
			if (gemma.isLoaded && (gemma.hasVision || gemma.hasAudio)) {
				const s = await loadFolderSearchSettings()
				await ensureLoaded({ ...s.selection, vision: false, audio: false })
			}
		} catch (e) {
			console.warn('[folder-search] could not release encoders', e)
		}
	}

	private async run(folderId: string, opts: { retryErrors?: boolean; reindex?: boolean }): Promise<void> {
		const folder = await getFolder(folderId)
		if (!folder) throw new Error('Folder not found')
		await assertReadable(folder)
		const settings = await loadFolderSearchSettings()
		if (!settings.modelConsent) throw new Error('The search model has not been downloaded yet.')
		this.deps.index.setDim(settings.dim)

		const sig = signatureFor(settings)
		const known = await getFiles(folderId)
		const check = compareSignatures(await getStoredSignature(folderId), sig)
		if (check === 'mismatch' && known.length) {
			if (!opts.reindex) {
				throw new Error(`${REINDEX_REQUIRED}: the index was built with a different model, precision or size`)
			}
			await deleteFolderData(folderId, { keepFolder: true })
			this.deps.index.invalidate(folderId)
			known.length = 0
		}

		await putFolder({ ...folder, status: 'indexing' })
		const kinds = effectiveKinds(folder, settings.selection.vision, settings.selection.audio)

		// ── scan ──
		const handles = new Map<string, FsFileHandle>()
		const scanned: { relPath: string; size: number; mtime: number; kind: FileRecord['kind']; mime: string; skip: FileRecord['skipReason'] | null }[] = []
		let skipped = 0
		let errors = 0
		const dirSkips: FileRecord[] = []
		for await (const e of walk(folder.handle as never, { excludes: folder.excludes, caps: folder.caps, kinds })) {
			await this.gate()
			if (e.type === 'file') {
				handles.set(e.relPath, e.handle)
				scanned.push({ relPath: e.relPath, size: e.size, mtime: e.mtime, kind: e.kind, mime: e.mime, skip: e.skip })
			} else if (e.type === 'skipped-dir') {
				skipped++
				dirSkips.push({
					fileId: fileIdOf(folderId, `${e.relPath}/`),
					folderId,
					relPath: `${e.relPath}/`,
					size: 0,
					mtime: 0,
					kind: 'other',
					mime: '',
					indexState: 'skipped',
					skipReason: e.reason,
				})
			} else {
				errors++
				dirSkips.push({
					fileId: fileIdOf(folderId, e.relPath),
					folderId,
					relPath: e.relPath,
					size: 0,
					mtime: 0,
					kind: 'other',
					mime: '',
					indexState: 'error',
					error: e.message,
				})
			}
			this.update({ message: `Scanning… ${scanned.length} files`, currentFile: e.relPath })
		}

		// ── reconcile with the stored inventory ──
		// Skipped-directory and unreadable-entry rows are regenerated on every scan.
		const isMarker = (f: FileRecord) => f.relPath.endsWith('/') || (f.kind === 'other' && f.indexState === 'error')
		for (const m of known.filter(isMarker)) await deleteFileCascade(m.fileId)
		const knownMap = new Map(known.filter(f => !isMarker(f)).map(f => [f.relPath, f]))
		const diff = diffScan(knownMap, scanned, { retryErrors: opts.retryErrors })
		for (const relPath of diff.deleted) {
			const rec = knownMap.get(relPath)!
			await this.removeFile(rec)
		}
		const byPath = new Map(scanned.map(s => [s.relPath, s]))
		const writes: FileRecord[] = []
		for (const s of [...diff.added, ...diff.changed]) {
			const meta = byPath.get(s.relPath)!
			const old = knownMap.get(s.relPath)
			if (old) await this.removeFile(old)
			writes.push({
				fileId: fileIdOf(folderId, s.relPath),
				folderId,
				relPath: s.relPath,
				size: s.size,
				mtime: s.mtime,
				kind: meta.kind,
				mime: meta.mime,
				indexState: meta.skip ? 'skipped' : 'pending',
				skipReason: meta.skip ?? undefined,
			})
		}
		// Settings changed (e.g. images turned on, caps raised): re-evaluate previously skipped files.
		for (const s of [...diff.unchanged, ...diff.resume]) {
			const old = knownMap.get(s.relPath)!
			const meta = byPath.get(s.relPath)!
			if (old.indexState === 'skipped' && !meta.skip) {
				writes.push({ ...old, indexState: 'pending', skipReason: undefined })
			} else if (old.indexState === 'skipped' && meta.skip && meta.skip !== old.skipReason) {
				writes.push({ ...old, skipReason: meta.skip })
			}
		}
		await putFiles([...writes, ...dirSkips])

		const inventory = await getFiles(folderId)
		skipped = inventory.filter(f => f.indexState === 'skipped').length
		const queue = inventory
			.filter(f => f.indexState === 'pending' && handles.has(f.relPath))
			.sort((a, b) => a.relPath.localeCompare(b.relPath))
		const byKind = emptyProgress(folderId).byKind
		for (const f of queue) if (f.kind in byKind) byKind[f.kind as MediaKindKey].total++
		// Load (and, on first use, download) encoders only when there is work, so a quiet rescan of an
		// unchanged folder never wakes the GPU.
		if (queue.length) await ensureLoaded(settings.selection)
		this.sampleStart = Date.now()
		this.update({ phase: 'indexing', total: queue.length, done: 0, byKind, skipped, errors, message: undefined }, true)

		// ── index ──
		let done = 0
		try {
			for (const rec of queue) {
				await this.gate()
				this.update({ currentFile: rec.relPath })
				const handle = handles.get(rec.relPath)!
				const result = await this.indexFile(rec, handle, settings.dim, settings.selection.vision)
				if (result.indexState === 'error') errors++
				if (result.indexState === 'skipped') skipped++
				await putFiles([result])
				this.deps.index.noteFile(result)
				done++
				if (rec.kind in byKind) byKind[rec.kind as MediaKindKey].done++
				const elapsed = (Date.now() - this.sampleStart) / 1000
				this.update({
					done,
					byKind: { ...byKind },
					errors,
					skipped,
					etaSec: done >= 3 ? Math.round((elapsed / done) * (queue.length - done)) : null,
				})
			}
			await this.backgroundPdfPages(folderId, handles, settings.dim, settings.selection.vision)
		} catch (e) {
			if (e instanceof CancelledError) {
				this.update({ phase: 'cancelled', currentFile: null }, true)
				return
			}
			throw e
		}

		await storeSignature(folderId, sig)
		const latest = await getFolder(folderId)
		if (latest) await putFolder({ ...latest, lastIndexedAt: Date.now(), status: 'idle' })
		this.update({ phase: 'done', currentFile: null, etaSec: 0, message: undefined }, true)
	}

	/** Deletes a file's index data; byte-identical duplicates that pointed at it become pending again. */
	private async removeFile(rec: FileRecord): Promise<void> {
		const dependents = (await getFiles(rec.folderId)).filter(f => f.duplicateOf === rec.fileId)
		await deleteFileCascade(rec.fileId)
		this.deps.index.forgetFile(rec.folderId, rec.fileId)
		if (dependents.length) {
			const reset = dependents.map(d => ({ ...d, indexState: 'pending' as const, duplicateOf: undefined }))
			await putFiles(reset)
			for (const d of reset) this.deps.index.forgetFile(d.folderId, d.fileId)
		}
	}

	private async indexFile(
		rec: FileRecord,
		handle: FsFileHandle,
		dim: number,
		vision: boolean
	): Promise<FileRecord> {
		try {
			const file = await resolveFileFromHandle(handle)
			const base: FileRecord = { ...rec, error: undefined, note: undefined }

			const hash = await fingerprint(file)
			const twin = (await filesByHash(hash)).find(
				f => f.fileId !== rec.fileId && f.folderId === rec.folderId && f.size === rec.size && f.indexState === 'indexed' && !f.duplicateOf
			)
			await this.addNamePostings(rec)
			if (twin) return { ...base, contentHash: hash, duplicateOf: twin.fileId, indexState: 'indexed' }
			base.contentHash = hash

			let out: FileRecord
			switch (rec.kind) {
				case 'document':
					out = rec.relPath.toLowerCase().endsWith('.pdf')
						? await this.indexPdf(base, file, dim, vision, 1, PDF_FIRST_PAGES)
						: await this.indexText(base, file, dim)
					break
				case 'image':
					out = await this.indexImage(base, file, dim)
					break
				case 'audio':
					out = await this.indexAudio(base, file, dim)
					break
				case 'video':
					out = await this.indexVideo(base, file, dim)
					break
				default:
					return { ...base, indexState: 'skipped', skipReason: 'unsupported' }
			}
			// If the file changed while we were embedding it, the vectors are stale: redo it next run.
			const after = await resolveFileFromHandle(handle)
			if (after.lastModified !== rec.mtime) {
				await deleteFileCascade(rec.fileId)
				this.deps.index.forgetFile(rec.folderId, rec.fileId)
				return { ...base, indexState: 'pending', note: 'File changed while indexing; it will be re-indexed on the next scan' }
			}
			return out
		} catch (e) {
			if (e instanceof CancelledError) {
				// Roll back partial rows so resuming does not double-index this file.
				await clearFileDerived(rec.fileId).catch(() => undefined)
				this.deps.index.forgetFile(rec.folderId, rec.fileId)
				throw e
			}
			if (isQuotaError(e)) {
				throw new Error('Browser storage is full. Free space or remove the index in Manage → Storage, then resume.', { cause: e })
			}
			const message = e instanceof Error ? e.message : String(e)
			console.warn(`[folder-search] failed to index ${rec.relPath}`, e)
			// Drop partial rows so a failed file never leaves half an index behind.
			await deleteFileCascade(rec.fileId).catch(() => undefined)
			this.deps.index.forgetFile(rec.folderId, rec.fileId)
			return { ...rec, indexState: 'error', error: message }
		}
	}

	private async addNamePostings(rec: FileRecord): Promise<void> {
		const add = new Map<string, Record<string, number>>()
		for (const [term, tf] of termFrequencies(rec.relPath)) add.set(term, { [nameChunkId(rec.fileId)]: tf })
		await mergePostings(rec.folderId, add)
	}

	private async storeChunks(rec: FileRecord, chunks: ChunkRecord[]): Promise<void> {
		if (!chunks.length) return
		await putChunks(chunks)
		const add = new Map<string, Record<string, number>>()
		for (const c of chunks) {
			if (c.source !== 'text') continue
			for (const [term, tf] of termFrequencies(c.text)) {
				add.set(term, { ...(add.get(term) ?? {}), [c.chunkId]: tf })
			}
		}
		await mergePostings(rec.folderId, add)
		this.deps.index.noteChunks(rec.folderId, chunks)
	}

	private async embedChunks(
		rec: FileRecord,
		pieces: { text: string; offset: number; page?: number; idx: number }[],
		dim: number
	): Promise<ChunkRecord[]> {
		const vectors = await gemma.embedTexts(pieces.map(p => buildDocumentInput(rec.relPath, p.text)), dim)
		return pieces.map((p, i) => ({
			chunkId: chunkIdOf(rec.fileId, p.idx),
			fileId: rec.fileId,
			folderId: rec.folderId,
			chunkIdx: p.idx,
			text: p.text,
			page: p.page,
			offset: p.offset,
			source: 'text' as const,
			embedding: vectors[i]!,
		}))
	}

	private async indexText(rec: FileRecord, file: File, dim: number): Promise<FileRecord> {
		const text = await extractDocumentText(file)
		let chunks = chunkText(text)
		if (!chunks.length) return { ...rec, indexState: 'skipped', skipReason: 'empty' }
		let note: string | undefined
		if (chunks.length > MAX_CHUNKS_PER_FILE) {
			note = `Truncated: only the first ${MAX_CHUNKS_PER_FILE} of ${chunks.length} sections were indexed`
			chunks = chunks.slice(0, MAX_CHUNKS_PER_FILE)
		}
		await this.storeChunks(rec, await this.embedChunks(rec, chunks.map((c, idx) => ({ ...c, idx })), dim))
		return { ...rec, indexState: 'indexed', units: chunks.length, note }
	}

	/**
	 * Indexes PDF pages `from..to` (text chunks plus, with the vision encoder, a page render). The
	 * first pass covers the first pages so the file is searchable immediately; the rest follows in
	 * `backgroundPdfPages` (design §5.3).
	 */
	private async indexPdf(
		rec: FileRecord,
		file: File,
		dim: number,
		vision: boolean,
		from: number,
		to: number
	): Promise<FileRecord> {
		const pdf = await openPdf(file)
		try {
			const limit = Math.min(pdf.numPages, PDF_MAX_PAGES)
			const last = Math.min(to, limit)
			let units = rec.units ?? 0
			let pagesWithText = 0
			for (let page = from; page <= last; page++) {
				await this.gate()
				const text = await pdf.pageText(page)
				const records: ChunkRecord[] = []
				if (text.trim()) {
					pagesWithText++
					const pieces = chunkPages([{ page, text }]).map((c, i) => ({ ...c, idx: page * 1000 + i }))
					records.push(...(await this.embedChunks(rec, pieces.slice(0, 999), dim)))
				}
				if (vision) {
					const { raw, thumbnail } = await pdf.renderPage(page)
					const [vec] = await gemma.embedImages([raw], dim)
					records.push({
						chunkId: pageChunkId(rec.fileId, page),
						fileId: rec.fileId,
						folderId: rec.folderId,
						chunkIdx: -page,
						text: '',
						page,
						offset: 0,
						source: 'page-image',
						embedding: vec!,
						thumbnail,
					})
				}
				await this.storeChunks(rec, records)
				units += records.length
				// Background passes checkpoint per page so a cancel leaves a consistent inventory.
				if (from > 1) await putFiles([{ ...rec, indexState: 'indexed', units, pagesTotal: pdf.numPages, pagesDone: page }])
			}
			const note =
				pagesWithText === 0 && from === 1
					? vision
						? 'No text layer (scanned?). Pages are searchable by their appearance only.'
						: 'No text layer (scanned?). Turn on image indexing to make scanned pages searchable.'
					: pdf.numPages > PDF_MAX_PAGES
						? `Only the first ${PDF_MAX_PAGES} of ${pdf.numPages} pages are indexed`
						: undefined
			return { ...rec, indexState: 'indexed', units, pagesTotal: pdf.numPages, pagesDone: last, note: note ?? rec.note }
		} finally {
			await pdf.destroy()
		}
	}

	private async backgroundPdfPages(
		folderId: string,
		handles: Map<string, FsFileHandle>,
		dim: number,
		vision: boolean
	): Promise<void> {
		const todo = (await getFiles(folderId)).filter(
			f =>
				f.indexState === 'indexed' &&
				f.pagesTotal !== undefined &&
				(f.pagesDone ?? 0) < Math.min(f.pagesTotal, PDF_MAX_PAGES)
		)
		if (todo.length) await ensureLoaded({ ...(await loadFolderSearchSettings()).selection })
		for (const rec of todo) {
			await this.gate()
			const handle = handles.get(rec.relPath)
			if (!handle) continue
			this.update({ currentFile: rec.relPath, message: `Reading remaining pages of ${rec.relPath}` })
			try {
				const file = await resolveFileFromHandle(handle)
				if (file.lastModified !== rec.mtime) continue
				const next = await this.indexPdf(rec, file, dim, vision, (rec.pagesDone ?? 0) + 1, PDF_MAX_PAGES)
				await putFiles([next])
				this.deps.index.noteFile(next)
			} catch (e) {
				if (e instanceof CancelledError) throw e
				if (isQuotaError(e)) throw new Error('Browser storage is full. Free space, then resume.', { cause: e })
				const message = e instanceof Error ? e.message : String(e)
				console.warn(`[folder-search] background pages failed for ${rec.relPath}`, e)
				await putFiles([{ ...rec, note: `Later pages not indexed: ${message}` }])
			}
		}
		this.update({ message: undefined })
	}

	private async indexImage(rec: FileRecord, file: File, dim: number): Promise<FileRecord> {
		const img = await decodeImage(file)
		const [vec] = await gemma.embedImages([img.raw], dim)
		const row = {
			fileId: rec.fileId,
			folderId: rec.folderId,
			embedding: vec!,
			width: img.width,
			height: img.height,
			thumbnail: img.thumbnail,
		}
		await putImageVector(row)
		this.deps.index.noteImage(row)
		return { ...rec, indexState: 'indexed', units: 1 }
	}

	private async indexAudio(rec: FileRecord, file: File, dim: number): Promise<FileRecord> {
		const { windows, startSecs, truncated } = await decodeAudioWindows(file)
		if (!windows.length) return { ...rec, indexState: 'skipped', skipReason: 'empty' }
		const vectors = await gemma.embedAudio(windows, dim)
		const units: MediaUnitRecord[] = vectors.map((embedding, i) => ({
			unitId: unitIdOf(rec.fileId, startSecs[i]!),
			fileId: rec.fileId,
			folderId: rec.folderId,
			unitIdx: i,
			kind: 'audio',
			startSec: startSecs[i]!,
			endSec: startSecs[i]! + AUDIO_WINDOW_SEC,
			embedding,
		}))
		await putMediaUnits(units)
		this.deps.index.noteUnits(rec.folderId, units)
		return {
			...rec,
			indexState: 'indexed',
			units: units.length,
			note: truncated ? 'Only the first 30 minutes were indexed' : undefined,
		}
	}

	/**
	 * Video (design §14.5): one segment per minute through the `videos` modality, one vector per
	 * segment, plus the soundtrack as separate 30 s audio windows when the audio encoder is loaded.
	 */
	private async indexVideo(rec: FileRecord, file: File, dim: number): Promise<FileRecord> {
		const units: MediaUnitRecord[] = []
		const notes: string[] = []
		const gen = videoSegments(file)
		let truncated: boolean
		for (;;) {
			await this.gate()
			const next = await gen.next()
			if (next.done) {
				truncated = next.value.truncated
				break
			}
			const seg = next.value
			const [embedding] = await gemma.embedVideos([{ frames: seg.frames, duration: seg.end - seg.start }], dim)
			const unit: MediaUnitRecord = {
				unitId: unitIdOf(rec.fileId, seg.start),
				fileId: rec.fileId,
				folderId: rec.folderId,
				unitIdx: units.length,
				kind: 'video',
				startSec: seg.start,
				endSec: seg.end,
				embedding: embedding!,
				thumbnail: seg.thumbnail,
			}
			await putMediaUnits([unit])
			this.deps.index.noteUnits(rec.folderId, [unit])
			units.push(unit)
		}
		if (truncated) notes.push(`Only the first ${VIDEO_MAX_SEGMENTS} minutes were indexed`)

		if (gemma.hasAudio) {
			if (rec.size > SOUNDTRACK_MAX_BYTES) {
				notes.push('Soundtrack not indexed: file is over 200 MB')
			} else {
				try {
					const { windows, startSecs } = await decodeAudioWindows(file)
					const vectors = windows.length ? await gemma.embedAudio(windows, dim) : []
					const sound: MediaUnitRecord[] = vectors.map((embedding, i) => ({
						unitId: unitIdOf(rec.fileId, startSecs[i]!, SOUNDTRACK_SUFFIX),
						fileId: rec.fileId,
						folderId: rec.folderId,
						unitIdx: units.length + i,
						kind: 'audio',
						startSec: startSecs[i]!,
						endSec: startSecs[i]! + AUDIO_WINDOW_SEC,
						embedding,
					}))
					await putMediaUnits(sound)
					this.deps.index.noteUnits(rec.folderId, sound)
					units.push(...sound)
				} catch (e) {
					if (e instanceof CancelledError) throw e
					// No audio track (or an undecodable one) must not fail the visual index.
					notes.push(`Soundtrack not indexed: ${e instanceof Error ? e.message : String(e)}`)
				}
			}
		}
		if (!units.length) return { ...rec, indexState: 'skipped', skipReason: 'empty' }
		return { ...rec, indexState: 'indexed', units: units.length, note: notes.join('. ') || undefined }
	}
}

class CancelledError extends Error {
	constructor() {
		super('Indexing cancelled')
	}
}

async function resolveFileFromHandle(handle: FsFileHandle): Promise<File> {
	return (await handle.getFile()) as File
}

function isQuotaError(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'QuotaExceededError'
}
