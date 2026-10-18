/**
 * Offscreen-side message handlers for Folder Search (`offscreen:folder:*`). Imported only by
 * `entrypoints/offscreen/main.ts`; the side panel talks to it through `bridge.ts`.
 */
import { gemma } from '@/browser-ml/gemma-embeddings'

import { deleteFolderData, getFolder } from './db'
import { FOLDER_EVENT, type FolderEvent } from './events'
import { Indexer, REINDEX_REQUIRED, scanFolder } from './indexer'
import {
	currentDownload,
	downloadAndLoad,
	modelStatus,
	onDownloadProgress,
	removeModels,
} from './modelManager'
import { mergeSearchResponses } from './merge'
import { SearchIndex } from './searchIndex'
import { loadFolderSearchSettings } from './settings'
import type { IndexProgress, ModelSelection, SearchOptions } from './types'

function broadcast(e: FolderEvent): void {
	// No listener (panel closed) is normal; any other failure is worth seeing.
	chrome.runtime.sendMessage({ type: FOLDER_EVENT, ...e }).catch(err => {
		if (!/Receiving end does not exist|message port closed/i.test(String(err?.message ?? err))) {
			console.warn('[folder-search] broadcast failed', err)
		}
	})
}

let searchIndex: SearchIndex | null = null
let indexer: Indexer | null = null

async function getSearchIndex(): Promise<SearchIndex> {
	if (!searchIndex) searchIndex = new SearchIndex((await loadFolderSearchSettings()).dim)
	return searchIndex
}

async function getIndexer(): Promise<Indexer> {
	indexer ??= new Indexer({
		index: await getSearchIndex(),
		emit: progress => broadcast({ event: 'index-progress', progress }),
	})
	return indexer
}

onDownloadProgress(snapshot => broadcast({ event: 'model-progress', snapshot }))

/** Queries need the text path; it must already be consented to and cached, never silently fetched. */
async function ensureTextReady(): Promise<void> {
	if (gemma.isLoaded) return
	const s = await loadFolderSearchSettings()
	if (!s.modelConsent) throw new Error('The search model has not been downloaded yet.')
	await downloadAndLoad({ ...s.selection, vision: false, audio: false })
}

type Msg = Record<string, unknown>

export async function handleFolderMessage(type: string, msg: Msg): Promise<unknown> {
	const op = type.replace(/^offscreen:folder:/, '')
	switch (op) {
		case 'model:status':
			return modelStatus(msg.selection as ModelSelection)
		case 'model:download':
			return downloadAndLoad(msg.selection as ModelSelection)
		case 'model:progress':
			return currentDownload()
		case 'model:remove':
			return removeModels()

		case 'scan':
			return scanFolder(msg.folderId as string)

		case 'index:start': {
			const ix = await getIndexer()
			ix.start(msg.folderId as string, {
				retryErrors: Boolean(msg.retryErrors),
				reindex: Boolean(msg.reindex),
			})
			return { started: true }
		}
		case 'index:pause':
			;(await getIndexer()).pause()
			return { ok: true }
		case 'index:resume':
			;(await getIndexer()).resume()
			return { ok: true }
		case 'index:cancel':
			;(await getIndexer()).cancel()
			return { ok: true }
		case 'index:status': {
			const ix = await getIndexer()
			return { running: ix.isRunning, progress: ix.status() }
		}
		case 'index:remove': {
			const folderId = msg.folderId as string
			if (indexer?.isRunning) throw new Error('Stop indexing before removing the folder')
			await deleteFolderData(folderId)
			;(await getSearchIndex()).invalidate(folderId)
			return { ok: true }
		}

		case 'search': {
			await ensureTextReady()
			const ix = await getIndexer()
			const index = await getSearchIndex()
			const { folderIds, ...rest } = msg.options as Omit<SearchOptions, 'folderId'> & { folderIds: string[] }
			const parts = await Promise.all(
				folderIds.map(folderId => index.search(msg.query as string, { ...rest, folderId }, ix.isRunning))
			)
			return mergeSearchResponses(parts)
		}
		case 'similar': {
			const opts = msg.options as SearchOptions
			if (!(await getFolder(opts.folderId))) throw new Error('Folder not found')
			return (await getSearchIndex()).similar(opts, msg.fileId as string)
		}
		case 'stats':
			return (await getSearchIndex()).stats(msg.folderId as string)

		default:
			throw new Error(`Unknown folder-search message: ${type}`)
	}
}

export { REINDEX_REQUIRED }
