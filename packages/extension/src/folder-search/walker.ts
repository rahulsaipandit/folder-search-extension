import { classifyFile, directorySkipReason, fileSkipReason } from './classify'
import type { EnabledKinds, FileKind, SizeCaps, SkipReason } from './types'

/** Minimal structural view of File System Access handles, so the walker is testable with fakes. */
export interface FsFileHandle {
	kind: 'file'
	name: string
	getFile(): Promise<{ size: number; lastModified: number; type: string; name: string }>
}
export interface FsDirHandle {
	kind: 'directory'
	name: string
	values(): AsyncIterable<FsFileHandle | FsDirHandle>
}

export interface WalkOptions {
	excludes: string[]
	caps: SizeCaps
	kinds: EnabledKinds
	/** Guards against symlink/junction cycles, which the API does not expose. */
	maxDepth?: number
	signal?: AbortSignal
}

export type WalkEvent =
	| {
			type: 'file'
			relPath: string
			name: string
			size: number
			mtime: number
			mime: string
			kind: FileKind
			skip: SkipReason | null
			handle: FsFileHandle
	  }
	| { type: 'skipped-dir'; relPath: string; reason: SkipReason }
	| { type: 'error'; relPath: string; message: string }

const DEFAULT_MAX_DEPTH = 32

/**
 * Depth-first walk of a directory handle. Unreadable entries produce `error` events and the walk
 * continues: one bad folder must not abort the run (design §9).
 */
export async function* walk(
	root: FsDirHandle,
	opts: WalkOptions,
	prefix = '',
	depth = 0
): AsyncGenerator<WalkEvent> {
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
	let entries: (FsFileHandle | FsDirHandle)[] = []
	try {
		for await (const e of root.values()) entries.push(e)
	} catch (e) {
		yield { type: 'error', relPath: prefix || root.name, message: errMessage(e) }
		return
	}
	// Stable order makes progress and resume behaviour predictable.
	entries = entries.sort((a, b) => a.name.localeCompare(b.name))

	for (const entry of entries) {
		if (opts.signal?.aborted) return
		const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.kind === 'directory') {
			const reason = directorySkipReason(entry.name, opts.excludes)
			if (reason) {
				yield { type: 'skipped-dir', relPath, reason }
			} else if (depth + 1 > maxDepth) {
				yield { type: 'error', relPath, message: `Folder nesting deeper than ${maxDepth} levels (possible link loop)` }
			} else {
				yield* walk(entry, opts, relPath, depth + 1)
			}
			continue
		}
		try {
			const file = await entry.getFile()
			const kind = classifyFile(entry.name, file.type)
			yield {
				type: 'file',
				relPath,
				name: entry.name,
				size: file.size,
				mtime: file.lastModified,
				mime: file.type,
				kind,
				skip: fileSkipReason({ name: entry.name, size: file.size, kind }, opts.caps, opts.excludes, opts.kinds),
				handle: entry,
			}
		} catch (e) {
			yield { type: 'error', relPath, message: errMessage(e) }
		}
	}
}

function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

/** Resolves a stored relative path back to a `File` from the folder's root handle. */
export async function resolveFile(root: FsDirHandle & { getDirectoryHandle?: unknown }, relPath: string): Promise<File> {
	const parts = relPath.split('/')
	let dir = root as unknown as FileSystemDirectoryHandle
	for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
	return (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()
}
