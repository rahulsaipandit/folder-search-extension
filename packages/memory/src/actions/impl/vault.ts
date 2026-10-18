import type { MemoryEntry } from '../../types'
import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const slugSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'slug' in v) return v as { slug: string }
		throw new Error('Expected { slug: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: slugSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

export const readPageAction: ActionDefinition<
	{ slug: string },
	{ page: { slug: string; title: string; content: string; updatedAt: string } | null }
> = {
	id: 'org.page-agent.vault.read-page',
	name: 'readPage',
	description: 'Read a single vault page by its slug. Returns null if the page does not exist.',
	version: '1.0.0',
	category: 'vault',
	capabilities: [],
	inputSchema: slugSchema,
	outputSchema: {
		parse: (v: unknown) => v as { page: { slug: string; title: string; content: string; updatedAt: string } | null },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { page: { slug: string; title: string; content: string; updatedAt: string } | null } }),
	},
	execute: async ({ slug }, ctx) => {
		if (!ctx.brainEngine) throw new Error('readPage requires brainEngine in ActionContext')
		// IBrainEngine does not directly expose vault; use think() to retrieve canonical page context
		// The vault readPage is available if metadata is attached to the brainEngine instance
		const results = await ctx.brainEngine.search(`slug:${slug}`, { topK: 1, filter: { type: 'artifact' } })
		const entry = results.items[0]?.entry
		if (!entry) return { page: null }
		return {
			page: {
				slug: (entry.metadata?.slug as string | undefined) ?? entry.id,
				title: entry.title ?? slug,
				content: entry.content,
				updatedAt: entry.updatedAt ?? entry.createdAt,
			},
		}
	},
	fallbackToLLM: false,
	timeoutMs: 5_000,
	userInvocable: true,
}

const querySchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'question' in v) return v as { question: string; topK?: number }
		throw new Error('Expected { question: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: querySchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const searchSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'query' in v) return v as { query: string; topK?: number }
		throw new Error('Expected { query: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: searchSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

export const queryWikiAction: ActionDefinition<
	{ question: string; topK?: number },
	{ answer: string; sources: string[]; confidence: number }
> = {
	id: 'org.page-agent.vault.query-wiki',
	name: 'queryWiki',
	description: 'Answer a question using the knowledge vault. Returns a synthesized answer with sources.',
	version: '1.0.0',
	category: 'vault',
	capabilities: [],
	inputSchema: querySchema,
	outputSchema: {
		parse: (v: unknown) => v as { answer: string; sources: string[]; confidence: number },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { answer: string; sources: string[]; confidence: number } }),
	},
	execute: async ({ question }, ctx) => {
		if (!ctx.brainEngine) {
			throw new Error('queryWiki requires brainEngine in ActionContext')
		}
		const result = await ctx.brainEngine.think(question)
		return { answer: result.answer, sources: result.sources, confidence: result.confidence }
	},
	fallbackToLLM: false,
	timeoutMs: 30_000,
	userInvocable: true,
}

export const searchPagesAction: ActionDefinition<
	{ query: string; topK?: number },
	{ items: { id: string; title: string; content: string; score: number }[] }
> = {
	id: 'org.page-agent.vault.search-pages',
	name: 'searchPages',
	description: 'Semantic search across memory entries and vault artifacts.',
	version: '1.0.0',
	category: 'vault',
	capabilities: [],
	inputSchema: searchSchema,
	outputSchema: {
		parse: (v: unknown) => v as { items: { id: string; title: string; content: string; score: number }[] },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { items: { id: string; title: string; content: string; score: number }[] } }),
	},
	execute: async ({ query, topK = 5 }, ctx) => {
		if (!ctx.brainEngine) {
			throw new Error('searchPages requires brainEngine in ActionContext')
		}
		const results = await ctx.brainEngine.search(query, { topK })
		return {
			items: results.items.map((r) => ({
				id: r.entry.id,
				title: r.entry.title ?? r.entry.id,
				content: r.entry.content.slice(0, 500),
				score: r.score,
			})),
		}
	},
	fallbackToLLM: false,
	timeoutMs: 10_000,
	userInvocable: true,
}

// ── Executive Summary ─────────────────────────────────────────────────────────

const executiveSummaryInputSchema = {
	parse: (v: unknown) => {
		if (typeof v !== 'object' || v === null) throw new Error('Expected object')
		return v as { timeWindowDays?: number; focusEntities?: string[]; maxSentences?: number }
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: executiveSummaryInputSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const executiveSummaryOutputSchema = {
	parse: (v: unknown) => v as {
		summary: string
		highlights: string[]
		entryCount: number
		timeWindow: string
		generatedAt: string
	},
	safeParse: (v: unknown) => ({
		success: true as const,
		data: executiveSummaryOutputSchema.parse(v),
	}),
}

export const executiveSummaryAction: ActionDefinition<
	{
		timeWindowDays?: number
		focusEntities?: string[]
		maxSentences?: number
	},
	{
		summary: string
		highlights: string[]
		entryCount: number
		timeWindow: string
		generatedAt: string
	}
> = {
	id: 'org.page-agent.vault.executive-summary',
	name: 'executiveSummary',
	description:
		'Generate an executive summary of recent memory entries. ' +
		'Returns key highlights and a synthesized summary paragraph for a given time window.',
	version: '1.0.0',
	category: 'vault',
	capabilities: [],
	inputSchema: executiveSummaryInputSchema,
	outputSchema: executiveSummaryOutputSchema,
	execute: async (
		{ timeWindowDays = 7, focusEntities = [], maxSentences = 10 },
		ctx
	) => {
		if (!ctx.brainEngine) {
			throw new Error('executiveSummary requires brainEngine in ActionContext')
		}

		const now = Date.now()
		const windowMs = timeWindowDays * 24 * 60 * 60 * 1000
		const since = new Date(now - windowMs).toISOString()

		// 1. Fetch recent entries within time window
		const results = await ctx.brainEngine.search('', {
			topK: 200,
			filter: { maxAge: windowMs, lifecycleState: 'active' },
		})

		let entries: MemoryEntry[] = results.items.map((r) => r.entry)

		// 2. Filter by focusEntities if provided
		if (focusEntities.length > 0) {
			const lowerFocus = focusEntities.map((e) => e.toLowerCase())
			entries = entries.filter((entry) => {
				const text = `${entry.title ?? ''} ${entry.content}`.toLowerCase()
				return lowerFocus.some((fe) => text.includes(fe)) ||
					entry.entities?.some((eid) =>
						lowerFocus.some((fe) => eid.toLowerCase().includes(fe))
					)
			})
		}

		// Filter to entries within the time window
		entries = entries.filter((e) => e.createdAt >= since)

		const entryCount = entries.length

		if (entryCount === 0) {
			const timeWindow = formatTimeWindow(timeWindowDays)
			return {
				summary: `No memory entries found in the ${timeWindow}.`,
				highlights: [],
				entryCount: 0,
				timeWindow,
				generatedAt: new Date().toISOString(),
			}
		}

		// 3. Extract highlights - T0 heuristic: highest-salience entries, one sentence each
		const sorted = [...entries].sort((a, b) => {
			const sa = a.salience ?? a.importance ?? 0
			const sb = b.salience ?? b.importance ?? 0
			return sb - sa
		})

		const topEntries = sorted.slice(0, maxSentences)
		const highlights = topEntries.map((entry) => {
			const title = entry.title ? `${entry.title}: ` : ''
			// Take first sentence from content
			const firstSentence = extractFirstSentence(entry.content)
			return `${title}${firstSentence}`
		})

		// 4. Synthesize summary - deterministic first, LLM fallback
		const timeWindow = formatTimeWindow(timeWindowDays)
		const summary = buildSummary(highlights, timeWindowDays, entryCount)

		return {
			summary,
			highlights,
			entryCount,
			timeWindow,
			generatedAt: new Date().toISOString(),
		}
	},
	fallbackToLLM: true,
	timeoutMs: 30_000,
	userInvocable: true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractFirstSentence(text: string): string {
	const cleaned = text.replace(/\s+/g, ' ').trim()
	const match = /^[^.!?]+[.!?]/.exec(cleaned)
	return match ? match[0]!.trim() : cleaned.slice(0, 120).trim()
}

function formatTimeWindow(days: number): string {
	if (days === 1) return 'last 24 hours'
	if (days === 7) return 'last 7 days'
	if (days === 30) return 'last 30 days'
	return `last ${days} days`
}

function buildSummary(highlights: string[], timeWindowDays: number, entryCount: number): string {
	const timeLabel = formatTimeWindow(timeWindowDays)
	const intro = `Over the ${timeLabel}, ${entryCount} memory entr${entryCount === 1 ? 'y was' : 'ies were'} recorded.`

	if (highlights.length === 0) return intro

	const keyPoints = highlights
		.slice(0, 3)
		.map((h) => h.replace(/[.!?]$/, ''))
		.join('; ')

	return `${intro} Key highlights include: ${keyPoints}.`
}
