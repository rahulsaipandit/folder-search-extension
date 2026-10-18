/**
 * SMRITI-flavoured working memory - bounded priority queue with multi-policy
 * eviction and token-budget awareness.
 *
 * Ported from packages/extension/src/memory/workingMemory.ts - Phase 2 migration.
 * Uses ActivationItem (typed retrieval candidates) instead of the generic MemoryEntry
 * used by the platform-agnostic WorkingMemory class.
 */

import type {
	ActivationItem,
	NodeKind,
	WorkingMemoryBudget,
	StateSnapshot,
} from '../../types'
import { DEFAULT_WM_BUDGET, estimateTokens, truncateToTokens } from '../../types'

// ScoredCandidate is intentionally inlined here to avoid a circular dep on the
// full retrieval type - only the fields WorkingMemory needs are referenced.
interface ScoredCandidate {
	id: string
	kind: NodeKind
	score: number
	content?: string
	summary?: string
}

interface RetrievalPlanLike {
	candidateSets: {
		semantic: ScoredCandidate[]
		episodic: ScoredCandidate[]
		procedural: ScoredCandidate[]
	}
}

export class SmritiWorkingMemory {
	private items: ActivationItem[] = []
	private budget: WorkingMemoryBudget
	private lastAccess = new Map<string, number>()

	constructor(budget?: Partial<WorkingMemoryBudget>) {
		this.budget = { ...DEFAULT_WM_BUDGET, ...budget }
	}

	// ── Public API ────────────────────────────────────────────────────────────

	getAll(): ActivationItem[] { return [...this.items] }

	get(id: string): ActivationItem | undefined {
		return this.items.find(i => i.nodeId === id)
	}

	push(item: ActivationItem): void {
		this.lastAccess.set(item.nodeId, Date.now())
		const existing = this.items.find(i => i.nodeId === item.nodeId)
		if (existing) {
			existing.score = Math.max(existing.score, item.score)
			existing.expiresAt = item.expiresAt ?? existing.expiresAt
			existing.reason = item.reason
			return
		}
		this.items.push(item)
		this.evictIfNeeded()
	}

	pushMultiple(items: ActivationItem[]): void {
		for (const item of items) this.push(item)
	}

	remove(nodeId: string): void {
		this.items = this.items.filter(i => i.nodeId !== nodeId)
		this.lastAccess.delete(nodeId)
	}

	clear(): void { this.items = []; this.lastAccess.clear() }

	pin(nodeId: string): void {
		const item = this.items.find(i => i.nodeId === nodeId)
		if (item) item.isPinned = true
	}

	unpin(nodeId: string): void {
		const item = this.items.find(i => i.nodeId === nodeId)
		if (item) item.isPinned = false
	}

	// ── Budget-Aware Population ───────────────────────────────────────────────

	populateFromCandidates(plan: RetrievalPlanLike, candidates: ScoredCandidate[]): ActivationItem[] {
		const result: ActivationItem[] = []
		let totalTokens = 0
		const byType = new Map<NodeKind, ScoredCandidate[]>()
		for (const c of candidates) {
			const list = byType.get(c.kind) ?? []
			list.push(c)
			byType.set(c.kind, list)
		}

		const addCandidates = (pool: ScoredCandidate[], max: number, reason: ActivationItem['reason']) => {
			for (const c of pool.slice(0, max)) {
				const tokens = estimateTokens(c.content ?? c.summary ?? '')
				const capped = Math.min(tokens, this.budget.maxTokensPerItem)
				if (totalTokens + capped > this.budget.maxTotalTokens) break
				result.push(this.toActivationItem(c, reason))
				totalTokens += capped
			}
		}

		addCandidates(this.takeTop(byType.get('fact' as NodeKind) ?? [], this.budget.maxSemanticItems), this.budget.maxSemanticItems, 'query_match')
		addCandidates(this.takeTop(byType.get('episode' as NodeKind) ?? [], this.budget.maxEpisodicItems), this.budget.maxEpisodicItems, 'query_match')

		const topProc = (byType.get('procedure' as NodeKind) ?? [])[0]
		if (topProc) {
			const tokens = Math.min(estimateTokens(topProc.content ?? ''), this.budget.maxTokensPerItem)
			if (totalTokens + tokens <= this.budget.maxTotalTokens) {
				result.push(this.toActivationItem(topProc, 'task_context'))
				totalTokens += tokens
			}
		}

		for (const c of candidates.filter(c => !result.find(r => r.nodeId === c.id)).sort((a, b) => b.score - a.score)) {
			if (result.length >= this.budget.maxItems) break
			const tokens = Math.min(estimateTokens(c.content ?? c.summary ?? ''), this.budget.maxTokensPerItem)
			if (totalTokens + tokens > this.budget.maxTotalTokens) break
			result.push(this.toActivationItem(c, 'graph_neighbor'))
			totalTokens += tokens
		}

		this.items = result
		return result
	}

	// ── Prompt Formatting ────────────────────────────────────────────────────

	formatForPrompt(): string {
		return this.items.map(item => {
			const kind = item.nodeKind.padEnd(15)
			const content = truncateToTokens(item.content, this.budget.maxTokensPerItem)
			return `[${kind} | score=${item.score.toFixed(2)} | ${item.reason}] ${content}`
		}).join('\n')
	}

	assemblePrompt(
		systemPrompt: string,
		turns: { role: string; content: string }[],
		maxContextTokens: number,
	): { sections: { role: string; content: string }[]; tokenUsage: Record<string, number>; totalTokens: number } {
		const tokenCounters = { system: 0, workingMemory: 0, conversation: 0 }
		const sections: { role: string; content: string }[] = [{ role: 'system', content: systemPrompt }]
		tokenCounters.system = estimateTokens(systemPrompt)

		const wmContent = this.formatForPrompt()
		const wmTokens = estimateTokens(wmContent)
		if (wmTokens <= this.budget.maxTotalTokens) {
			sections.push({ role: 'system', content: `## Working Memory\n${wmContent}` })
			tokenCounters.workingMemory = wmTokens
		} else {
			const compressed = this.compress().map(i =>
				`[${i.nodeKind}] ${truncateToTokens(i.content, this.budget.maxTokensPerItem)}`
			).join('\n')
			sections.push({ role: 'system', content: `## Working Memory (compressed)\n${compressed}` })
			tokenCounters.workingMemory = estimateTokens(compressed)
		}

		const usedTokens = tokenCounters.system + tokenCounters.workingMemory + 512
		const truncatedTurns = this.truncateConversation(turns, maxContextTokens - usedTokens)
		sections.push(...truncatedTurns)
		tokenCounters.conversation = truncatedTurns.reduce((sum, s) => sum + estimateTokens(s.content), 0)

		return { sections, tokenUsage: tokenCounters, totalTokens: Object.values(tokenCounters).reduce((a, b) => a + b, 0) }
	}

	// ── Snapshot Support ─────────────────────────────────────────────────────

	getState(): { items: ActivationItem[]; budget: WorkingMemoryBudget } {
		return { items: [...this.items], budget: { ...this.budget } }
	}

	restoreFrom(state: { items: ActivationItem[]; budget: WorkingMemoryBudget }): void {
		this.items = state.items.map(item => ({ ...item, expiresAt: Date.now() + 60_000 }))
		this.budget = state.budget
	}

	// ── Stats ────────────────────────────────────────────────────────────────

	stats(): { count: number; pinnedCount: number; totalTokens: number } {
		return {
			count: this.items.length,
			pinnedCount: this.items.filter(i => i.isPinned).length,
			totalTokens: this.items.reduce((sum, i) => sum + estimateTokens(i.content ?? ''), 0),
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private evictIfNeeded(): void {
		while (this.items.length > this.budget.maxItems) {
			const evictable = this.items
				.filter(i => !i.isPinned)
				.sort((a, b) => {
					switch (this.budget.evictionPolicy) {
						case 'lru': return (this.lastAccess.get(a.nodeId) ?? 0) - (this.lastAccess.get(b.nodeId) ?? 0)
						case 'lowest_score': return a.score - b.score
						default: return 0 // fifo - evict first unpinned item
					}
				})
			if (evictable.length === 0) break
			this.remove(evictable[0].nodeId)
		}
	}

	private compress(): ActivationItem[] {
		const byType = new Map<string, ActivationItem>()
		for (const item of this.items) {
			const existing = byType.get(item.nodeKind)
			if (!existing || item.score > existing.score) byType.set(item.nodeKind, item)
		}
		return Array.from(byType.values()).slice(0, 3)
	}

	private takeTop(candidates: ScoredCandidate[], n: number): ScoredCandidate[] {
		return [...candidates].sort((a, b) => b.score - a.score).slice(0, n)
	}

	private toActivationItem(c: ScoredCandidate, reason: ActivationItem['reason']): ActivationItem {
		return {
			nodeId: c.id,
			nodeKind: c.kind,
			score: c.score,
			reason,
			content: truncateToTokens(c.content ?? c.summary, this.budget.maxTokensPerItem),
			expiresAt: Date.now() + 120_000,
		}
	}

	private truncateConversation(
		turns: { role: string; content: string }[],
		maxTokens: number,
	): { role: string; content: string }[] {
		let total = 0
		const result: { role: string; content: string }[] = []
		for (const turn of [...turns].reverse()) {
			const tokens = estimateTokens(turn.content)
			if (total + tokens > maxTokens) break
			result.unshift(turn)
			total += tokens
		}
		return result
	}
}
