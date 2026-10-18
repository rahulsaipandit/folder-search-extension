import { leadingSection } from './ranking'
import type { SearchResponse } from './types'

const MAX_MEDIA = 60
const MAX_DOCS = 30

/**
 * Combines per-folder responses (multi-folder search, design §12 phase 3). Hits are ordered by
 * calibrated score, which is comparable across folders because it is a z-score against each
 * folder's own distribution.
 */
export function mergeSearchResponses(responses: SearchResponse[]): SearchResponse {
	if (responses.length === 1) return responses[0]!
	const first = responses[0]
	const media = responses.flatMap(r => r.media).sort((a, b) => b.calibrated - a.calibrated).slice(0, MAX_MEDIA)
	const documents = responses
		.flatMap(r => r.documents)
		.sort((a, b) => b.calibrated - a.calibrated)
		.slice(0, MAX_DOCS)
	const exactStyle = responses.some(r => r.exactStyle)
	return {
		query: first?.query ?? '',
		media,
		documents,
		exactStyle,
		partialIndex: responses.some(r => r.partialIndex),
		tookMs: responses.reduce((n, r) => n + r.tookMs, 0),
		leading: leadingSection(
			media[0]?.calibrated ?? null,
			documents[0]?.calibrated ?? null,
			exactStyle,
			documents.some(d => d.matchedTerms.length > 0)
		),
	}
}
