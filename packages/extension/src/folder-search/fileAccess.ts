/**
 * File System Access helpers for extension pages (side panel / full tab / settings). Read-only by
 * design: we never request `readwrite` and import no write APIs (design §2.3, §9). The picker needs
 * a user gesture on the page that owns the handle, so none of this runs in the offscreen document.
 */
import { DEFAULT_CAPS, DEFAULT_KINDS } from './classify'
import { putFolder } from './db'
import type { FolderRecord } from './types'
import { resolveFile } from './walker'

type PermHandle = FileSystemDirectoryHandle & {
	queryPermission(d: { mode: 'read' }): Promise<PermissionState>
	requestPermission(d: { mode: 'read' }): Promise<PermissionState>
}

export function hasFileSystemAccess(): boolean {
	return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/** Opens the OS folder picker. Must be called from a click handler. Returns null if cancelled. */
export async function pickFolder(): Promise<FolderRecord | null> {
	try {
		const handle = await (window as unknown as {
			showDirectoryPicker(o: { id: string; mode: 'read' }): Promise<FileSystemDirectoryHandle>
		}).showDirectoryPicker({ id: 'folder-search', mode: 'read' })
		const record: FolderRecord = {
			folderId: crypto.randomUUID(),
			name: handle.name,
			handle,
			createdAt: Date.now(),
			lastIndexedAt: null,
			status: 'idle',
			excludes: [],
			caps: { ...DEFAULT_CAPS },
			kinds: { ...DEFAULT_KINDS },
		}
		await putFolder(record)
		return record
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return null
		throw e
	}
}

export type FolderAccess = 'granted' | 'prompt' | 'denied' | 'missing'

/** Current read permission, or `missing` when the folder was moved, renamed or deleted. */
export async function folderAccess(folder: FolderRecord): Promise<FolderAccess> {
	const h = folder.handle as PermHandle
	const state = await h.queryPermission({ mode: 'read' })
	if (state !== 'granted') return state
	try {
		await h.values().next()
		return 'granted'
	} catch (e) {
		if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return 'missing'
		throw e
	}
}

/** Re-grants read access after a browser restart. Must be called from a click handler. */
export async function reconnectFolder(folder: FolderRecord): Promise<FolderAccess> {
	const state = await (folder.handle as PermHandle).requestPermission({ mode: 'read' })
	return state === 'granted' ? folderAccess(folder) : state
}

export async function readFolderFile(folder: FolderRecord, relPath: string): Promise<File> {
	return resolveFile(folder.handle as never, relPath)
}

const NATIVE_VIEWABLE = /\.(pdf|txt|md|markdown|csv|json|html?|xml|png|jpe?g|webp|gif|bmp|avif|mp3|wav|ogg|m4a|mp4|webm)$/i

/**
 * Opens a result: renders natively in a tab when the browser can (PDFs at `#page=N`, media at
 * `#t=seconds`), otherwise saves a copy. Extensions cannot launch OS applications (design §4.3).
 */
export async function openResult(
	folder: FolderRecord,
	relPath: string,
	at: { page?: number; startSec?: number } = {}
): Promise<'opened' | 'downloaded'> {
	const file = await readFolderFile(folder, relPath)
	const url = URL.createObjectURL(file)
	// The tab keeps its own reference to the blob once navigated; revoke later to free memory.
	setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000)
	if (NATIVE_VIEWABLE.test(relPath)) {
		const frag = at.page ? `#page=${at.page}` : at.startSec ? `#t=${at.startSec}` : ''
		await chrome.tabs.create({ url: url + frag })
		return 'opened'
	}
	const a = document.createElement('a')
	a.href = url
	a.download = relPath.split('/').pop() ?? 'file'
	a.click()
	return 'downloaded'
}
