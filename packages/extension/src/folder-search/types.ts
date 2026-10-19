/** Shared types for Local Folder Search. See docs/designLocalFolderSearch.md. */

export type FileKind = 'image' | 'document' | 'audio' | 'video' | 'other'

export type IndexState = 'pending' | 'indexed' | 'skipped' | 'error'

/** Why a file was not embedded. Always surfaced in the UI (design §2.4). */
export type SkipReason =
	| 'hidden'
	| 'junk'
	| 'sensitive'
	| 'excluded'
	| 'too-large'
	| 'unsupported'
	| 'kind-disabled'
	| 'empty'

/** `fp16` is only used by the approval-gated CPU fallback; q4/q8 do not run on the WASM backend. */
export type ModelDtype = 'q4' | 'q8' | 'fp16'

/** Which encoders are enabled. Text is always required (queries need it). */
export interface ModelSelection {
	text: true
	vision: boolean
	audio: boolean
	dtype: ModelDtype
}

export interface SizeCaps {
	documentBytes: number
	imageBytes: number
	mediaBytes: number
}

export interface EnabledKinds {
	documents: boolean
	images: boolean
	audio: boolean
	video: boolean
}

export interface FolderRecord {
	folderId: string
	name: string
	handle: FileSystemDirectoryHandle
	createdAt: number
	lastIndexedAt: number | null
	status: 'idle' | 'indexing' | 'paused' | 'error'
	excludes: string[]
	caps: SizeCaps
	/** Which kinds the user wants indexed (design §11 "images only / documents only"). */
	kinds: EnabledKinds
}

export interface FileRecord {
	/** `${folderId}:${relPath}` */
	fileId: string
	folderId: string
	relPath: string
	size: number
	mtime: number
	kind: FileKind
	mime: string
	indexState: IndexState
	skipReason?: SkipReason
	error?: string
	/** Non-fatal remark shown under Details (e.g. truncated, or no extractable text). */
	note?: string
	/** Content fingerprint (size + sampled bytes) used for duplicate detection. */
	contentHash?: string
	/** If set, this file is a byte-identical duplicate of `duplicateOf` and carries no vectors. */
	duplicateOf?: string
	/** Pages / frames / windows actually indexed. */
	units?: number
	/** PDFs: total pages and how many are indexed so far (first pages first, rest in background). */
	pagesTotal?: number
	pagesDone?: number
	/** Audio and video length in seconds. Files indexed before this field existed get it on first display. */
	duration?: number
	/** Video pixel size (images keep theirs in `imageVectors`), so the wall can lay tiles out without decoding. */
	width?: number
	height?: number
	/** Audio only: peak levels 0..1 (see `waveform.ts`) for the wall's waveform card. */
	waveform?: number[]
}

export interface ChunkRecord {
	/** `${fileId}#${chunkIdx}` */
	chunkId: string
	fileId: string
	folderId: string
	chunkIdx: number
	text: string
	/** 1-based page for PDFs, else undefined. */
	page?: number
	/** Character offset of the chunk in the extracted text. */
	offset: number
	/** `text` = text chunk, `page-image` = rendered PDF page through the vision encoder. */
	source: 'text' | 'page-image'
	embedding: Float32Array
	/** Small JPEG of the PDF page for result cards (page-image chunks only). */
	thumbnail?: Blob
}

export interface ImageVectorRecord {
	fileId: string
	folderId: string
	embedding: Float32Array
	width: number
	height: number
	thumbnail: Blob
}

/** One audio window or video frame, embedded in the same space. */
export interface MediaUnitRecord {
	unitId: string
	fileId: string
	folderId: string
	unitIdx: number
	kind: 'audio' | 'video'
	startSec: number
	endSec: number
	embedding: Float32Array
	thumbnail?: Blob
}

export interface PostingRecord {
	/** `${folderId}\u0000${term}` */
	key: string
	folderId: string
	term: string
	/** chunkId → term frequency. */
	postings: Record<string, number>
}

export interface MetaRecord {
	key: string
	value: unknown
}

/** Written to `meta`; a mismatch invalidates the index (design §3.4, §11). */
export interface IndexSignature {
	textModel: string
	visionModel: string | null
	dtype: ModelDtype
	dim: number
	schema: number
}

export const INDEX_SCHEMA_VERSION = 1

export type MediaKindKey = 'image' | 'document' | 'audio' | 'video'

export interface IndexProgress {
	folderId: string
	phase: 'idle' | 'scanning' | 'indexing' | 'paused' | 'done' | 'error' | 'cancelled'
	total: number
	done: number
	byKind: Record<MediaKindKey, { total: number; done: number }>
	currentFile: string | null
	skipped: number
	errors: number
	startedAt: number | null
	/** Rough ETA in seconds, null until enough samples exist. */
	etaSec: number | null
	message?: string
}

export interface ScanSummary {
	folderName: string
	counts: Record<FileKind, { files: number; bytes: number }>
	skipped: { relPath: string; reason: SkipReason }[]
	skippedCount: number
	totalFiles: number
	broadFolderWarning: string | null
	estimatedSeconds: number | null
}

export interface MediaHit {
	folderId: string
	fileId: string
	relPath: string
	kind: 'image' | 'video' | 'audio'
	/** Raw cosine similarity. */
	score: number
	/** Score after per-modality calibration, comparable across sections. */
	calibrated: number
	width?: number
	height?: number
	/** Seconds into the media, for audio/video. */
	startSec?: number
	/** Other files with identical bytes. */
	duplicates?: string[]
}

export interface DocumentHit {
	folderId: string
	fileId: string
	relPath: string
	score: number
	calibrated: number
	snippet: string
	/** Full text of the best-matching chunk (capped), used as context by Ask mode. */
	excerpt: string
	page?: number
	/** Exact-string terms that matched, for highlighting. */
	matchedTerms: string[]
	matchedChunks: number
	hasPageThumbnail: boolean
}

export interface SearchResponse {
	query: string
	media: MediaHit[]
	documents: DocumentHit[]
	/** Which section holds the strongest calibrated hit. */
	leading: 'media' | 'documents'
	/** True when the query looks like an exact identifier (keyword hits lead). */
	exactStyle: boolean
	partialIndex: boolean
	tookMs: number
}

export type SearchKindFilter = 'all' | 'images' | 'documents' | 'audio-video'

export interface SearchOptions {
	folderId: string
	kinds?: SearchKindFilter
	subfolder?: string
	k?: number
}

/** Result of a text/image preview request for the UI. */
export interface PreviewPayload {
	text?: string
	page?: number
}
