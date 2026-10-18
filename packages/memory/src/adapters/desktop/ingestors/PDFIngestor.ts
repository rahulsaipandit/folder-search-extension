import type { ISourceIngestor, IngestorInput, IngestorOutput } from './types'

/**
 * PDFIngestor - extracts text from PDF files.
 *
 * Strategy (pure JavaScript, no native binaries):
 *   1. Detect PDF by checking first 4 bytes for `%PDF` magic header.
 *   2. Try `pdfjs-dist` if available (dynamic import, graceful fallback).
 *   3. Fallback: scan raw PDF byte stream for BT...ET text objects.
 */
export class PDFIngestor implements ISourceIngestor {
	canHandle(input: IngestorInput): boolean {
		if (input.type === 'pdf') return true
		if (input.type === 'file') {
			const lower = input.source.toLowerCase()
			return lower.endsWith('.pdf')
		}
		return false
	}

	async ingest(input: IngestorInput): Promise<IngestorOutput> {
		const filePath = input.source
		const buffer = await this.readFileBuffer(filePath)

		// Validate PDF magic bytes: %PDF
		if (!isPDF(buffer)) {
			throw new Error(
				`[PDFIngestor] File "${filePath}" does not appear to be a valid PDF (%PDF magic not found)`
			)
		}

		let result: { text: string; pageCount: number }
		try {
			result = await this.extractWithPdfJs(buffer)
		} catch {
			// pdfjs-dist not available or failed - use raw byte-stream extraction
			result = extractTextFromPdfBytes(buffer)
		}

		const title = input.metadata?.title ?? fileNameToTitle(filePath)
		const content = result.text.trim()
		const wordCount = countWords(content)

		return {
			content:
				content.length > 0
					? content
					: `[PDF: ${title} - no extractable text found (${result.pageCount} pages)]`,
			title,
			wordCount,
			sourceType: 'pdf',
			extractedAt: new Date().toISOString(),
		}
	}

	// ── File reading ──────────────────────────────────────────────────────────

	private async readFileBuffer(filePath: string): Promise<Uint8Array> {
		// Dynamic import for browser tree-shaking
		const { readFile } = await import('node:fs/promises')
		const buffer = await readFile(filePath)
		return new Uint8Array(buffer)
	}

	// ── pdfjs-dist extraction ─────────────────────────────────────────────────

	private async extractWithPdfJs(buffer: Uint8Array): Promise<{ text: string; pageCount: number }> {
		// Dynamic import via Function constructor - avoids TypeScript module resolution
		// while still being tree-shakeable. Throws if pdfjs-dist is not installed.
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const pdfjsLib = (await new Function('spec', 'return import(spec)')('pdfjs-dist')) as {
			getDocument(params: { data: Uint8Array }): {
				promise: Promise<{
					numPages: number
					getPage(n: number): Promise<{
						getTextContent(): Promise<{ items: { str?: string }[] }>
					}>
				}>
			}
		}

		const loadingTask = pdfjsLib.getDocument({ data: buffer })
		const pdf = await loadingTask.promise
		const pageCount = pdf.numPages

		const textParts: string[] = []
		for (let i = 1; i <= pageCount; i++) {
			const page = await pdf.getPage(i)
			const textContent = await page.getTextContent()
			const pageText = textContent.items
				.map((item: unknown) => {
					const typed = item as { str?: string }
					return typed.str ?? ''
				})
				.join(' ')
			if (pageText.trim().length > 0) {
				textParts.push(`--- Page ${i} ---\n${pageText}`)
			}
		}

		return { text: textParts.join('\n\n'), pageCount }
	}
}

// ── Raw PDF byte-stream text extraction ───────────────────────────────────────

/**
 * Extract text from a PDF byte stream by scanning for BT...ET text objects.
 *
 * PDF text rendering operators:
 *   BT       - Begin Text object
 *   ET       - End Text object
 *   Tj / TJ  - Show text string
 *   '        - Move to next line and show text
 *
 * This is a best-effort approach; it handles simple PDFs but will miss
 * compressed/encrypted content streams.
 */
function extractTextFromPdfBytes(buffer: Uint8Array): { text: string; pageCount: number } {
	// Convert to latin-1 string for regex scanning (binary-safe)
	let pdfStr = ''
	for (const byte of buffer) {
		pdfStr += String.fromCharCode(byte)
	}

	// Count pages
	const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g)
	const pageCount = pageMatches ? pageMatches.length : 0

	const textParts: string[] = []

	// Extract BT...ET blocks
	const btEtRegex = /BT([\s\S]*?)ET/g
	let match: RegExpExecArray | null
	while ((match = btEtRegex.exec(pdfStr)) !== null) {
		const block = match[1]!
		const blockText = extractTextFromBlock(block)
		if (blockText.trim().length > 0) {
			textParts.push(blockText)
		}
	}

	// Also try to extract raw string literals outside BT/ET (some PDFs have plain text)
	if (textParts.length === 0) {
		const stringRegex = /\(([^)\\]|\\.)*\)/g
		const strings: string[] = []
		while ((match = stringRegex.exec(pdfStr)) !== null) {
			const decoded = decodePdfString(match[0]!)
			if (decoded.length > 3 && /[a-zA-Z]/.test(decoded)) {
				strings.push(decoded)
			}
		}
		if (strings.length > 0) {
			textParts.push(strings.join(' '))
		}
	}

	return {
		text: textParts.join('\n'),
		pageCount,
	}
}

/**
 * Extract text from a single BT...ET block.
 * Handles Tj, TJ, ' operators.
 */
function extractTextFromBlock(block: string): string {
	const parts: string[] = []

	// TJ operator: [(string1) spacing (string2) ...] TJ
	const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g
	let m: RegExpExecArray | null
	while ((m = tjArrayRegex.exec(block)) !== null) {
		const arrayContent = m[1]!
		const stringRegex = /\(([^)\\]|\\.)*\)/g
		let sm: RegExpExecArray | null
		while ((sm = stringRegex.exec(arrayContent)) !== null) {
			parts.push(decodePdfString(sm[0]!))
		}
	}

	// Tj operator: (string) Tj
	const tjRegex = /\(([^)\\]|\\.)*\)\s*Tj/g
	while ((m = tjRegex.exec(block)) !== null) {
		const raw = m[0]!.replace(/\s*Tj$/, '')
		parts.push(decodePdfString(raw))
	}

	// ' operator: (string) '  (same as Td + Tj but starts new line)
	const apostropheRegex = /\(([^)\\]|\\.)*\)\s*'/g
	while ((m = apostropheRegex.exec(block)) !== null) {
		const raw = m[0]!.replace(/\s*'$/, '')
		parts.push('\n' + decodePdfString(raw))
	}

	return parts.join('')
}

/**
 * Decode a PDF literal string (parentheses-enclosed) to plain text.
 * Handles octal escapes (\ddd), common escape sequences, and strips parens.
 */
function decodePdfString(pdfString: string): string {
	// Strip outer parens
	let s = pdfString
	if (s.startsWith('(') && s.endsWith(')')) {
		s = s.slice(1, -1)
	}

	// Decode escape sequences
	return s.replace(/\\(\d{1,3}|.)/g, (_, escaped: string) => {
		if (/^\d+$/.test(escaped)) {
			// Octal
			return String.fromCharCode(parseInt(escaped, 8))
		}
		const escapes: Record<string, string> = {
			n: '\n',
			r: '\r',
			t: '\t',
			b: '\b',
			f: '\f',
			'\\': '\\',
			'(': '(',
			')': ')',
		}
		return escapes[escaped] ?? escaped
	})
}

/**
 * Check if a buffer starts with the PDF magic bytes `%PDF`.
 */
function isPDF(buffer: Uint8Array): boolean {
	if (buffer.length < 4) return false
	return (
		buffer[0] === 0x25 && // %
		buffer[1] === 0x50 && // P
		buffer[2] === 0x44 && // D
		buffer[3] === 0x46 // F
	)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileNameToTitle(filePath: string): string {
	const parts = filePath.replace(/\\/g, '/').split('/')
	const last = parts[parts.length - 1] ?? filePath
	return last.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}
