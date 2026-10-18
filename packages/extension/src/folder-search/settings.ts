import { getMeta, setMeta } from './db'
import { type IndexSignature, INDEX_SCHEMA_VERSION, type ModelSelection } from './types'

/** Matryoshka size (design §3.2). Recorded in the index signature; changing it re-indexes. */
export const DEFAULT_DIM = 256
export const TEXT_MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX'

export type SetupStep = 'welcome' | 'model' | 'folder' | 'index' | 'ready'

export interface FolderSearchSettings {
	selection: ModelSelection
	dim: 128 | 256 | 512 | 768
	setupStep: SetupStep
	activeFolderId: string | null
	/** True once the user explicitly approved the model download (design §2.2a). */
	modelConsent: boolean
	/**
	 * The user explicitly approved the fp16 CPU fallback because WebGPU does not work here
	 * (design §14.5). Never set implicitly; without it, WebGPU is required.
	 */
	cpuFallbackApproved: boolean
}

export const DEFAULT_SETTINGS: FolderSearchSettings = {
	selection: { text: true, vision: true, audio: false, dtype: 'q4' },
	dim: DEFAULT_DIM,
	setupStep: 'welcome',
	activeFolderId: null,
	modelConsent: false,
	cpuFallbackApproved: false,
}

const KEY = 'settings'

export async function loadFolderSearchSettings(): Promise<FolderSearchSettings> {
	const saved = await getMeta<Partial<FolderSearchSettings>>(KEY)
	return {
		...DEFAULT_SETTINGS,
		...saved,
		selection: { ...DEFAULT_SETTINGS.selection, ...saved?.selection, text: true },
	}
}

export async function saveFolderSearchSettings(patch: Partial<FolderSearchSettings>): Promise<FolderSearchSettings> {
	const next = { ...(await loadFolderSearchSettings()), ...patch }
	await setMeta(KEY, next)
	return next
}

export function signatureFor(settings: FolderSearchSettings): IndexSignature {
	return {
		textModel: TEXT_MODEL_ID,
		visionModel: settings.selection.vision ? TEXT_MODEL_ID : null,
		dtype: settings.selection.dtype,
		dim: settings.dim,
		schema: INDEX_SCHEMA_VERSION,
	}
}

export type SignatureCheck = 'none' | 'match' | 'mismatch'

/**
 * Enabling the vision encoder later adds data but does not invalidate existing vectors, so only
 * changes to dtype, dim, schema or the model id force a re-index (design §3.4, §11).
 */
export function compareSignatures(stored: IndexSignature | undefined, current: IndexSignature): SignatureCheck {
	if (!stored) return 'none'
	return stored.textModel === current.textModel &&
		stored.dtype === current.dtype &&
		stored.dim === current.dim &&
		stored.schema === current.schema
		? 'match'
		: 'mismatch'
}

export async function getStoredSignature(folderId: string): Promise<IndexSignature | undefined> {
	return getMeta<IndexSignature>(`signature:${folderId}`)
}
export async function storeSignature(folderId: string, sig: IndexSignature): Promise<void> {
	await setMeta(`signature:${folderId}`, sig)
}
