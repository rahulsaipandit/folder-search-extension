/**
 * PDF extraction in the offscreen document (design §5.3): per-page text layer plus a canvas render
 * of each page, so scans, charts and slides are findable through the vision encoder without OCR.
 * The pdf.js worker is bundled locally (same-origin) because `worker-src 'self'` forbids a CDN.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { MODEL_IMAGE_EDGE, rawImageFromCanvas, thumbnailFromCanvas } from './media'
import { joinPdfItems } from './pure'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Pages indexed immediately; the rest follow in the background (design §5.3). */
export const PDF_FIRST_PAGES = 30
/** Hard cap on pages per PDF. */
export const PDF_MAX_PAGES = 5000

export interface PdfSession {
	numPages: number
	pageText(page: number): Promise<string>
	renderPage(page: number): Promise<{ raw: ReturnType<typeof rawImageFromCanvas>; thumbnail: Blob }>
	destroy(): Promise<void>
}

export async function openPdf(file: File): Promise<PdfSession> {
	const data = new Uint8Array(await file.arrayBuffer())
	const doc = await pdfjs.getDocument({ data }).promise
	return {
		numPages: doc.numPages,
		async pageText(n) {
			const page = await doc.getPage(n)
			try {
				const content = await page.getTextContent()
				return joinPdfItems(content.items as { str: string; hasEOL?: boolean; transform?: number[] }[])
			} finally {
				page.cleanup()
			}
		},
		async renderPage(n) {
			const page = await doc.getPage(n)
			try {
				const base = page.getViewport({ scale: 1 })
				const scale = MODEL_IMAGE_EDGE / Math.max(base.width, base.height)
				const viewport = page.getViewport({ scale })
				const canvas = document.createElement('canvas')
				canvas.width = Math.ceil(viewport.width)
				canvas.height = Math.ceil(viewport.height)
				const ctx = canvas.getContext('2d', { willReadFrequently: true })
				if (!ctx) throw new Error('2D canvas is unavailable')
				ctx.fillStyle = '#fff'
				ctx.fillRect(0, 0, canvas.width, canvas.height)
				await page.render({ canvasContext: ctx, canvas, viewport }).promise
				return { raw: rawImageFromCanvas(canvas), thumbnail: await thumbnailFromCanvas(canvas) }
			} finally {
				page.cleanup()
			}
		},
		destroy: () => doc.destroy(),
	}
}
