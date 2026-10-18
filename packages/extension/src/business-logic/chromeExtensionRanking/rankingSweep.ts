/**
 * Runs `searchKeywordRank` for tracked keywords and appends the result to their history
 * (design doc §8 items 2 and 4). Two entry points share this: the manual "Check now" button
 * (`checkOneKeyword`) and the standalone `runRankingSweep` utility.
 */

import { searchKeywordRank, searchKeywordRankMany } from './chromeWebStoreClient'
import { loadTrackedExtensions, saveTrackedExtensions } from './storage'
import type { KeywordRankCheck } from './types'

/**
 * Re-loads the latest persisted state, appends one keyword's check to its history, and saves —
 * rather than mutating and persisting a snapshot loaded before an `await`. A sweep does one
 * `await searchKeywordRank(...)` per tracked keyword, which can add up to several seconds total;
 * loading the full list once up front and writing it all back once at the end (the previous shape
 * of both `checkOneKeyword` and `runRankingSweep`) meant any change made by a concurrent "Check
 * now" click — or a second sweep — during that window got silently overwritten by whichever
 * finished last. Reloading right before each individual write keeps the at-risk window a single
 * fetch wide instead of the whole sweep, and merges into whatever is actually latest instead of a
 * stale in-memory copy. Shared by both entry points below so there's one merge-and-persist path,
 * not two copies of the same "find extension → find keyword → append → save" sequence.
 */
function applyKeywordCheck(extensionId: string, keyword: string, check: KeywordRankCheck): void {
	const tracked = loadTrackedExtensions()
	const extensionIndex = tracked.findIndex((t) => t.extension.id === extensionId)
	if (extensionIndex === -1) return
	const keywordIndex = tracked[extensionIndex].keywords.findIndex((k) => k.keyword === keyword)
	if (keywordIndex === -1) return
	const target = tracked[extensionIndex].keywords[keywordIndex]
	tracked[extensionIndex].keywords[keywordIndex] = { ...target, history: [...target.history, check] }
	saveTrackedExtensions(tracked)
}

/** Checks one tracked extension's one keyword right now, appends to history, and persists. */
export async function checkOneKeyword(
	extensionId: string,
	keyword: string,
): Promise<KeywordRankCheck | null> {
	const tracked = loadTrackedExtensions()
	const target = tracked
		.find((t) => t.extension.id === extensionId)
		?.keywords.find((k) => k.keyword === keyword)
	if (!target) return null

	const result = await searchKeywordRank(target.keyword, target.locale, extensionId)
	if (!result) return null

	const { keyword: _k, locale: _l, ...check } = result
	applyKeywordCheck(extensionId, keyword, check)
	return check
}

/** Sweeps every tracked keyword for every tracked extension. Used by the daily scheduled widget. */
export async function runRankingSweep(): Promise<{ checked: number; failed: number }> {
	// Snapshot only to know which (extension, keyword) pairs to check — each result is persisted
	// via applyKeywordCheck against the latest state, not this snapshot, so a concurrent "Check
	// now" click (or an overlapping sweep) can't be clobbered by this sweep's own final write —
	// there no longer is one; every check writes as soon as it completes.
	const tracked = loadTrackedExtensions()
	const requests: { extensionId: string; keyword: string; locale: string }[] = []
	for (const entry of tracked) {
		for (const kw of entry.keywords) {
			requests.push({ extensionId: entry.extension.id, keyword: kw.keyword, locale: kw.locale })
		}
	}

	// searchKeywordRankMany fetches one search-results page per unique (keyword, locale) pair —
	// not one per request — and runs independent fetches concurrently (bounded), rather than one
	// `await` per tracked keyword in sequence: a 20-keyword sweep at ~300-800ms per fetch used to
	// take 6-16s serialized; this is bounded by the slowest single request per concurrency batch
	// instead, and two tracked extensions watching the same keyword/locale no longer double-fetch
	// and double-parse the identical page.
	const results = await searchKeywordRankMany(requests)

	let checked = 0
	let failed = 0
	results.forEach((result, i) => {
		const req = requests[i]
		if (result) {
			const { keyword: _k, locale: _l, ...check } = result
			applyKeywordCheck(req.extensionId, req.keyword, check)
			checked++
		} else {
			console.error('[rankingSweep] Check failed for', req.extensionId, req.keyword)
			failed++
		}
	})

	return { checked, failed }
}
