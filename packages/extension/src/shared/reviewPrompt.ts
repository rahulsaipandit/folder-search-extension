/**
 * "Enjoying Folder Search?" review prompt: when to ask, and where a rating leads.
 * Design: docs/designGuidelines.md §5.
 *
 * Only counters are stored (`chrome.storage.local` via the storage adapter); nothing is sent anywhere.
 * The decision logic is pure so it can be tested without a browser.
 */
import { type KVStore, getStorageAdapter } from './storageAdapter'

export const REVIEW_STORAGE_KEY = 'reviewPrompt'
/** Side panel opens before the first ask. */
export const FIRST_ASK_AT = 5
/** Opens to wait after "Maybe later" (or any dismissal) before asking again. */
export const ASK_GAP = 10
/** Asks after the first one; the prompt is shown at most `1 + MAX_REASKS` times. */
export const MAX_REASKS = 5
/** Ratings at or above this go to the Web Store; lower ones go to the feedback form. */
export const STORE_MIN_RATING = 4

export interface ReviewState {
	/** Side panel opens counted so far. */
	opens: number
	/** The prompt shows when `opens` reaches this. */
	nextAskAt: number
	/** How many times the prompt has been shown. */
	asks: number
	/** `done` once the user rated or sent feedback: never ask again. */
	status: 'pending' | 'done'
}

export const INITIAL_REVIEW_STATE: ReviewState = { opens: 0, nextAskAt: FIRST_ASK_AT, asks: 0, status: 'pending' }

/** Coerces whatever is in storage into a valid state; a corrupt value restarts the count rather than throwing. */
export function parseReviewState(raw: unknown): ReviewState {
	const r = raw as Partial<ReviewState> | null | undefined
	const int = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fallback)
	if (!r || typeof r !== 'object') return { ...INITIAL_REVIEW_STATE }
	return {
		opens: int(r.opens, 0),
		nextAskAt: int(r.nextAskAt, FIRST_ASK_AT),
		asks: int(r.asks, 0),
		status: r.status === 'done' ? 'done' : 'pending',
	}
}

/**
 * Counts one side panel open. When the prompt is due, `show` is true and the ask is recorded
 * immediately with the next ask pushed back by `ASK_GAP`, so dismissing (X, "Maybe later", closing the
 * panel) is already the snooze and needs no further write.
 */
export function applyOpen(state: ReviewState): { state: ReviewState; show: boolean } {
	const opens = state.opens + 1
	const due = state.status === 'pending' && opens >= state.nextAskAt && state.asks < 1 + MAX_REASKS
	if (!due) return { state: { ...state, opens }, show: false }
	return { state: { ...state, opens, asks: state.asks + 1, nextAskAt: opens + ASK_GAP }, show: true }
}

export type RatingRoute = 'store' | 'feedback'

export function routeForRating(rating: number): RatingRoute {
	return rating >= STORE_MIN_RATING ? 'store' : 'feedback'
}

async function load(store: KVStore): Promise<ReviewState> {
	return parseReviewState(await store.get(REVIEW_STORAGE_KEY))
}

/** Counts one open and reports whether to show the prompt. Storage errors propagate to the caller. */
export async function registerOpen(store: KVStore = getStorageAdapter()): Promise<boolean> {
	const { state, show } = applyOpen(await load(store))
	await store.set(REVIEW_STORAGE_KEY, state)
	return show
}

/** The user rated or sent feedback: never ask again. */
export async function markReviewDone(store: KVStore = getStorageAdapter()): Promise<void> {
	await store.set(REVIEW_STORAGE_KEY, { ...(await load(store)), status: 'done' } satisfies ReviewState)
}
