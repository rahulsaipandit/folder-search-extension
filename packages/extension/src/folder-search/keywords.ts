/**
 * Keyword side of hybrid search (design §6.4): exact strings such as names, invoice numbers and
 * error codes must match even when the embedding does not rank them first.
 */

const TOKEN_RE = /[\p{L}\p{N}]+(?:[-_./:@][\p{L}\p{N}]+)*/gu
const MIN_TERM = 2
const MAX_TERM = 64

/**
 * Tokenizes for indexing. Compound identifiers (`INV-2024-0042`, `foo_bar.ts`) are indexed both
 * whole and as their parts, so a query for either form hits.
 */
export function tokenize(text: string): string[] {
	const out: string[] = []
	for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
		const tok = m[0]
		if (tok.length >= MIN_TERM && tok.length <= MAX_TERM) out.push(tok)
		if (/[-_./:@]/.test(tok)) {
			for (const part of tok.split(/[-_./:@]/)) {
				if (part.length >= MIN_TERM && part.length <= MAX_TERM) out.push(part)
			}
		}
	}
	return out
}

const STOPWORDS = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'had',
	'not', 'but', 'you', 'your', 'all', 'can', 'will', 'its', 'our', 'out', 'any', 'photo', 'photos',
	'picture', 'pictures', 'image', 'images', 'file', 'files', 'of', 'in', 'on', 'to', 'is', 'it',
	'at', 'by', 'an', 'as', 'or', 'be', 'me', 'my',
])

/** Query terms: tokenized, de-duplicated, stopwords removed (they carry no discriminating power). */
export function queryTerms(query: string): string[] {
	return [...new Set(tokenize(query))].filter(t => !STOPWORDS.has(t))
}

/** Term-frequency map of a chunk, with stopwords dropped to keep the index small. */
export function termFrequencies(text: string): Map<string, number> {
	const tf = new Map<string, number>()
	for (const t of tokenize(text)) {
		if (STOPWORDS.has(t)) continue
		tf.set(t, (tf.get(t) ?? 0) + 1)
	}
	return tf
}

/**
 * True when the query reads like an identifier rather than a description: quoted strings, tokens
 * mixing letters and digits, codes with separators, UUIDs, emails or paths.
 */
export function looksExact(query: string): boolean {
	const q = query.trim()
	if (!q) return false
	if (/^".+"$/.test(q) || /^'.+'$/.test(q)) return true
	if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(q)) return true
	if (/[\\/][\w.-]+[\\/]/.test(q)) return true
	const words = q.split(/\s+/)
	if (words.length > 3) return false
	return words.some(
		w =>
			(w.length >= 5 && /\d/.test(w) && /[a-z]/i.test(w)) ||
			/^[A-Z][A-Z0-9]{1,}[-_]\d+/.test(w) ||
			/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(w) ||
			/^\d{4,}$/.test(w) ||
			/^0x[0-9a-f]+$/i.test(w) ||
			/^E[A-Z]{3,}$/.test(w)
	)
}

export interface Bm25Stats {
	/** Number of indexed chunks in scope. */
	n: number
}

const K1 = 1.2

/**
 * BM25 without length normalization (`b = 0`): per-chunk lengths are not stored, and chunks are
 * size-bounded by the chunker, so length varies little.
 */
export function bm25Term(tf: number, df: number, stats: Bm25Stats): number {
	if (tf <= 0 || df <= 0) return 0
	const idf = Math.log(1 + (stats.n - df + 0.5) / (df + 0.5))
	return (idf * tf * (K1 + 1)) / (tf + K1)
}

export interface KeywordHit {
	chunkId: string
	score: number
	matchedTerms: string[]
}

/** Scores chunks for `terms` given each term's postings (`chunkId → tf`). */
export function scoreKeywords(
	terms: string[],
	postingsByTerm: Map<string, Record<string, number>>,
	stats: Bm25Stats
): KeywordHit[] {
	const acc = new Map<string, { score: number; terms: Set<string> }>()
	for (const term of terms) {
		const postings = postingsByTerm.get(term)
		if (!postings) continue
		const ids = Object.keys(postings)
		const df = ids.length
		for (const id of ids) {
			const s = bm25Term(postings[id]!, df, stats)
			const entry = acc.get(id) ?? { score: 0, terms: new Set<string>() }
			entry.score += s
			entry.terms.add(term)
			acc.set(id, entry)
		}
	}
	// Reward chunks matching several distinct query terms over one repeated term.
	return [...acc.entries()]
		.map(([chunkId, e]) => ({
			chunkId,
			score: e.score * (1 + 0.25 * (e.terms.size - 1)),
			matchedTerms: [...e.terms],
		}))
		.sort((a, b) => b.score - a.score)
}

/** Returns a window of `text` around the first matched term, with ellipses where it was cut. */
export function makeSnippet(text: string, terms: string[], maxLen = 220): string {
	const flat = text.replace(/\s+/g, ' ').trim()
	if (flat.length <= maxLen) return flat
	const lower = flat.toLowerCase()
	let at = -1
	for (const t of terms) {
		const i = lower.indexOf(t.toLowerCase())
		if (i !== -1 && (at === -1 || i < at)) at = i
	}
	if (at === -1) return flat.slice(0, maxLen).trimEnd() + '…'
	const start = Math.max(0, at - Math.floor(maxLen / 3))
	const end = Math.min(flat.length, start + maxLen)
	return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '')
}
