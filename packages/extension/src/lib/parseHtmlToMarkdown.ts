import { Defuddle } from 'defuddle-js'

export interface ParsedPage {
	markdown: string
	title: string
	author: string
	date: string
	url: string
}

/**
 * Parse raw HTML into structured page data.
 * Uses Defuddle (browser build) to extract the main article content.
 * Pure: no Chrome APIs, no DOM side effects beyond the DOMParser.
 */
export function parseHtmlToMarkdown(html: string, url?: string): ParsedPage {
	let article: any = null
	try {
		article = Defuddle.parse(html, { url: url ?? '' })
	} catch (err) {
		console.warn('[parseHtmlToMarkdown] Defuddle failed:', err)
	}

	return {
		markdown: (article?.contentMarkdown ?? article?.content ?? '') as string,
		title: (article?.title ?? '') as string,
		author: (article?.author ?? '') as string,
		date: (article?.datePublished ?? '') as string,
		url: url ?? '',
	}
}
