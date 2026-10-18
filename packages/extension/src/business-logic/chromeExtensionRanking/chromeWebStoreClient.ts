/**
 * Chrome Web Store client (design doc §8 items 1 and 2).
 *
 * Google publishes no official Chrome Web Store API. Third-party scrapers describe an internal
 * `batchexecute` JSON-RPC transport the store's Angular frontend calls, but direct fetches of real
 * detail and search-results pages (verified against `chromewebstore.google.com/detail/<id>` and
 * `chromewebstore.google.com/search/<query>` while writing this, not guessed at) found something
 * simpler: both pages are server-rendered with plain, regex-parseable data — standard
 * `og:title`/`og:description`/`og:image` meta tags on the detail page, and per-result cards (name,
 * average rating, Featured/Verified-publisher badges) in DOM order on the search page. No
 * `batchexecute` call needed for either.
 *
 * Confirmed limitation from that same live fetch: **search-result cards do not expose review count
 * or user count** (unlike the detail page, which has both as plain rendered text) — only detail
 * lookup has those numbers. A full per-competitor record (design doc §6.1's Factors B/C/D) needs a
 * separate `lookupExtension()` call per competitor; `searchKeywordRank` alone only gets rank
 * position, name, rating, and badge state.
 *
 * This is still a live bet on the current page shape, not a stable contract (same caveat Digital
 * Marketing Pro's googlePlayClient.ts documents for its own HTML scraping) — every field here is
 * optional except id/name/description, and a shape change on Google's side degrades individual
 * fields to `undefined` rather than throwing, per this project's "fail soft, never fabricate"
 * principle (AGENTS.md, and this design doc's §4).
 */

import type { ChromeExtensionDetail, KeywordRankResult, RankedExtension } from './types'

const DETAIL_URL_RE =
	/chromewebstore\.google\.com\/detail\/(?:[a-z0-9-]+\/)?([a-p][a-z]{31})/i
const BARE_ID_RE = /^[a-p][a-z]{31}$/i

/** Extracts the 32-character extension id from a pasted Chrome Web Store URL or bare id. */
export function parseExtensionId(idOrUrl: string): string | null {
	const trimmed = idOrUrl.trim()
	if (BARE_ID_RE.test(trimmed)) return trimmed.toLowerCase()
	const match = DETAIL_URL_RE.exec(trimmed)
	return match ? match[1].toLowerCase() : null
}

function unescapeHtml(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
}

function extractMetaContent(html: string, property: string): string | undefined {
	const re = new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
	const match = re.exec(html)
	return match ? unescapeHtml(match[1]) : undefined
}

function parseNumber(text: string | undefined): number | undefined {
	if (!text) return undefined
	const digits = text.replace(/,/g, '')
	const value = Number.parseFloat(digits)
	return Number.isFinite(value) ? value : undefined
}

/**
 * Fetches and parses a Chrome Web Store extension's detail page.
 * Returns `null` if the id can't be parsed or the page can't be fetched/parsed — never a
 * fabricated/partial guess presented as real data.
 */
export async function lookupExtension(idOrUrl: string): Promise<ChromeExtensionDetail | null> {
	const id = parseExtensionId(idOrUrl)
	if (!id) return null

	let html: string
	try {
		const response = await fetch(`https://chromewebstore.google.com/detail/${id}`)
		if (!response.ok) {
			console.error(
				`[chromeWebStoreClient] Detail page fetch returned ${response.status} ${response.statusText} for id ${id}`,
			)
			return null
		}
		html = await response.text()
	} catch (error) {
		console.error('[chromeWebStoreClient] Failed to fetch extension detail page', error)
		return null
	}

	const rawTitle = extractMetaContent(html, 'og:title')
	if (!rawTitle) {
		// Page fetched (200 OK) but had no og:title meta tag — either Google served a
		// different page shape (e.g. a consent/interstitial page) than the one this
		// scraper was written against, or `id` doesn't correspond to a real listing.
		console.error(
			`[chromeWebStoreClient] No og:title meta tag found in detail page for id ${id} (html length ${html.length})`,
		)
		return null
	}
	// og:title is "<name> - Chrome Web Store"; strip the store suffix.
	const name = rawTitle.replace(/\s*-\s*Chrome Web Store\s*$/i, '')
	const description = extractMetaContent(html, 'og:description') ?? ''
	const iconUrl = extractMetaContent(html, 'og:image')

	const ratingMatch = /(\d+(?:\.\d+)?) out of 5 stars/.exec(html)
	const reviewCountMatch = /(\d[\d,]*) ratings?/.exec(html)
	const userCountMatch = /(\d[\d,]*)\+?\s*users/.exec(html)

	return {
		id,
		name,
		description,
		iconUrl,
		rating: parseNumber(ratingMatch?.[1]),
		reviewCount: parseNumber(reviewCountMatch?.[1]),
		userCount: parseNumber(userCountMatch?.[1]),
	}
}

const CARD_START_RE = /data-item-id="([a-p][a-z]{31})"[^>]*jsname="yiuEB"/g

interface SearchResultsPage {
	checkedAt: number
	results: RankedExtension[]
}

/**
 * Fetches and parses one keyword/locale Chrome Web Store search-results page into its ranked
 * extension list (design doc §8 item 2) — the actual network+scrape work, split out from rank
 * computation so `searchKeywordRankMany` below can fetch one page per unique (keyword, locale)
 * pair and compute every tracked extension's position against it, instead of re-fetching the
 * identical page once per extension that happens to track the same keyword.
 *
 * Returns `null` on a fetch/network failure (never throws — every caller treats this the same way
 * `searchKeywordRank` always has: a null page, not an exception).
 */
async function fetchSearchResultsPage(keyword: string, locale: string): Promise<SearchResultsPage | null> {
	let html: string
	try {
		const url = `https://chromewebstore.google.com/search/${encodeURIComponent(keyword)}?hl=${encodeURIComponent(locale)}`
		const response = await fetch(url)
		if (!response.ok) return null
		html = await response.text()
	} catch (error) {
		console.error('[chromeWebStoreClient] Failed to fetch search results page', error)
		return null
	}

	const starts: { id: string; index: number }[] = []
	for (const match of html.matchAll(CARD_START_RE)) {
		starts.push({ id: match[1], index: match.index ?? 0 })
	}

	const results: RankedExtension[] = starts.map((start, i) => {
		const end = i + 1 < starts.length ? starts[i + 1].index : html.length
		const chunk = html.slice(start.index, end)
		const nameMatch = /<h2 class="CiI2if">([^<]*)<\/h2>/.exec(chunk)
		const ratingMatch = /Average rating (\d+(?:\.\d+)?) out of 5 stars/.exec(chunk)
		return {
			id: start.id,
			name: nameMatch ? unescapeHtml(nameMatch[1]) : start.id,
			rating: parseNumber(ratingMatch?.[1]),
			featured: chunk.includes('aria-label="Featured badge"'),
			verifiedPublisher: chunk.includes('aria-label="Published by verified publisher"'),
		}
	})

	return { checkedAt: Date.now(), results }
}

/** Computes one tracked extension's rank within an already-fetched search-results page. */
function rankWithinPage(
	page: SearchResultsPage,
	keyword: string,
	locale: string,
	extensionId: string,
): KeywordRankResult {
	const positionIndex = page.results.findIndex((r) => r.id === extensionId)
	return {
		keyword,
		locale,
		checkedAt: page.checkedAt,
		position: positionIndex === -1 ? null : positionIndex + 1,
		totalResultsScanned: page.results.length,
		results: page.results,
	}
}

/**
 * Fetches a Chrome Web Store search-results page for one keyword and returns the tracked
 * extension's position within it (design doc §8 item 2).
 *
 * Returns `null` on a fetch/network failure. Returns a result with `position: null` when the
 * tracked extension isn't among the returned results — that's a real "not found in the visible
 * window" answer, not a failure, and must be shown to the user as such rather than silently
 * dropped (design doc §4's "fail soft, never fabricate" principle).
 */
export async function searchKeywordRank(
	keyword: string,
	locale: string,
	extensionId: string,
): Promise<KeywordRankResult | null> {
	const page = await fetchSearchResultsPage(keyword, locale)
	return page ? rankWithinPage(page, keyword, locale, extensionId) : null
}

// Independent search-results fetches run this many at a time in `searchKeywordRankMany` — bounded
// so a sweep across many tracked keywords doesn't hammer the store with dozens of simultaneous
// requests, while still being far faster than one fetch at a time.
const SEARCH_BATCH_CONCURRENCY = 5

/**
 * Same as `searchKeywordRank`, batched: fetches ONE search-results page per unique
 * (keyword, locale) pair — instead of once per request — and computes every request's rank
 * against the shared parsed page, since two tracked extensions can watch the same keyword/locale.
 * Independent pages are fetched concurrently (bounded by `SEARCH_BATCH_CONCURRENCY`) rather than
 * strictly one after another. Returns results in the same order as `requests`.
 */
export async function searchKeywordRankMany(
	requests: { keyword: string; locale: string; extensionId: string }[],
): Promise<(KeywordRankResult | null)[]> {
	const pageKey = (keyword: string, locale: string) => `${locale}\u0000${keyword}`

	const uniqueRequests = new Map<string, { keyword: string; locale: string }>()
	for (const req of requests) {
		uniqueRequests.set(pageKey(req.keyword, req.locale), req)
	}

	const pages = new Map<string, SearchResultsPage | null>()
	const uniqueEntries = [...uniqueRequests.entries()]
	for (let i = 0; i < uniqueEntries.length; i += SEARCH_BATCH_CONCURRENCY) {
		const chunk = uniqueEntries.slice(i, i + SEARCH_BATCH_CONCURRENCY)
		const chunkPages = await Promise.all(
			chunk.map(async ([key, { keyword, locale }]) => {
				try {
					return [key, await fetchSearchResultsPage(keyword, locale)] as const
				} catch (error) {
					// fetchSearchResultsPage already catches its own fetch/network errors and
					// returns null - this only guards against something unexpected in the regex
					// parsing above throwing, so one bad page can't fail the whole chunk.
					console.error('[chromeWebStoreClient] Unexpected error parsing search results page', error)
					return [key, null] as const
				}
			})
		)
		for (const [key, page] of chunkPages) pages.set(key, page)
	}

	return requests.map((req) => {
		const page = pages.get(pageKey(req.keyword, req.locale))
		return page ? rankWithinPage(page, req.keyword, req.locale, req.extensionId) : null
	})
}
