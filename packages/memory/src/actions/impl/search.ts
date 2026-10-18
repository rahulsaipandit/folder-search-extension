import type { ActionDefinition } from '../../interfaces/IActionRegistry'

/**
 * Web Search skill - Phase 2 search category.
 *
 * Calls an OpenAI-compatible search API (Brave Search, Tavily, Serper, etc.)
 * via the environment-configured endpoint.  Falls back to IBrainEngine.think()
 * (vault-only) when no external API is configured.
 *
 * Configuration is read from ActionContext.metadata:
 *   ctx.metadata?.searchApiUrl   - base URL (default: Brave Search compatible)
 *   ctx.metadata?.searchApiKey   - API key
 *   ctx.metadata?.searchProvider - 'brave' | 'tavily' | 'serper' (default: 'brave')
 */

export interface WebSearchResult {
	title: string
	url: string
	snippet: string
	score?: number
}

const webSearchSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'query' in v) {
			return v as { query: string; topK?: number; freshness?: 'day' | 'week' | 'month' }
		}
		throw new Error('Expected { query: string; topK?: number; freshness?: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: webSearchSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const webSearchResultSchema = {
	parse: (v: unknown) => v as { results: WebSearchResult[]; query: string; provider: string },
	safeParse: (v: unknown) => ({
		success: true as const,
		data: v as { results: WebSearchResult[]; query: string; provider: string },
	}),
}

// ── Provider adapters ────────────────────────────────────────────────────────

async function searchBrave(
	query: string,
	topK: number,
	apiKey: string,
	freshness?: string
): Promise<WebSearchResult[]> {
	const params = new URLSearchParams({
		q: query,
		count: String(Math.min(topK, 20)),
		...(freshness ? { freshness } : {}),
	})
	const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
		headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
	})
	if (!res.ok) throw new Error(`Brave Search error ${res.status}: ${res.statusText}`)
	const data = await res.json() as {
		web?: { results?: { title: string; url: string; description: string; relevance_score?: number }[] }
	}
	return (data.web?.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.description,
		score: r.relevance_score,
	}))
}

async function searchTavily(
	query: string,
	topK: number,
	apiKey: string
): Promise<WebSearchResult[]> {
	const res = await fetch('https://api.tavily.com/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ api_key: apiKey, query, max_results: Math.min(topK, 10) }),
	})
	if (!res.ok) throw new Error(`Tavily error ${res.status}: ${res.statusText}`)
	const data = await res.json() as {
		results?: { title: string; url: string; content: string; score?: number }[]
	}
	return (data.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.content.slice(0, 300),
		score: r.score,
	}))
}

async function searchSerper(
	query: string,
	topK: number,
	apiKey: string
): Promise<WebSearchResult[]> {
	const res = await fetch('https://google.serper.dev/search', {
		method: 'POST',
		headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify({ q: query, num: Math.min(topK, 10) }),
	})
	if (!res.ok) throw new Error(`Serper error ${res.status}: ${res.statusText}`)
	const data = await res.json() as {
		organic?: { title: string; link: string; snippet: string; position?: number }[]
	}
	return (data.organic ?? []).map((r) => ({
		title: r.title,
		url: r.link,
		snippet: r.snippet,
		score: r.position ? 1 / r.position : undefined,
	}))
}

// ── Skill definition ──────────────────────────────────────────────────────────

export const webSearchAction: ActionDefinition<
	{ query: string; topK?: number; freshness?: 'day' | 'week' | 'month' },
	{ results: WebSearchResult[]; query: string; provider: string }
> = {
	id: 'org.page-agent.search.web',
	name: 'webSearch',
	description: 'Live web search via Brave, Tavily, or Serper. Configure via ctx.metadata.searchApiKey + searchProvider.',
	version: '1.0.0',
	category: 'search',
	capabilities: [],
	inputSchema: webSearchSchema,
	outputSchema: webSearchResultSchema,
	execute: async ({ query, topK = 5, freshness }, ctx) => {
		const apiKey = (ctx.metadata?.searchApiKey as string | undefined) ?? ''
		const provider = (ctx.metadata?.searchProvider as string | undefined) ?? 'brave'

		if (!apiKey) {
			// No external API key - fall through to LLM fallback
			throw new Error('webSearch requires ctx.metadata.searchApiKey')
		}

		let results: WebSearchResult[]
		switch (provider) {
			case 'tavily':
				results = await searchTavily(query, topK, apiKey)
				break
			case 'serper':
				results = await searchSerper(query, topK, apiKey)
				break
			case 'brave':
			default:
				results = await searchBrave(query, topK, apiKey, freshness)
				break
		}

		return { results: results.slice(0, topK), query, provider }
	},
	fallbackToLLM: true, // Uses IBrainEngine.think() when no API key is configured
	timeoutMs: 15_000,
	userInvocable: true,
}
