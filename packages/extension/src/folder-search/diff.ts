import type { IndexState } from './types'

export interface ScannedFile {
	relPath: string
	size: number
	mtime: number
}

export interface KnownFile extends ScannedFile {
	indexState: IndexState
}

export interface ScanDiff {
	added: ScannedFile[]
	changed: ScannedFile[]
	/** Unchanged files that still owe work (`pending`, or `error` when retrying). */
	resume: ScannedFile[]
	unchanged: ScannedFile[]
	deleted: string[]
}

/**
 * Compares a fresh walk against the stored inventory (design §4.2). A file is "changed" when its
 * `(size, mtime)` pair differs. Skipped files are re-evaluated only when changed, since their skip
 * reason is a function of name/size which are already part of the key.
 */
export function diffScan(
	known: Map<string, KnownFile>,
	scanned: ScannedFile[],
	opts: { retryErrors?: boolean } = {}
): ScanDiff {
	const diff: ScanDiff = { added: [], changed: [], resume: [], unchanged: [], deleted: [] }
	const seen = new Set<string>()
	for (const f of scanned) {
		seen.add(f.relPath)
		const prev = known.get(f.relPath)
		if (!prev) {
			diff.added.push(f)
		} else if (prev.size !== f.size || prev.mtime !== f.mtime) {
			diff.changed.push(f)
		} else if (prev.indexState === 'pending' || (opts.retryErrors && prev.indexState === 'error')) {
			diff.resume.push(f)
		} else {
			diff.unchanged.push(f)
		}
	}
	for (const relPath of known.keys()) if (!seen.has(relPath)) diff.deleted.push(relPath)
	return diff
}
