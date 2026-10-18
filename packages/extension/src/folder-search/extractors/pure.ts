/** Dependency-free text helpers shared by the extractors (unit-testable in Node). */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e.startsWith('#')) {
			const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
		}
		return ENTITIES[e.toLowerCase()] ?? m
	})
}

/** Removes tags and scripts/styles; used for XML and as the HTML fallback. */
export function stripTags(markup: string): string {
	return decodeEntities(
		markup
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
	)
		.replace(/[ \t]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/** Text of a WordprocessingML `word/document.xml`: one paragraph per `<w:p>`. */
export function docxXmlToText(xml: string): string {
	const paragraphs: string[] = []
	for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
		let line = ''
		for (const m of p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
			line += m[1] !== undefined ? decodeEntities(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n'
		}
		if (line.trim()) paragraphs.push(line.trim())
	}
	return paragraphs.join('\n\n')
}

/** Best-effort RTF to text: drops control words, groups holding binary/font tables, and escapes. */
export function stripRtf(rtf: string): string {
	return decodeRtfEscapes(
		rtf
			.replace(/\{\\\*[^{}]*\}/g, '')
			.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\}?/g, '')
			.replace(/\\par[d]?\b/g, '\n')
	)
		.replace(/\\[a-z]+-?\d* ?/gi, '')
		.replace(/[{}]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

function decodeRtfEscapes(s: string): string {
	return s
		.replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
		.replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
		.replace(/\\([\\{}])/g, '$1')
}

export interface PdfTextItem {
	str: string
	hasEOL?: boolean
	transform?: number[]
}

/**
 * Joins pdf.js text items into reading-order lines. Items on a new baseline, or flagged `hasEOL`,
 * start a new line; paragraphs are separated where the vertical gap exceeds ~1.6 line heights.
 */
export function joinPdfItems(items: PdfTextItem[]): string {
	let out = ''
	let lastY: number | null = null
	let lastHeight = 0
	for (const it of items) {
		if (!it.str && !it.hasEOL) continue
		const y = it.transform?.[5] ?? null
		const h = Math.abs(it.transform?.[3] ?? 0) || 10
		if (out && lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
			out += Math.abs(y - lastY) > lastHeight * 1.6 ? '\n\n' : '\n'
		} else if (out && !out.endsWith('\n') && !out.endsWith(' ') && !it.str.startsWith(' ')) {
			out += ' '
		}
		out += it.str
		if (it.hasEOL && !out.endsWith('\n')) out += '\n'
		if (y !== null) lastY = y
		lastHeight = h
	}
	return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Cheap content fingerprint for duplicate detection: size plus three sampled 4 KiB slices. */
export async function fingerprint(file: Blob): Promise<string> {
	const SAMPLE = 4096
	const offsets = [0, Math.max(0, Math.floor(file.size / 2) - SAMPLE / 2), Math.max(0, file.size - SAMPLE)]
	const parts: ArrayBuffer[] = []
	for (const o of [...new Set(offsets)]) parts.push(await file.slice(o, o + SAMPLE).arrayBuffer())
	const total = parts.reduce((n, p) => n + p.byteLength, 0)
	const buf = new Uint8Array(total)
	let at = 0
	for (const p of parts) {
		buf.set(new Uint8Array(p), at)
		at += p.byteLength
	}
	const digest = await crypto.subtle.digest('SHA-256', buf)
	const hex = [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
	return `${file.size}-${hex}`
}
