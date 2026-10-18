import type { EnabledKinds, FileKind, SizeCaps, SkipReason } from './types'

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'])
/** HEIC/HEIF are best-effort: Chrome cannot decode them, so they fail per-file with a clear error. */
const IMAGE_BEST_EFFORT_EXT = new Set(['heic', 'heif'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'opus'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
/** Documents whose text we can extract. */
const DOC_EXT = new Set([
	'pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'rtf', 'log',
	'yaml', 'yml', 'toml', 'ini', 'tex',
])
/** Source code is excluded from the main index (design §1.1): opt-in separate index later. */
const CODE_EXT = new Set([
	'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs',
	'php', 'swift', 'sh', 'ps1', 'bat', 'sql', 'css', 'scss', 'vue', 'svelte',
])
/** Known-but-unsupported formats; reported as `unsupported` rather than silently ignored. */
const UNSUPPORTED_DOC_EXT = new Set([
	'doc', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key',
])

const JUNK_NAMES = new Set(['thumbs.db', '.ds_store', 'desktop.ini', 'ehthumbs.db', '.localized'])
const SKIP_DIR_NAMES = new Set([
	'node_modules', '__pycache__', '$recycle.bin', 'system volume information',
])

/** Obvious secrets (design §9). Matched case-insensitively on the file name. */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
	/^\.env(\..*)?$/,
	/\.pem$/,
	/\.key$/,
	/\.p12$/,
	/\.pfx$/,
	/\.kdbx?$/,
	/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
	/^\.?(netrc|npmrc|pgpass)$/,
	/^credentials(\.json)?$/,
	/^secrets?\.(json|ya?ml|txt)$/,
	/passwords?\.(txt|csv|json|xlsx?)$/,
]
/** Unambiguous secret / browser-profile directories. Ordinary names like "Default" are not blocked. */
const SENSITIVE_DIR_NAMES = new Set([
	'.ssh', '.gnupg', '.aws', '.azure', '.kube', 'user data', 'code cache', 'gpucache', 'indexeddb',
	'local storage',
])

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function classifyFile(name: string, mime = ''): FileKind {
	const ext = extensionOf(name)
	if (IMAGE_EXT.has(ext) || IMAGE_BEST_EFFORT_EXT.has(ext)) return 'image'
	if (AUDIO_EXT.has(ext)) return 'audio'
	if (VIDEO_EXT.has(ext)) return 'video'
	if (DOC_EXT.has(ext)) return 'document'
	if (!ext) {
		if (mime.startsWith('image/')) return 'image'
		if (mime.startsWith('audio/')) return 'audio'
		if (mime.startsWith('video/')) return 'video'
		if (mime.startsWith('text/')) return 'document'
	}
	return 'other'
}

export function isCodeFile(name: string): boolean {
	return CODE_EXT.has(extensionOf(name))
}

export function isUnsupportedDocument(name: string): boolean {
	return UNSUPPORTED_DOC_EXT.has(extensionOf(name))
}

function escapeRegex(s: string): string {
	return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive glob with `*` wildcards, anchored to the full name. */
export function globMatches(pattern: string, name: string): boolean {
	const p = pattern.trim().toLowerCase()
	if (!p) return false
	const re = new RegExp(`^${p.split('*').map(escapeRegex).join('.*')}$`)
	return re.test(name.toLowerCase())
}

/** Returns a reason when a directory must not be descended into. */
export function directorySkipReason(name: string, excludes: string[]): SkipReason | null {
	const lower = name.toLowerCase()
	if (name.startsWith('.')) return 'hidden'
	if (SKIP_DIR_NAMES.has(lower)) return 'junk'
	if (SENSITIVE_DIR_NAMES.has(lower)) return 'sensitive'
	if (excludes.some(p => globMatches(p, name))) return 'excluded'
	return null
}

export interface FileSkipInput {
	name: string
	size: number
	kind: FileKind
}

/** Returns a reason when a file must not be embedded, or null when it should be indexed. */
export function fileSkipReason(
	input: FileSkipInput,
	caps: SizeCaps,
	excludes: string[],
	enabledKinds: EnabledKinds
): SkipReason | null {
	const { name, size, kind } = input
	const lower = name.toLowerCase()
	if (JUNK_NAMES.has(lower)) return 'junk'
	const sensitive = SENSITIVE_FILE_PATTERNS.some(re => re.test(lower))
	if (sensitive) return 'sensitive'
	if (name.startsWith('.')) return 'hidden'
	if (excludes.some(p => globMatches(p, name))) return 'excluded'
	if (kind === 'other' || isUnsupportedDocument(name) || isCodeFile(name)) return 'unsupported'
	if (kind === 'document' && !enabledKinds.documents) return 'kind-disabled'
	if (kind === 'image' && !enabledKinds.images) return 'kind-disabled'
	if (kind === 'audio' && !enabledKinds.audio) return 'kind-disabled'
	if (kind === 'video' && !enabledKinds.video) return 'kind-disabled'
	if (size === 0) return 'empty'
	const cap =
		kind === 'document' ? caps.documentBytes : kind === 'image' ? caps.imageBytes : caps.mediaBytes
	if (size > cap) return 'too-large'
	return null
}

export const DEFAULT_CAPS: SizeCaps = {
	documentBytes: 100 * 1024 * 1024,
	imageBytes: 50 * 1024 * 1024,
	mediaBytes: 500 * 1024 * 1024,
}

export const DEFAULT_KINDS: EnabledKinds = {
	documents: true,
	images: true,
	audio: false,
	video: false,
}

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
	hidden: 'Hidden file or folder',
	junk: 'System or cache file',
	sensitive: 'Looks like a secret or credential',
	excluded: 'Matches an exclude pattern',
	'too-large': 'Larger than the size cap',
	unsupported: 'Unsupported format',
	'kind-disabled': 'This file type is turned off',
	empty: 'Empty file',
}

/**
 * Detects folders that are too broad to index sensibly (design §4A.2 Screen 4): a drive root, a
 * home directory, or a huge file count.
 */
export function broadFolderWarning(folderName: string, totalFiles: number): string | null {
	const n = folderName.trim().toLowerCase()
	const looksLikeRoot =
		/^[a-z]:\\?$/.test(n) || ['home', 'users', 'documents and settings'].includes(n)
	if (looksLikeRoot) {
		return 'This looks like a drive root or home folder. Choosing a narrower folder is faster and more precise.'
	}
	if (totalFiles > 100_000) {
		return `This folder has over ${Math.floor(totalFiles / 1000)}k files. Indexing will take a long time; consider a narrower folder or indexing one file type.`
	}
	return null
}
