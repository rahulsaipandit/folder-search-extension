/**
 * Shared types for the Chrome Extension Ranking Tracker's business logic.
 * See packages/extension/docs/AgentLibraryFeatures/designChromeExtensionRanking.md for the
 * requirements and open questions these implement.
 */

export type ExtensionRankingGoal = 'boost-ranking' | 'keyword-research' | 'monitor-rankings'

/** Result of a Chrome Web Store detail-page lookup (design doc §4, §8 item 1). */
export interface ChromeExtensionDetail {
	/** 32-character Chrome Web Store extension id. */
	id: string
	name: string
	description: string
	iconUrl?: string
	/** 0-5, parsed from the page's rendered "X out of 5 stars" text. Undefined if not found. */
	rating?: number
	/** Parsed from the page's rendered "N ratings" text. Undefined if not found. */
	reviewCount?: number
	/**
	 * Parsed from the page's rendered "N users" text. Undefined if not found.
	 *
	 * This is the Chrome Web Store's "Weekly Users" metric, NOT a total-install count — it's
	 * browser-based, not user-based, so one person signed into Chrome Sync across multiple devices
	 * inflates this number (design doc §13: one real install can show up as several "weekly users").
	 * Do not treat this as install count, and do not compute installs as installs-minus-uninstalls —
	 * those two figures use different counting units on Google's side and aren't comparable.
	 */
	userCount?: number
}

/** A tracked extension + its keyword watchlist, persisted locally (design doc §3, §8 item 3). */
export interface TrackedExtension {
	extension: ChromeExtensionDetail
	goals: ExtensionRankingGoal[]
	keywords: TrackedKeyword[]
	addedAt: number
}

export interface TrackedKeyword {
	keyword: string
	/** BCP-47-ish locale code, e.g. "en". Matches the "Search Market" picker in the onboarding UI. */
	locale: string
	addedAt: number
	/** Rank-check history, oldest first (design doc §8 item 2, §8 item 4). Empty until the first check. */
	history: KeywordRankCheck[]
}

/**
 * One entry in a search-results page (design doc §8 item 2). Deliberately thinner than
 * `ChromeExtensionDetail` — search-result cards don't expose review count or user count, only
 * name, average rating, and badge state (verified live against a real search page).
 */
export interface RankedExtension {
	id: string
	name: string
	/** 0-5. Undefined if the page's rating markup wasn't found for this card. */
	rating?: number
	featured: boolean
	/**
	 * From the card's `aria-label="Published by verified publisher"`. This may be the same
	 * designation the store's own marketing calls the "Established Publisher" badge (design doc
	 * §9 item 6) — not independently confirmed against Google's badge documentation, so this field
	 * is named after the accessible label actually observed, not the marketing name.
	 */
	verifiedPublisher: boolean
}

/** Result of one `searchKeywordRank` call — a single rank check, before it's appended to history. */
export interface KeywordRankResult {
	keyword: string
	locale: string
	checkedAt: number
	/** 1-based rank, or `null` if the tracked extension wasn't found among `results`. */
	position: number | null
	/** How many results were actually returned/scanned (currently observed: up to 10 per query). */
	totalResultsScanned: number
	results: RankedExtension[]
}

/**
 * One historical rank check, as stored in `TrackedKeyword.history`. Same shape as
 * `KeywordRankResult` minus `keyword`/`locale` (redundant with the parent `TrackedKeyword`).
 */
export type KeywordRankCheck = Omit<KeywordRankResult, 'keyword' | 'locale'>
