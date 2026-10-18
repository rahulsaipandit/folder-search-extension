/**
 * Type-aware hybrid retrieval engine.
 * Phase 4 - ported from packages/extension/src/memory/retrieval.ts.
 *
 * Intent classifier → candidate generation → feature scoring → RRF/weighted
 * fusion → MMR diversity → working-memory population.
 *
 * Storage is injected via IRetrievalDataSources so the engine is usable with
 * any IDB backend (extension's repos, packages/memory IDB stores, or mocks).
 */

import type {
	EpisodeRecord,
	EntityRecord,
	FactRecord,
	ProcedureRecord,
	ProcedureStep,
	ProcedureVersionRecord,
	RetrievalIntent,
	RetrievalPlan,
	ScoredCandidate,
} from '../../types'
import type { IProceduralStore } from '../../interfaces/IProceduralStore'

// ── Data source interfaces ────────────────────────────────────────────────────

export interface ISemanticDataSource {
	getFacts(): Promise<FactRecord[]>
	getEntities(): Promise<EntityRecord[]>
}

export interface IEpisodicDataSource {
	getRecentEpisodes(limit: number): Promise<EpisodeRecord[]>
	getEpisodesBySalience(threshold: number): Promise<EpisodeRecord[]>
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class RetrievalEngine {
	private semantic: ISemanticDataSource
	private episodic: IEpisodicDataSource
	private procedural: IProceduralStore

	constructor(semantic: ISemanticDataSource, episodic: IEpisodicDataSource, procedural: IProceduralStore) {
		this.semantic = semantic
		this.episodic = episodic
		this.procedural = procedural
	}

	// ── Main entry ─────────────────────────────────────────────────────────────

	async retrieve(query: string, intent?: RetrievalIntent): Promise<RetrievalPlan> {
		const resolvedIntent = intent ?? this.classifyIntent(query)

		const plan: RetrievalPlan = {
			query,
			intent: resolvedIntent,
			candidateSets: { semantic: [], episodic: [], procedural: [] },
			scoringWeights: this.weightsForIntent(resolvedIntent),
			fusionStrategy: 'weighted_linear',
			diversityWindow: 0.5,
			maxResults: {
				semantic: resolvedIntent === 'factual' ? 5 : 3,
				episodic: resolvedIntent === 'experiential' ? 3 : 2,
				procedural: resolvedIntent === 'procedure' ? 2 : 1,
			},
		}

		await this.generateCandidates(plan)

		for (const key of ['semantic', 'episodic', 'procedural'] as const) {
			plan.candidateSets[key] = plan.candidateSets[key]
				.map(c => this.scoreCandidate(c, plan))
				.sort((a, b) => b.score - a.score)
		}

		const fused = this.fuseCandidates(plan)
		const diverse = this.diversify(fused, plan.diversityWindow)

		const result: RetrievalPlan['candidateSets'] = { semantic: [], episodic: [], procedural: [] }
		for (const c of diverse) {
			if (c.kind === 'fact' || c.kind === 'entity' || c.kind === 'topic') {
				if (result.semantic.length < plan.maxResults.semantic) result.semantic.push(c)
			} else if (c.kind === 'episode') {
				if (result.episodic.length < plan.maxResults.episodic) result.episodic.push(c)
			} else if (c.kind === 'procedure' || c.kind === 'procedureVersion') {
				if (result.procedural.length < plan.maxResults.procedural) result.procedural.push(c)
			}
		}

		return { ...plan, candidateSets: result }
	}

	// ── Intent classification ─────────────────────────────────────────────────

	private classifyIntent(query: string): RetrievalIntent {
		const q = query.toLowerCase()
		const proceduralWords = ['how to', 'steps', 'procedure', 'workflow', 'process',
			'first', 'then', 'before', 'after', 'check', 'run', 'deploy', 'configure']
		const experientialWords = ['what happened', 'previous', 'last time', 'before',
			'failure', 'error', 'mistake', 'outcome', 'result', 'episode', 'remember']
		const factualWords = ['what is', 'who is', 'define', 'explain', 'fact',
			'tell me about', 'describe', 'meaning', 'purpose']

		const ps = proceduralWords.filter(w => q.includes(w)).length
		const es = experientialWords.filter(w => q.includes(w)).length
		const fs = factualWords.filter(w => q.includes(w)).length

		if (ps > es && ps > fs) return 'procedure'
		if (es > ps && es > fs) return 'experiential'
		if (fs >= ps && fs >= es) return 'factual'
		return 'mixed'
	}

	private weightsForIntent(intent: RetrievalIntent): RetrievalPlan['scoringWeights'] {
		switch (intent) {
			case 'factual': return { similarity: 0.4, recency: 0.1, salience: 0.1, reliability: 0.3, novelty: 0.05, supersession: 0.05 }
			case 'experiential': return { similarity: 0.2, recency: 0.3, salience: 0.3, reliability: 0.1, novelty: 0.05, supersession: 0.05 }
			case 'procedure': return { similarity: 0.3, recency: 0.1, salience: 0.1, reliability: 0.3, novelty: 0.05, supersession: 0.15 }
			case 'mixed':
			default: return { similarity: 0.3, recency: 0.2, salience: 0.2, reliability: 0.15, novelty: 0.1, supersession: 0.05 }
		}
	}

	// ── Candidate generation ──────────────────────────────────────────────────

	private async generateCandidates(plan: RetrievalPlan): Promise<void> {
		const queryTerms = plan.query.toLowerCase().split(/\s+/).filter(t => t.length > 2)

		const [facts, entities, episodes, procedures] = await Promise.all([
			this.semantic.getFacts(),
			this.semantic.getEntities(),
			this.episodic.getRecentEpisodes(200),
			this.procedural.getAllProcedures(),
		])

		for (const fact of facts) {
			const score = this.keywordMatch(fact.statement, queryTerms)
			if (score > 0) plan.candidateSets.semantic.push({ id: fact.id, kind: 'fact', score, content: fact.statement, metadata: { confidence: fact.confidence, entityIds: fact.entityIds } })
		}

		for (const entity of entities) {
			const score = this.keywordMatch(entity.name, queryTerms)
			if (score > 0) plan.candidateSets.semantic.push({ id: entity.id, kind: 'entity', score, content: entity.description ?? entity.name, metadata: { entityType: entity.entityType } })
		}

		for (const ep of episodes) {
			const score = this.keywordMatch(ep.summary, queryTerms) * 0.5 + ep.salience * 0.5
			if (score > 0.1) plan.candidateSets.episodic.push({ id: ep.id, kind: 'episode', score, summary: ep.summary, metadata: { outcome: ep.outcome, salience: ep.salience, timestamp: ep.timestamp } })
		}

		for (const proc of procedures) {
			const score = this.keywordMatch(proc.name, queryTerms) * 0.6 +
				proc.reliabilityScore * 0.2 +
				(proc.status === 'deprecated' ? -0.5 : 0)
			if (score > 0.1) {
				const versionRecords = await this.procedural.getVersionHistory(proc.id)
				const latestVersion = versionRecords.sort((a: ProcedureVersionRecord, b: ProcedureVersionRecord) => b.version - a.version)[0]
				plan.candidateSets.procedural.push({
					id: proc.id, kind: 'procedure', score,
					content: latestVersion?.steps.map((s: ProcedureStep) => s.name).join(', ') ?? proc.name,
					metadata: { reliability: proc.reliabilityScore, status: proc.status, domain: proc.domain, superseded: proc.status === 'deprecated' },
				})
			}
		}
	}

	// ── Scoring ───────────────────────────────────────────────────────────────

	private scoreCandidate(candidate: ScoredCandidate, plan: RetrievalPlan): ScoredCandidate {
		const w = plan.scoringWeights
		const sim = candidate.score

		let recency = 0.5
		if (candidate.metadata?.timestamp) {
			const ageHours = (Date.now() - (candidate.metadata.timestamp as number)) / 3_600_000
			recency = Math.max(0, 1 - ageHours / 72)
		}

		let reliability = 0.5
		if (candidate.metadata?.confidence) reliability = candidate.metadata.confidence as number
		if (candidate.metadata?.reliability) reliability = candidate.metadata.reliability as number

		const supersessionPenalty = candidate.metadata?.superseded ? 1
			: candidate.metadata?.status === 'deprecated' ? 0.8 : 0

		const score = w.similarity * sim +
			w.recency * recency +
			w.salience * ((candidate.metadata?.salience as number) ?? 0.5) +
			w.reliability * reliability +
			w.novelty * 0.1 -
			w.supersession * supersessionPenalty

		return { ...candidate, score: Math.max(0, Math.min(1, score)) }
	}

	// ── Fusion ────────────────────────────────────────────────────────────────

	private fuseCandidates(plan: RetrievalPlan): ScoredCandidate[] {
		const all = [
			...plan.candidateSets.semantic,
			...plan.candidateSets.episodic,
			...plan.candidateSets.procedural,
		]

		if (plan.fusionStrategy === 'rrf') {
			const rankScores = new Map<string, number>()
			for (const candidates of Object.values(plan.candidateSets)) {
				for (let i = 0; i < candidates.length; i++) {
					rankScores.set(candidates[i].id, (rankScores.get(candidates[i].id) ?? 0) + 1 / (60 + i + 1))
				}
			}
			return all.map(c => ({ ...c, score: rankScores.get(c.id) ?? c.score })).sort((a, b) => b.score - a.score)
		}

		return all.sort((a, b) => b.score - a.score)
	}

	// ── MMR diversity ─────────────────────────────────────────────────────────

	private diversify(candidates: ScoredCandidate[], lambda: number): ScoredCandidate[] {
		if (candidates.length <= 3) return candidates
		const selected: ScoredCandidate[] = []
		const remaining = [...candidates]
		selected.push(remaining.shift()!)

		while (selected.length < Math.min(10, remaining.length)) {
			let bestIdx = -1, bestScore = -Infinity
			for (let i = 0; i < remaining.length; i++) {
				const maxSim = selected.reduce((m, s) => Math.max(m, this.candidateSimilarity(remaining[i], s)), 0)
				const mmr = lambda * remaining[i].score - (1 - lambda) * maxSim
				if (mmr > bestScore) { bestScore = mmr; bestIdx = i }
			}
			if (bestIdx >= 0) selected.push(remaining.splice(bestIdx, 1)[0])
			else break
		}
		return selected
	}

	private candidateSimilarity(a: ScoredCandidate, b: ScoredCandidate): number {
		if (a.kind !== b.kind) return 0
		const aWords = new Set((a.content ?? a.summary ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 3))
		const bWords = new Set((b.content ?? b.summary ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 3))
		const intersection = [...aWords].filter(w => bWords.has(w))
		const union = new Set([...aWords, ...bWords])
		return union.size === 0 ? 0 : intersection.length / union.size
	}

	// ── Utility ───────────────────────────────────────────────────────────────

	private keywordMatch(text: string, terms: string[]): number {
		const lower = text.toLowerCase()
		let matches = 0
		for (const term of terms) {
			if (lower.includes(term)) matches += term.length / lower.length
		}
		return Math.min(1, matches)
	}
}
