/**
 * ContextBuilder - Prompt shaping for LLM context injection (CB port)
 *
 * Builds context strings from memory entries, sorted by salience and recency,
 * with token-aware truncation.
 *
 * buildContextForQuery() adds intent-based reranking on top of salience sorting.
 * Inspired by Aethene's recall-service approach (https://github.com/akhilponnada/aethene):
 * detect what *kind* of question is being asked, then boost memories that match
 * that intent before the token-budget slice. This is all keyword pattern matching -
 * no LLM call required.
 *
 * Ported from GA's lib/memory/context/ContextBuilder.ts for Phase 3.2 of the
 * GA→CB migration. Adapted to use CB's MemoryEntry and MemoryType from '../../types'.
 */

import type { MemoryEntry, MemoryType, QueryIntent } from '../../types'

export interface ContextBuilderOptions {
	maxTokens: number
	includeWorking: boolean
	includeSemantic: boolean
	includeEpisodic: boolean
	maxEntries: number
}

const DEFAULT_OPTIONS: ContextBuilderOptions = {
	maxTokens: 350,
	includeWorking: true,
	includeSemantic: true,
	includeEpisodic: true,
	maxEntries: 10,
}

// ─── Intent-Based Reranking (Aethene-inspired) ───────────────────────────────

/**
 * Query-side patterns: detect intents from the incoming question text.
 *
 * Why keyword patterns instead of embeddings:
 *   - Zero latency, zero cost, fully offline
 *   - Query intent is syntactically signaled ("where does", "how do", "when did")
 *     so surface patterns are reliable enough
 *   - Aethene's production implementation uses the same approach
 */
const INTENT_QUERY_PATTERNS: Record<Exclude<QueryIntent, 'general' | 'factual' | 'experiential' | 'procedural' | 'mixed'>, RegExp[]> = {
	residence: [
		/where\b.*(live|stay|based|reside|located|from)/i,
		/\b(address|location|city|town|country|home|apartment|house|neighborhood)\b/i,
		/\bmov(ed|ing) to\b/i,
	],
	employment: [
		/where\b.*(work|employed|job)/i,
		/\b(job|career|company|employer|role|position|title|profession|occupation)\b/i,
		/\b(hired|promoted|fired|quit|laid off|works? at|employed at)\b/i,
	],
	temporal: [
		/\bwhen\b/i,
		/\b(last time|recently|date|history|timeline|ago|before|after|since|latest)\b/i,
		/\b(yesterday|last week|last month|this year|earlier)\b/i,
	],
	preference: [
		/\b(like|prefer|favorite|favourite|enjoy|love|hate|dislike|interested in|fond of)\b/i,
		/what.*\b(think|feel|opinion)\b/i,
	],
	procedure: [
		/\bhow\b.*(do|to|can|should|would|did|does)\b/i,
		/\b(steps?|process|method|way to|approach|procedure|guide|instructions?)\b/i,
	],
	identity: [
		/\bwho is\b/i,
		/\btell me about\b/i,
		/\bwhat.*know about\b/i,
		/\bdescribe\b/i,
		/\bbackground (of|on)\b/i,
	],
}

/**
 * Content-side signals: keywords/patterns in a memory's content that indicate
 * it's a good match for a given intent.
 *
 * Boost values (+0.0 to +0.3 on top of salience):
 *   Strong signal   → +0.25
 *   Moderate signal → +0.15
 *   Weak signal     → +0.05
 *   Penalty         → −0.15 (suppresses clearly irrelevant entries)
 */
const INTENT_CONTENT_SIGNALS: Record<
	Exclude<QueryIntent, 'general' | 'factual' | 'experiential' | 'procedural' | 'mixed'>,
	{ boost: Array<{ pattern: RegExp; weight: number }> }
> = {
	residence: {
		boost: [
			{ pattern: /\b(lives? in|moved? to|relocated|based in|located in|address|hometown)\b/i, weight: 0.25 },
			{ pattern: /\b(city|town|country|neighborhood|apartment|house|flat)\b/i, weight: 0.15 },
			// Penalize memories about other people's residences
			{ pattern: /\b(parents? live|friend lives|family.*(live|stay))\b/i, weight: -0.15 },
		],
	},
	employment: {
		boost: [
			{ pattern: /\b(works? at|employed (at|by)|position (at|of)|job (at|title)|hired (at|by))\b/i, weight: 0.25 },
			{ pattern: /\b(role|title|company|organization|employer|profession|promoted|fired|quit)\b/i, weight: 0.15 },
		],
	},
	temporal: {
		// Memories with explicit dates are most useful for temporal queries
		boost: [
			{ pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i, weight: 0.25 },
			{ pattern: /\b\d{4}\b/, weight: 0.20 },
			{ pattern: /\b(yesterday|last week|last month|this year|ago|recently|on \w+day)\b/i, weight: 0.15 },
		],
	},
	preference: {
		boost: [
			{ pattern: /\b(loves?|enjoys?|likes?|prefers?|favorite|favourite|hates?|dislikes?)\b/i, weight: 0.25 },
			{ pattern: /\b(always|never|usually|typically)\b.*\b(eat|drink|watch|read|use|buy)\b/i, weight: 0.15 },
		],
	},
	procedure: {
		// Numbered steps and procedure-type memories are the clearest signal
		boost: [
			{ pattern: /^\s*\d+\.\s/m, weight: 0.25 }, // numbered step
			{ pattern: /\b(step \d|first|then|finally|next)\b/i, weight: 0.20 },
			{ pattern: /\b(tip|trick|approach|method|way to)\b/i, weight: 0.10 },
		],
	},
	identity: {
		boost: [
			// Memories about named entities (capitalized proper noun at start)
			{ pattern: /^[A-Z][a-z]+ (is|was|has|works|lives|studied)/m, weight: 0.25 },
			{ pattern: /\b(profile|background|bio|known for|described as)\b/i, weight: 0.20 },
		],
	},
}

// ─── Type Prefixes ────────────────────────────────────────────────────────────

/**
 * CB TYPE_PREFIXES - maps every MemoryType to the label injected into the
 * assembled context string. '[Memory]' is the fallback for unknown types.
 *
 * Note: CB uses '[Memory]' for episodic (not '[Event]') and '[Summary]' for
 * semantic (not '[Insight]') to align with CB's terminology. The original
 * GA prefixes are preserved for insight, goal, procedure, entity, artifact,
 * and prospective so agents can distinguish L2 insights from L1 summaries.
 */
const TYPE_PREFIXES: Record<MemoryType, string> = {
	episodic: '[Memory]',
	semantic: '[Summary]',
	insight: '[Insight]',
	goal: '[Goal]',
	procedure: '[Procedure]',
	entity: '[Entity]',
	working: '[Context]',
	artifact: '[Document]',
	prospective: '[Reminder]',
}

// ─── Subject Extraction ───────────────────────────────────────────────────────

/**
 * Extract the main subject of a query - the proper noun the question is about.
 * Used to boost memories that mention that subject, regardless of intent.
 *
 * Simple heuristic: longest capitalized token sequence not at sentence start.
 * Good enough for common names ("Ask about Sarah", "what does John prefer").
 */
function extractQuerySubject(query: string): string | null {
	const matches = query.match(/(?<!\.\s|^)(\b[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*\b)/g)
	if (!matches || matches.length === 0) return null
	return matches.reduce((a, b) => (b.length > a.length ? b : a))
}

// ─── ContextBuilder ───────────────────────────────────────────────────────────

/**
 * ContextBuilder assembles a token-budgeted context string from MemoryEntry
 * arrays for injection into agent prompts.
 *
 * Two public build methods:
 *  - buildContext()         - salience + recency sort, no query awareness
 *  - buildContextForQuery() - adds intent-based reranking (6 intents) +
 *                             subject boost; this is the method wired into
 *                             IBrainEngine.getContextPack()
 *
 * Static convenience wrapper:
 *  - ContextBuilder.buildContextForQuery(entries, query, maxTokens) - uses
 *    default options; avoids constructing an instance at call sites.
 */
export class ContextBuilder {
	private options: ContextBuilderOptions

	constructor(options: Partial<ContextBuilderOptions> = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options }
	}

	// ─── Static convenience ────────────────────────────────────────────────────

	/**
	 * Static wrapper - build a query-aware context string with default options.
	 * Avoids constructing an instance at call sites that only need one call.
	 */
	static buildContextForQuery(
		memories: MemoryEntry[],
		query: string,
		maxTokens?: number
	): string {
		return new ContextBuilder().buildContextForQuery(memories, query, maxTokens)
	}

	// ─── Instance methods ──────────────────────────────────────────────────────

	/**
	 * Build context string without query-awareness.
	 * Sorts purely by salience + recency. Use when no query is available
	 * (e.g., proactive memory injection at session start).
	 */
	buildContext(memories: MemoryEntry[], maxTokens?: number): string {
		const effectiveMaxTokens = maxTokens ?? this.options.maxTokens
		const filtered = this.filterMemories(memories)
		const sorted = this.sortByImportanceAndRecency(filtered)
		return this.assembleContext(sorted, effectiveMaxTokens)
	}

	/**
	 * Build context string with intent-based reranking.
	 *
	 * Steps:
	 *   1. Detect query intents (keyword pattern matching, no LLM)
	 *   2. Extract query subject (proper noun heuristic)
	 *   3. Compute an intent boost (0–0.3) per entry from content signals
	 *   4. Add subject boost (+0.2) for entries mentioning the query subject
	 *   5. Sort by (salience + intentBoost + subjectBoost) desc
	 *   6. Slice to maxEntries, then apply token budget
	 *
	 * Why this order: sorting before slicing means the token budget cuts off
	 * low-relevance entries, not high-relevance ones that happened to be long.
	 */
	buildContextForQuery(memories: MemoryEntry[], query: string, maxTokens?: number): string {
		const effectiveMaxTokens = maxTokens ?? this.options.maxTokens
		const filtered = this.filterMemories(memories)

		const intents = this.detectIntents(query)
		const subject = extractQuerySubject(query)

		const sorted = this.sortByIntentAndSalience(filtered, intents, subject)
		return this.assembleContext(sorted, effectiveMaxTokens)
	}

	// ─── Intent Detection ──────────────────────────────────────────────────────

	/**
	 * Detect one or more query intents from the question text.
	 * Returns ['general'] if no specific intent patterns match.
	 *
	 * Multiple intents can fire (e.g., "When did Sarah start working at Google?"
	 * matches both 'temporal' and 'employment').
	 */
	detectIntents(query: string): QueryIntent[] {
		const detected: QueryIntent[] = []

		for (const [intent, patterns] of Object.entries(INTENT_QUERY_PATTERNS) as [
			Exclude<QueryIntent, 'general' | 'factual' | 'experiential' | 'procedural' | 'mixed'>,
			RegExp[],
		][]) {
			if (patterns.some((re) => re.test(query))) {
				detected.push(intent)
			}
		}

		return detected.length > 0 ? detected : ['general']
	}

	// ─── Formatting ────────────────────────────────────────────────────────────

	/**
	 * Format a single memory entry for inclusion in a context string.
	 * Public so callers can preview individual entries.
	 */
	formatEntry(memory: MemoryEntry): string {
		const prefix = TYPE_PREFIXES[memory.type] ?? '[Memory]'
		const timestamp = new Date(memory.createdAt).toLocaleDateString()

		if (memory.title) {
			return `${prefix} ${memory.title}\n${memory.content}`
		}
		return `${prefix} [${timestamp}] ${memory.content}`
	}

	/** Alias kept for GA back-compat. */
	formatMemory(memory: MemoryEntry): string {
		return this.formatEntry(memory)
	}

	// ─── Token Utilities ───────────────────────────────────────────────────────

	/**
	 * Estimate token count. ~3.5 chars/token with 10% overhead.
	 * Matches GA's estimateTokens() exactly so budgets are consistent.
	 */
	estimateTokens(text: string): number {
		if (text.length <= 10) return Math.ceil(text.length / 2)
		return Math.ceil((text.length / 3.5) * 1.1)
	}

	getRemainingBudget(currentText: string, maxTokens: number): number {
		return Math.max(0, maxTokens - this.estimateTokens(currentText))
	}

	withOptions(options: Partial<ContextBuilderOptions>): ContextBuilder {
		return new ContextBuilder({ ...this.options, ...options })
	}

	// ─── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Compute the intent boost for a single entry.
	 *
	 * Scores content signals for each detected intent, sums them, caps at +0.3.
	 * Penalties (negative weights) can reduce the score below 0 - this is intentional:
	 * an entry that strongly contradicts the intent (e.g., "parents live in X" for
	 * a residence query about the user) should rank below neutral entries.
	 */
	private computeIntentBoost(entry: MemoryEntry, intents: QueryIntent[]): number {
		if (intents.includes('general')) return 0

		// Procedure queries get an automatic boost for procedure-type entries -
		// no need to scan content if the type already tells us it's procedural.
		if (intents.includes('procedure') && entry.type === 'procedure') return 0.3

		// Identity queries get an automatic boost for entity-type entries.
		if (intents.includes('identity') && entry.type === 'entity') return 0.3

		const text = `${entry.title ?? ''} ${entry.content}`
		let total = 0

		for (const intent of intents) {
			if (intent === 'general' || intent === 'factual' || intent === 'experiential' || intent === 'procedure' || intent === 'mixed') continue
			const signals = INTENT_CONTENT_SIGNALS[intent as keyof typeof INTENT_CONTENT_SIGNALS]
			if (!signals) continue
			for (const { pattern, weight } of signals.boost) {
				if (pattern.test(text)) total += weight
			}
		}

		// Cap: max +0.3 boost, min −0.15 penalty
		return Math.max(-0.15, Math.min(0.3, total))
	}

	/**
	 * Sort with intent awareness.
	 * Effective score = salience + intentBoost + subjectBoost.
	 * Recency is a tiebreaker when scores are equal.
	 */
	private sortByIntentAndSalience(
		memories: MemoryEntry[],
		intents: QueryIntent[],
		subject: string | null
	): MemoryEntry[] {
		const subjectRe = subject ? new RegExp(`\\b${subject}\\b`, 'i') : null

		return [...memories].sort((a, b) => {
			const baseSa = a.salience ?? (a.importance ? (a.importance - 1) / 4 : 0)
			const baseSb = b.salience ?? (b.importance ? (b.importance - 1) / 4 : 0)

			const boostA = this.computeIntentBoost(a, intents)
			const boostB = this.computeIntentBoost(b, intents)

			// Subject boost: +0.2 if the memory mentions the query subject by name.
			const subjectBoostA = subjectRe ? (subjectRe.test(`${a.title ?? ''} ${a.content}`) ? 0.2 : 0) : 0
			const subjectBoostB = subjectRe ? (subjectRe.test(`${b.title ?? ''} ${b.content}`) ? 0.2 : 0) : 0

			const sa = baseSa + boostA + subjectBoostA
			const sb = baseSb + boostB + subjectBoostB

			if (sb !== sa) return sb - sa
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		})
	}

	/**
	 * Sort by salience desc, then recency desc. No query awareness.
	 * Salience (0–1) is the dynamic multi-factor score from SalienceProcessor.
	 * Importance (1–5) is the static LLM-scored signal used as a fallback.
	 */
	private sortByImportanceAndRecency(memories: MemoryEntry[]): MemoryEntry[] {
		return [...memories].sort((a, b) => {
			const sa = a.salience ?? (a.importance ? (a.importance - 1) / 4 : 0)
			const sb = b.salience ?? (b.importance ? (b.importance - 1) / 4 : 0)
			if (sb !== sa) return sb - sa
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		})
	}

	private assembleContext(sorted: MemoryEntry[], maxTokens: number): string {
		const selected = sorted.slice(0, this.options.maxEntries)
		const parts: string[] = []
		let usedTokens = 0

		for (const memory of selected) {
			const formatted = this.formatEntry(memory)
			const tokenEstimate = this.estimateTokens(formatted)
			if (usedTokens + tokenEstimate > maxTokens) break
			parts.push(formatted)
			usedTokens += tokenEstimate
		}

		return parts.join('\n\n')
	}

	private filterMemories(memories: MemoryEntry[]): MemoryEntry[] {
		return memories.filter((m) => {
			switch (m.type) {
				case 'working':
					return this.options.includeWorking
				case 'semantic':
					return this.options.includeSemantic
				case 'episodic':
					return this.options.includeEpisodic
				default:
					return true
			}
		})
	}
}

export default ContextBuilder
