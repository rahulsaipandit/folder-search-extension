import { describe, expect, it } from 'vitest'

import { mergeSearchResponses } from './merge'
import type { DocumentHit, MediaHit, SearchResponse } from './types'

const doc = (folderId: string, calibrated: number, matchedTerms: string[] = []): DocumentHit => ({
	folderId, fileId: `${folderId}:d${calibrated}`, relPath: 'd', score: 0, calibrated, snippet: '', excerpt: '',
	matchedTerms, matchedChunks: 1, hasPageThumbnail: false,
})
const img = (folderId: string, calibrated: number): MediaHit => ({
	folderId, fileId: `${folderId}:i${calibrated}`, relPath: 'i', kind: 'image', score: 0, calibrated,
})
const resp = (over: Partial<SearchResponse>): SearchResponse => ({
	query: 'q', media: [], documents: [], leading: 'documents', exactStyle: false, partialIndex: false, tookMs: 5, ...over,
})

describe('mergeSearchResponses', () => {
	it('interleaves folders by calibrated score and recomputes the leading section', () => {
		const out = mergeSearchResponses([
			resp({ documents: [doc('a', 3), doc('a', 2.6)], media: [img('a', 3.1)] }),
			resp({ documents: [doc('b', 5)], media: [] }),
		])
		expect(out.documents.map(d => d.folderId)).toEqual(['b', 'a', 'a'])
		expect(out.leading).toBe('documents')
		expect(out.tookMs).toBe(10)
	})

	it('flags a partial index if any folder is still indexing', () => {
		expect(mergeSearchResponses([resp({}), resp({ partialIndex: true })]).partialIndex).toBe(true)
	})

	it('returns a single response untouched', () => {
		const r = resp({ media: [img('a', 4)], leading: 'media' })
		expect(mergeSearchResponses([r])).toBe(r)
	})
})
