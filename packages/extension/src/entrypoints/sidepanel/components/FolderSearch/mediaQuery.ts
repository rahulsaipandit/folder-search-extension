/** UI-side preparation of image / audio queries. No ML here: the offscreen document embeds them. */

export interface MediaQuery {
	kind: 'image' | 'audio'
	/** Base64 payload (chrome.runtime messages are JSON). */
	data: string
	mime: string
	/** Shown in the search box instead of text. */
	label: string
	/** Object URL of a thumbnail, for image queries. */
	preview?: string
}

/** Longest edge sent to the model; matches the indexer's input size, so bigger photos are wasted bytes. */
const MAX_EDGE = 768
/** Recordings are cut here: the audio encoder embeds one 30 s window per query. */
export const MAX_RECORD_SEC = 30

function toBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader()
		r.onerror = () => reject(r.error ?? new Error('Could not read the file'))
		r.onload = () => resolve(typeof r.result === 'string' ? (r.result.split(',')[1] ?? '') : '')
		r.readAsDataURL(blob)
	})
}

/** Downscales to a JPEG before sending, so a 12 MP photo does not cross the message channel. */
export async function imageQuery(blob: Blob, label: string): Promise<MediaQuery> {
	const bitmap = await createImageBitmap(blob)
	try {
		const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
		const canvas = document.createElement('canvas')
		canvas.width = Math.max(1, Math.round(bitmap.width * scale))
		canvas.height = Math.max(1, Math.round(bitmap.height * scale))
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('Canvas is unavailable')
		ctx.fillStyle = '#fff'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
		const jpeg = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.85)
		)
		return { kind: 'image', data: await toBase64(jpeg), mime: 'image/jpeg', label, preview: URL.createObjectURL(jpeg) }
	} finally {
		bitmap.close()
	}
}

export async function audioQuery(blob: Blob, label: string): Promise<MediaQuery> {
	return { kind: 'audio', data: await toBase64(blob), mime: blob.type || 'audio/webm', label }
}

/** True when the browser refused (or could not show the prompt for) camera / microphone access. */
export function isMediaBlocked(e: unknown): boolean {
	const name = e instanceof DOMException ? e.name : ''
	return name === 'NotAllowedError' || name === 'SecurityError'
}

/**
 * Side panels usually cannot show the permission prompt, so the grant is requested from a normal tab
 * (`entrypoints/media-permission`). It is stored for the extension origin, which covers the panel too.
 */
export function openMediaPermissionTab(device: 'microphone' | 'camera'): void {
	const kind = device === 'camera' ? 'video' : 'audio'
	void chrome.tabs.create({ url: chrome.runtime.getURL(`media-permission.html?kind=${kind}`) })
}

/** `getUserMedia` failures explained in terms of what the user can do next. */
export function mediaErrorText(e: unknown, device: 'microphone' | 'camera'): string {
	const name = e instanceof DOMException ? e.name : ''
	const Device = device === 'camera' ? 'Camera' : 'Microphone'
	if (isMediaBlocked(e)) return `${Device} access is needed. A tab opened to ask for it: choose Allow there, then come back and try again.`
	if (name === 'NotFoundError') return `No ${device} was found on this device.`
	if (name === 'NotReadableError') return `Your ${device} is busy. Close other apps using it and try again.`
	return `Could not use the ${device}: ${e instanceof Error ? e.message : String(e)}`
}
