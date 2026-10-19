/**
 * Side-panel / full-tab API for Folder Search. All heavy work happens in the offscreen document
 * (see AGENTS.md > "On-device ML"); this module only message-passes. It must not import the
 * embedder, extractors or indexer.
 */
import { sendToOffscreen } from '@/browser-ml/offscreen-bridge'

import type { DownloadSnapshot, ModelStatus } from './modelCatalog'
import type {
	IndexProgress,
	MediaHit,
	ModelSelection,
	ScanSummary,
	SearchOptions,
	SearchResponse,
} from './types'

const MINUTE = 60_000

export const folderModelStatus = (selection: ModelSelection) =>
	sendToOffscreen<ModelStatus>('offscreen:folder:model:status', { selection }, 30_000)
/** Resolves when the model is downloaded and loaded; progress arrives as `folder:event` messages. */
export const folderModelDownload = (selection: ModelSelection) =>
	sendToOffscreen<ModelStatus>('offscreen:folder:model:download', { selection }, 60 * MINUTE)
export const folderModelProgress = () =>
	sendToOffscreen<DownloadSnapshot>('offscreen:folder:model:progress', {}, 10_000)
export const folderModelRemove = () =>
	sendToOffscreen<{ freedBytes: number }>('offscreen:folder:model:remove', {}, MINUTE)

export const folderScan = (folderId: string) =>
	sendToOffscreen<ScanSummary>('offscreen:folder:scan', { folderId }, 30 * MINUTE)

export const folderIndexStart = (folderId: string, opts: { retryErrors?: boolean; reindex?: boolean } = {}) =>
	sendToOffscreen<{ started: true }>('offscreen:folder:index:start', { folderId, ...opts }, 5 * MINUTE)
export const folderIndexPause = () => sendToOffscreen('offscreen:folder:index:pause', {}, 10_000)
export const folderIndexResume = () => sendToOffscreen('offscreen:folder:index:resume', {}, 10_000)
export const folderIndexCancel = () => sendToOffscreen('offscreen:folder:index:cancel', {}, 10_000)
export const folderIndexStatus = () =>
	sendToOffscreen<{ running: boolean; progress: IndexProgress | null }>('offscreen:folder:index:status', {}, 10_000)
export const folderIndexRemove = (folderId: string) =>
	sendToOffscreen('offscreen:folder:index:remove', { folderId }, 5 * MINUTE)

export const folderSearch = (query: string, options: Omit<SearchOptions, 'folderId'> & { folderIds: string[] }) =>
	sendToOffscreen<SearchResponse>('offscreen:folder:search', { query, options }, 2 * MINUTE)
export const folderSimilar = (fileId: string, options: SearchOptions) =>
	sendToOffscreen<MediaHit[]>('offscreen:folder:similar', { fileId, options }, MINUTE)
/** Query by an image (camera / picture) or a recording. `data` is base64: messages are JSON. */
export const folderSearchMedia = (
	kind: 'image' | 'audio',
	data: string,
	mime: string,
	options: Omit<SearchOptions, 'folderId'> & { folderIds: string[] }
) => sendToOffscreen<SearchResponse>('offscreen:folder:search-media', { kind, data, mime, options }, 2 * MINUTE)
