import type { MemoryEntry, RetentionPolicy } from '../../../types'

/**
 * T0 Salience Processor - zero LLM cost, pure computation.
 *
 * Multi-factor salience formula (from GA + Smriti reference implementations):
 *
 *   salience = recency(0.30) + outcome_boost + entity_linkage(max 0.20)
 *              + procedure_link(0.20) + retrieval_boost(max 0.10)
 *
 * Salience must be recomputed hourly because `recency` decays with time.
 */

export function computeSalience(entry: MemoryEntry): number {
	const now = Date.now()
	const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : now
	const ageHours = (now - createdAt) / 3_600_000

	// Recency: decays linearly over 24 hours (0.30 weight)
	const recency = Math.max(0, 1 - ageHours / 24) * 0.3

	// Outcome boost - failures are prioritized for learning
	const outcomeBoost: Record<string, number> = {
		failure: 0.4,
		resolved: 0.3,
		success: 0.2,
		pending: 0.1,
		abandoned: 0.0,
	}
	const boost = outcomeBoost[entry.outcome ?? 'pending'] ?? 0.1

	// Entity linkage: up to 4 linked entities → max 0.20
	const entityLinkage = Math.min(entry.entities?.length ?? 0, 4) * 0.05

	// Procedure link: +0.20 if linked to a procedure
	const procedureLink = (entry.linkedProcedureIds?.length ?? 0) > 0 ? 0.2 : 0

	// Retrieval boost: each retrieval adds 0.02, capped at 0.10
	const retrievalBoost = Math.min((entry.retrievalCount ?? 0) * 0.02, 0.1)

	const raw = recency + boost + entityLinkage + procedureLink + retrievalBoost
	return Math.min(1, Math.max(0, raw))
}

/**
 * Mutates entry.salience in-place. Returns the new value.
 */
export function recomputeSalience(entry: MemoryEntry): number {
	const s = computeSalience(entry)
	entry.salience = s
	return s
}

// ── Retention policy evaluation ──────────────────────────────────────────────

/**
 * Evaluate which retention policy (if any) should fire for this entry.
 * Implements all 7 policies from the Smriti reference (design doc §9).
 *
 * Priority order (highest first):
 *   1. tombstone_episode - permanent soft-delete
 *   2. compact_raw       - content compression
 *   3. requantize_embeddings - embedding compression (count-based quota proxy)
 *   4. deprecate_procedure - superseded procedures
 *   5. reverify_fact     - low-confidence facts
 *   6. prune_edges       - weak graph edges (evaluated at graph level, not per-entry)
 *   7. demote_episode    - salience decay
 */
export function evaluateRetentionPolicy(entry: MemoryEntry): RetentionPolicy | null {
	const now = Date.now()
	const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : now
	const ageDays = (now - createdAt) / 86_400_000
	const salience = entry.salience ?? computeSalience(entry)

	// 1. Tombstone: very old + very low salience episodics
	if (ageDays > 90 && salience < 0.15 && entry.type === 'episodic') {
		return 'tombstone_episode'
	}

	// 2. Compact raw: moderately old + low salience
	if (ageDays > 30 && salience < 0.3 && (entry.compressionLevel ?? 0) === 0) {
		return 'compact_raw'
	}

	// 3. Requantize: entry has embedding metadata indicating float32, and is old
	if (
		ageDays > 14 &&
		entry.metadata?.embeddingDim === 384 &&
		entry.metadata?.embeddingDtype !== 'uint8'
	) {
		return 'requantize_embeddings'
	}

	// 4. Deprecate procedure: explicitly superseded by a newer version
	if (
		entry.type === 'procedure' &&
		entry.lifecycleState === 'active' &&
		entry.metadata?.supersededBy
	) {
		return 'deprecate_procedure'
	}

	// 5. Reverify fact: low confidence and few source citations
	if (
		(entry.type === 'semantic' || entry.type === 'insight') &&
		(entry.confidence ?? 1) < 0.5 &&
		(entry.sourceIds?.length ?? 0) < 3
	) {
		return 'reverify_fact'
	}

	// 7. Demote: any active entry with low salience (not already compressed/archived)
	if (salience < 0.15 && entry.lifecycleState === 'active') {
		return 'demote_episode'
	}

	return null
}

/**
 * Apply the demote_episode policy: halve the salience score.
 * Mutates the entry.
 */
export function applyDemotePolicy(entry: MemoryEntry): void {
	entry.salience = (entry.salience ?? computeSalience(entry)) * 0.5
	entry.retentionPolicy = 'demote_episode'
	entry.updatedAt = new Date().toISOString()
}

/**
 * Determine whether an entry's embedding should be requantized.
 * Called during batch retention scans; returns true for entries that qualify.
 */
export function shouldRequantize(entry: MemoryEntry, totalEntryCount: number): boolean {
	// Proxy for "storage > 85% quota": trigger requantize when total entries > 8,500
	// (assuming ~85% of a 10,000-entry soft quota).
	const quotaThreshold = 8_500
	if (totalEntryCount < quotaThreshold) return false

	const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / 86_400_000
	// Requantize entries older than 7 days that still have float32 embeddings
	return ageDays > 7 && entry.metadata?.embeddingDtype !== 'uint8'
}
