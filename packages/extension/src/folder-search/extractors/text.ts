import JSZip from 'jszip'

import { parseHtmlToMarkdown } from '@/lib/parseHtmlToMarkdown'

import { extensionOf } from '../classify'
import { docxXmlToText, stripRtf, stripTags } from './pure'

/** Extracted text beyond this is not embedded; huge logs/CSVs would otherwise stall the run. */
const MAX_TEXT_BYTES = 20 * 1024 * 1024
/** Refuse DOCX parts that decompress to more than this (zip-bomb guard, design §9). */
const MAX_DOCX_XML_BYTES = 100 * 1024 * 1024

async function readCapped(file: File): Promise<string> {
	return (file.size > MAX_TEXT_BYTES ? file.slice(0, MAX_TEXT_BYTES) : file).text()
}

async function extractDocx(file: File): Promise<string> {
	const zip = await JSZip.loadAsync(file)
	const entry = zip.file('word/document.xml')
	if (!entry) throw new Error('Not a valid DOCX: word/document.xml is missing')
	const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
	if (declared !== undefined && declared > MAX_DOCX_XML_BYTES) {
		throw new Error(`DOCX body expands to ${Math.round(declared / 1e6)} MB, over the safety limit`)
	}
	return docxXmlToText(await entry.async('string'))
}

/** Plain-text extraction for every non-PDF document type. Throws on unreadable files. */
export async function extractDocumentText(file: File): Promise<string> {
	const ext = extensionOf(file.name)
	switch (ext) {
		case 'docx':
			return extractDocx(file)
		case 'html':
		case 'htm': {
			const html = await readCapped(file)
			let md = ''
			try {
				md = parseHtmlToMarkdown(html).markdown
			} catch (e) {
				console.warn(`[folder-search] HTML article extraction failed for ${file.name}`, e)
			}
			return md.trim() ? md : stripTags(html)
		}
		case 'xml':
			return stripTags(await readCapped(file))
		case 'rtf':
			return stripRtf(await readCapped(file))
		default:
			return readCapped(file)
	}
}
