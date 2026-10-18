import type { MemoryEntry, MemoryType } from '../../types'

/**
 * WorkingMemoryManager - Session-based short-term memory
 *
 * Token-budget-aware, salience-ordered working memory with per-type caps.
 * Replaces the old FIFO-eviction WorkingMemory with salience-based eviction,
 * 6 per-type buckets, and multi-session management.
 *
 * Session IDs follow format: <YYYYMMDDHHMMSS>_<First6CharsOfTitle>
 */

export interface WorkingMemoryOptions {
	maxSize?: number      // default 20
	tokenBudget?: number  // default 4096
	maxPerType?: Partial<Record<MemoryType, number>>
}

const DEFAULT_PER_TYPE: Partial<Record<MemoryType, number>> = {
	episodic: 5,
	semantic: 4,
	insight: 3,
	procedure: 2,
	entity: 2,
	goal: 2,
}

const DEFAULT_MAX_SIZE = 20
const DEFAULT_TOKEN_BUDGET = 4096

// ~3.5 chars per token + 10% overhead (matches ContextBuilder.estimateTokens)
function estimateTokens(text: string): number {
	if (text.length <= 10) return Math.ceil(text.length / 2)
	return Math.ceil((text.length / 3.5) * 1.1)
}

function salienceScore(entry: MemoryEntry): number {
	return entry.salience ?? (entry.importance ? (entry.importance - 1) / 4 : 0)
}

export class WorkingMemoryManager {
	private sessions: Map<string, Map<string, MemoryEntry>> = new Map()
	private readonly maxSize: number
	private readonly tokenBudget: number
	private readonly maxPerType: Partial<Record<MemoryType, number>>

	constructor(options: WorkingMemoryOptions = {}) {
		this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE
		this.tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET
		this.maxPerType = { ...DEFAULT_PER_TYPE, ...(options.maxPerType ?? {}) }
	}

	generateSessionId(title: string): string {
		const timestamp = new Date()
			.toISOString()
			.replace(/[-:]/g, '')
			.slice(0, 14)
		const prefix = title
			.replace(/\s+/g, '')
			.replace(/[^a-zA-Z0-9]/g, '')
			.slice(0, 6)
			.toLowerCase()
		return `${timestamp}_${prefix || 'session'}`
	}

	async getAll(sessionId?: string): Promise<MemoryEntry[]> {
		if (sessionId) {
			return Array.from(this.sessions.get(sessionId)?.values() ?? [])
		}
		const all: MemoryEntry[] = []
		this.sessions.forEach((entries) => all.push(...Array.from(entries.values())))
		return all
	}

	async get(sessionId: string, entryId: string): Promise<MemoryEntry | undefined> {
		return this.sessions.get(sessionId)?.get(entryId)
	}

	async set(entries: MemoryEntry[], sessionId: string): Promise<void> {
		const sessionEntries = new Map<string, MemoryEntry>()
		for (const entry of entries.slice(-this.maxSize)) {
			sessionEntries.set(entry.id, entry)
		}
		this.sessions.set(sessionId, sessionEntries)
		await this.enforceConstraints(sessionId)
	}

	async add(entry: MemoryEntry, sessionId: string): Promise<void> {
		let sessionEntries = this.sessions.get(sessionId)
		if (!sessionEntries) {
			sessionEntries = new Map()
			this.sessions.set(sessionId, sessionEntries)
		}

		// Replace if already present (update in-place)
		if (sessionEntries.has(entry.id)) {
			sessionEntries.set(entry.id, entry)
			return
		}

		sessionEntries.set(entry.id, entry)
		await this.enforceConstraints(sessionId)
	}

	async update(
		sessionId: string,
		entryId: string,
		updates: Partial<MemoryEntry>,
	): Promise<boolean> {
		const sessionEntries = this.sessions.get(sessionId)
		if (!sessionEntries) return false
		const existing = sessionEntries.get(entryId)
		if (!existing) return false
		sessionEntries.set(entryId, { ...existing, ...updates })
		return true
	}

	async remove(sessionId: string, entryId: string): Promise<boolean> {
		return this.sessions.get(sessionId)?.delete(entryId) ?? false
	}

	async clear(sessionId?: string): Promise<void> {
		if (sessionId) {
			this.sessions.delete(sessionId)
		} else {
			this.sessions.clear()
		}
	}

	/** Get all entries for a specific session (synchronous convenience accessor). */
	getForSession(sessionId: string): MemoryEntry[] {
		return Array.from(this.sessions.get(sessionId)?.values() ?? [])
	}

	/** Clear a specific session (synchronous convenience accessor). */
	clearSession(sessionId: string): void {
		this.sessions.delete(sessionId)
	}

	getSessionCount(): number { return this.sessions.size }
	getEntryCount(sessionId: string): number { return this.sessions.get(sessionId)?.size ?? 0 }
	hasSession(sessionId: string): boolean { return this.sessions.has(sessionId) }
	getSessionIds(): string[] { return Array.from(this.sessions.keys()) }

	// Enforce count cap, per-type cap, and token budget - evict lowest-salience first.
	private async enforceConstraints(sessionId: string): Promise<void> {
		const sessionEntries = this.sessions.get(sessionId)
		if (!sessionEntries) return

		// Sort all entries by salience ascending (lowest first = evict first)
		const sorted = Array.from(sessionEntries.values()).sort(
			(a, b) => salienceScore(a) - salienceScore(b),
		)

		for (const candidate of sorted) {
			const entries = Array.from(sessionEntries.values())

			// Count cap
			if (entries.length <= this.maxSize) {
				// Check token budget
				const totalTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0)
				if (totalTokens <= this.tokenBudget) {
					// Check per-type caps
					const typeCounts: Partial<Record<MemoryType, number>> = {}
					for (const e of entries) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1
					const maxForType = this.maxPerType[candidate.type]
					if (!maxForType || (typeCounts[candidate.type] ?? 0) <= maxForType) {
						break // All constraints satisfied
					}
				}
			}

			// Evict this candidate
			sessionEntries.delete(candidate.id)
		}
	}
}

/** Named alias kept for backward compatibility with MemoryService. */
export { WorkingMemoryManager as WorkingMemory }

export default WorkingMemoryManager
