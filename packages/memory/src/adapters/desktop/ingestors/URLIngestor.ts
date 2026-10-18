import type { ISourceIngestor, IngestorInput, IngestorOutput } from './types'

/**
 * URLIngestor - fetches a URL and extracts readable plain text content.
 *
 * - Follows redirects (up to 3)
 * - Strips scripts, styles, nav, footer via regex
 * - Extracts title from <title> tag
 * - Converts HTML to plain text (no DOM parser required)
 */
export class URLIngestor implements ISourceIngestor {
	private static readonly MAX_REDIRECTS = 3
	private static readonly TIMEOUT_MS = 15_000

	canHandle(input: IngestorInput): boolean {
		if (input.type === 'url') return true
		if (input.type === 'text') {
			return /^https?:\/\//i.test(input.source.trim())
		}
		return false
	}

	async ingest(input: IngestorInput): Promise<IngestorOutput> {
		const url = input.source.trim()
		const html = await this.fetchWithRedirects(url, URLIngestor.MAX_REDIRECTS)

		const title = this.extractTitle(html) ?? input.metadata?.title ?? urlToTitle(url)
		const content = this.htmlToText(html)
		const wordCount = countWords(content)

		return {
			content,
			title,
			wordCount,
			sourceType: 'url',
			extractedAt: new Date().toISOString(),
		}
	}

	// ── Fetch ─────────────────────────────────────────────────────────────────

	private async fetchWithRedirects(url: string, maxRedirects: number): Promise<string> {
		let current = url
		let redirectsLeft = maxRedirects

		while (redirectsLeft >= 0) {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), URLIngestor.TIMEOUT_MS)

			let response: Response
			try {
				response = await fetch(current, {
					signal: controller.signal,
					redirect: 'manual', // Handle redirects manually
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; PageAgentBot/1.0)',
						Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					},
				})
			} catch (err) {
				throw new Error(`[URLIngestor] Fetch failed for "${current}": ${String(err)}`, {
					cause: err,
				})
			} finally {
				clearTimeout(timer)
			}

			// Follow redirects manually
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location')
				if (!location) throw new Error(`[URLIngestor] Redirect without Location header`)
				if (redirectsLeft === 0) throw new Error(`[URLIngestor] Too many redirects`)
				current = location.startsWith('http') ? location : new URL(location, current).href
				redirectsLeft--
				continue
			}

			if (!response.ok) {
				throw new Error(`[URLIngestor] HTTP ${response.status} for "${current}"`)
			}

			const contentType = response.headers.get('content-type') ?? ''
			if (
				!contentType.includes('html') &&
				!contentType.includes('text') &&
				!contentType.includes('xml')
			) {
				throw new Error(`[URLIngestor] Unsupported content type: ${contentType}`)
			}

			return response.text()
		}

		throw new Error(`[URLIngestor] Redirect loop detected`)
	}

	// ── HTML extraction ───────────────────────────────────────────────────────

	private extractTitle(html: string): string | null {
		const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
		if (!match) return null
		return decodeHtmlEntities(match[1]!.trim()).slice(0, 200)
	}

	private htmlToText(html: string): string {
		// Remove noise elements entirely (scripts, styles, nav, footer, header, aside)
		let text = html
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<nav[\s\S]*?<\/nav>/gi, '')
			.replace(/<footer[\s\S]*?<\/footer>/gi, '')
			.replace(/<header[\s\S]*?<\/header>/gi, '')
			.replace(/<aside[\s\S]*?<\/aside>/gi, '')
			.replace(/<!--[\s\S]*?-->/g, '')

		// Convert block elements to newlines
		text = text
			.replace(
				/<\/?(h[1-6]|p|div|section|article|main|li|tr|td|th|blockquote|pre|br)[^>]*>/gi,
				'\n'
			)
			.replace(/<\/?(ul|ol|table)[^>]*>/gi, '\n\n')

		// Strip all remaining tags
		text = text.replace(/<[^>]+>/g, '')

		// Decode HTML entities
		text = decodeHtmlEntities(text)

		// Normalise whitespace
		text = text
			.replace(/[ \t]+/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.trim()

		return text
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
		.replace(/&[a-zA-Z]+;/g, ' ')
}

function urlToTitle(url: string): string {
	try {
		const parsed = new URL(url)
		const pathname = parsed.pathname.replace(/\/$/, '')
		const last = pathname.split('/').pop()
		if (last) return last.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '')
		return parsed.hostname
	} catch {
		return url.slice(0, 80)
	}
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}
