import { describe, expect, it } from 'vitest'

import {
	ASK_GAP,
	FIRST_ASK_AT,
	INITIAL_REVIEW_STATE,
	MAX_REASKS,
	markReviewDone,
	parseReviewState,
	registerOpen,
	routeForRating,
} from './reviewPrompt'
import type { KVStore } from './storageAdapter'

function memoryStore(): KVStore & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>()
	return {
		data,
		get: async k => data.get(k),
		set: async (k, v) => void data.set(k, v),
		remove: async k => void data.delete(k),
		clear: async () => data.clear(),
	}
}

/** Opens the panel `n` times and returns the open numbers (1-based) on which the prompt showed. */
async function shownOn(store: KVStore, n: number, onShow?: () => Promise<void>): Promise<number[]> {
	const shown: number[] = []
	for (let i = 1; i <= n; i++) {
		if (await registerOpen(store)) {
			shown.push(i)
			await onShow?.()
		}
	}
	return shown
}

describe('review prompt schedule', () => {
	it('asks on the 5th open, then every 10 opens, 5 re-asks at most', async () => {
		expect(await shownOn(memoryStore(), 200)).toEqual([5, 15, 25, 35, 45, 55])
	})

	it('matches the documented constants', () => {
		expect(FIRST_ASK_AT).toBe(5)
		expect(ASK_GAP).toBe(10)
		expect(MAX_REASKS).toBe(5)
	})

	it('never asks again once the user rated or sent feedback', async () => {
		const store = memoryStore()
		expect(await shownOn(store, 5)).toEqual([5])
		await markReviewDone(store)
		expect(await shownOn(store, 100)).toEqual([])
	})

	it('keeps counting opens after done, so the state stays consistent', async () => {
		const store = memoryStore()
		await shownOn(store, 5)
		await markReviewDone(store)
		await shownOn(store, 3)
		expect(parseReviewState(store.data.get('reviewPrompt')).opens).toBe(8)
	})

	it('restarts from scratch on a corrupt stored value instead of throwing', async () => {
		const store = memoryStore()
		store.data.set('reviewPrompt', 'garbage')
		expect(await shownOn(store, 5)).toEqual([5])
		expect(parseReviewState({ opens: -3, nextAskAt: 'x', asks: 1.5, status: 'weird' })).toEqual(INITIAL_REVIEW_STATE)
	})
})

describe('routeForRating', () => {
	it('sends 4-5 stars to the store and 1-3 to the feedback form', () => {
		expect([1, 2, 3, 4, 5].map(routeForRating)).toEqual(['feedback', 'feedback', 'feedback', 'store', 'store'])
	})
})
