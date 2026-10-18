import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const tabIdSchema = {
	parse: (v: unknown) => (typeof v === 'object' && v !== null ? v : {}) as { tabId?: number; url?: string },
	safeParse: (v: unknown) => ({ success: true as const, data: (typeof v === 'object' && v !== null ? v : {}) as { tabId?: number; url?: string } }),
}

const htmlSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'html' in v) return v as { html: string }
		throw new Error('Expected { html: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: htmlSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const stringResultSchema = {
	parse: (v: unknown) => v as { markdown: string; wordCount: number },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { markdown: string; wordCount: number } }),
}

const sanitizedSchema = {
	parse: (v: unknown) => v as { html: string; removed: number },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { html: string; removed: number } }),
}

/** Convert basic HTML to Markdown-like text (no heavy deps). */
function htmlToMarkdown(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) =>
			`${'#'.repeat(Number(level))} ${stripTags(content)}\n\n`
		)
		.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
		.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
		.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '_$1_')
		.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '_$1_')
		.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, '').trim()
}

/** Remove dangerous HTML elements and attributes. */
function sanitizeHtml(html: string): { html: string; removed: number } {
	let removed = 0
	const dangerous = /<(script|iframe|object|embed|form|input|button|link|base)[^>]*>[\s\S]*?<\/\1>/gi
	const dangerousVoid = /<(script|iframe|object|embed|form|input|button|link|base)([^>]*?)>/gi
	const eventAttrs = /\s(on\w+)="[^"]*"/gi

	const sanitized = html
		.replace(dangerous, () => { removed++; return '' })
		.replace(dangerousVoid, () => { removed++; return '' })
		.replace(eventAttrs, () => { removed++; return '' })

	return { html: sanitized, removed }
}

export const pageMarkdownAction: ActionDefinition<
	{ tabId?: number; url?: string },
	{ markdown: string; wordCount: number }
> = {
	id: 'org.page-agent.page.markdown',
	name: 'pageMarkdown',
	description: 'Extract the current page content as Markdown text. Pass tabId for browser extension context.',
	version: '1.0.0',
	category: 'page',
	capabilities: ['scripting', 'tabs'],
	inputSchema: tabIdSchema,
	outputSchema: stringResultSchema,
	execute: async (_input, ctx) => {
		// In browser extension context, tabId is provided
		// In non-browser context, return placeholder
		if (typeof document !== 'undefined') {
			const markdown = htmlToMarkdown(document.documentElement.outerHTML)
			return { markdown, wordCount: markdown.split(/\s+/).length }
		}
		// Node.js / non-browser: return metadata from context
		const placeholder = `[Page content extraction requires browser context. Session: ${ctx.sessionId ?? 'unknown'}]`
		return { markdown: placeholder, wordCount: 0 }
	},
	fallbackToLLM: false,
	timeoutMs: 5_000,
	userInvocable: true,
}

export const htmlSanitizeAction: ActionDefinition<
	{ html: string },
	{ html: string; removed: number }
> = {
	id: 'org.page-agent.page.sanitize-html',
	name: 'htmlSanitize',
	description: 'Remove dangerous HTML (scripts, event handlers, iframes). Returns safe HTML and count of removed elements.',
	version: '1.0.0',
	category: 'page',
	capabilities: [],
	inputSchema: htmlSchema,
	outputSchema: sanitizedSchema,
	execute: async ({ html }) => sanitizeHtml(html),
	fallbackToLLM: false,
	timeoutMs: 1_000,
	userInvocable: false,
}

const summarizeSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'text' in v) {
			return v as { text: string; maxSentences?: number }
		}
		throw new Error('Expected { text: string; maxSentences?: number }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: summarizeSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const summaryResultSchema = {
	parse: (v: unknown) => v as { summary: string; sentences: number; method: 'extractive' | 'llm' },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { summary: string; sentences: number; method: 'extractive' | 'llm' } }),
}

/**
 * Deterministic extractive summarisation - picks the highest-information
 * sentences using a TF-IDF-lite scoring (word frequency × position weight).
 * Falls back to LLM when text is too complex or too long (> 5 000 chars).
 */
function extractiveSummarize(text: string, maxSentences: number): string | null {
	const sentences = text.match(/[^.!?]+[.!?]+/g) ?? []
	if (sentences.length <= maxSentences) return text.trim() // Already short

	// Word frequency map (stopwords excluded)
	const STOPWORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for',
		'of','with','by','from','is','was','are','were','be','been','have','has','had',
		'do','does','did','will','would','could','should','may','might','it','its','this',
		'that','these','those','i','we','you','he','she','they'])
	const freq = new Map<string, number>()
	const words = text.toLowerCase().match(/\b\w+\b/g) ?? []
	for (const w of words) {
		if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
	}

	// Score each sentence: sum of word frequencies × recency decay
	const scored = sentences.map((s, idx) => {
		const sWords = s.toLowerCase().match(/\b\w+\b/g) ?? []
		const tfScore = sWords.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0)
		// Boost first and last sentences (they tend to be topic/conclusion)
		const posWeight = idx === 0 || idx === sentences.length - 1 ? 1.5 : 1.0
		return { sentence: s.trim(), score: tfScore * posWeight, idx }
	})

	// Pick top-N by score, re-sort by original position for coherence
	const top = scored
		.sort((a, b) => b.score - a.score)
		.slice(0, maxSentences)
		.sort((a, b) => a.idx - b.idx)

	return top.map((t) => t.sentence).join(' ')
}

export const pageSummarizerAction: ActionDefinition<
	{ text: string; maxSentences?: number },
	{ summary: string; sentences: number; method: 'extractive' | 'llm' }
> = {
	id: 'org.page-agent.page.summarize',
	name: 'pageSummarizer',
	description: 'Summarise text using extractive TF-IDF scoring (deterministic). Falls back to LLM for complex or long content.',
	version: '1.0.0',
	category: 'page',
	capabilities: [],
	inputSchema: summarizeSchema,
	outputSchema: summaryResultSchema,
	execute: async ({ text, maxSentences = 3 }) => {
		// Deterministic path: only attempt when text fits within a reasonable length
		if (text.length <= 5_000) {
			const summary = extractiveSummarize(text, maxSentences)
			if (summary) {
				return { summary, sentences: maxSentences, method: 'extractive' }
			}
		}
		// Signal to registry that LLM fallback is needed for longer / complex text
		throw new Error('Extractive summarisation not applicable - text too long or no sentences found')
	},
	fallbackToLLM: true,
	timeoutMs: 30_000,
	userInvocable: true,
}
