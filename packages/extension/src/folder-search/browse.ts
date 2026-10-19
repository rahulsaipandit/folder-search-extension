import type { FileRecord, SearchKindFilter } from './types'

export type BrowseSortKey = 'name' | 'folder' | 'type' | 'size' | 'mtime'
export interface BrowseSort {
	key: BrowseSortKey
	dir: 'asc' | 'desc'
}

/**
 * Identity of a list of files by content (which files, which version), ignoring the array object. The
 * index hands the UI a new array on every progress event; anything keyed on this key stays put until a
 * file is added, removed or changed. Details learned later (duration, waveform) deliberately do not count.
 */
export function filesKey(files: FileRecord[]): string {
	return files.map(f => `${f.fileId}:${f.mtime}:${f.size}`).join('|')
}

export function fileName(relPath: string): string {
	return relPath.slice(relPath.lastIndexOf('/') + 1)
}

export function fileDir(relPath: string): string {
	const i = relPath.lastIndexOf('/')
	return i < 0 ? '' : relPath.slice(0, i)
}

/** Upper-case extension without the dot, or '' when there is none ("README", ".gitignore"). */
export function fileExt(relPath: string): string {
	const name = fileName(relPath)
	const i = name.lastIndexOf('.')
	return i <= 0 ? '' : name.slice(i + 1).toUpperCase()
}

const KINDS_FOR: Record<SearchKindFilter, FileRecord['kind'][]> = {
	all: ['image', 'document', 'audio', 'video'],
	images: ['image'],
	documents: ['document'],
	'audio-video': ['audio', 'video'],
}

/** Indexed files that belong under a filter chip, for the empty-query browse view. */
export function browsableFiles(files: FileRecord[], filter: SearchKindFilter): FileRecord[] {
	const kinds = KINDS_FOR[filter]
	return files.filter(f => f.indexState === 'indexed' && kinds.includes(f.kind))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(a: FileRecord, b: FileRecord, key: BrowseSortKey): number {
	switch (key) {
		case 'name':
			return collator.compare(fileName(a.relPath), fileName(b.relPath))
		case 'folder':
			return collator.compare(fileDir(a.relPath), fileDir(b.relPath))
		case 'type':
			return collator.compare(fileExt(a.relPath), fileExt(b.relPath))
		case 'size':
			return a.size - b.size
		case 'mtime':
			return a.mtime - b.mtime
	}
}

/** Stable sort with the file name as tie-breaker, so equal keys never shuffle between renders. */
export function sortFiles(files: FileRecord[], { key, dir }: BrowseSort): FileRecord[] {
	const sign = dir === 'asc' ? 1 : -1
	return [...files].sort(
		(a, b) => sign * compare(a, b, key) || collator.compare(a.relPath, b.relPath)
	)
}
