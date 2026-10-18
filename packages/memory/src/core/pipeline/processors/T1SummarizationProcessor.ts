import type { LLM } from '@page-agent/llms'

import type { MemoryEntry, TieredLLMConfig } from '../../../types'

/**
 * T1 Summarization Processor - uses a small local model (Ollama / MLC) for:
 * 1. Importance scoring (1–5)
 * 2. L0 → L1 summarization (episode → semantic memory)
 * 3. Tagging and structured extraction
 *
 * Falls back gracefully to T3 (no-LLM) if the model is unavailable.
 */

export interface SummarizationResult {
	summary: string
	importance: number // 1–5
	tags: string[]
	title: string
}

export class T1SummarizationProcessor {
	private llm: LLM | null = null
	private readonly config: TieredLLMConfig

	constructor(config: TieredLLMConfig) {
		this.config = config
	}

	async initialize(): Promise<void> {
		if (!this.config.t1) return

		try {
			// Dynamically import to avoid loading @page-agent/llms when T1 is not configured
			const { LLM } = await import('@page-agent/llms')
			this.llm = new LLM({
				baseURL: this.config.t1.baseURL,
				model: this.config.t1.model,
				apiKey: this.config.t1.apiKey ?? '',
				temperature: 0.2,
				maxRetries: 1,
			})
		} catch {
			// T1 unavailable - silently fall through to T3
			console.warn('[Memory] T1 LLM unavailable - summarization disabled, falling back to T3')
		}
	}

	/** Score the importance of an episodic memory (1–5). T0-only fallback if LLM absent. */
	async scoreImportance(entry: MemoryEntry): Promise<number> {
		if (!this.llm) return this.t3ScoreImportance(entry)

		const prompt = buildImportancePrompt(entry)

		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[{ role: 'user', content: prompt }],
				{
					score: {
						description: 'Return a JSON object with a single "importance" field (integer 1-5)',
						inputSchema: {
							parse: (v: unknown) => v as { importance: number },
						} as never,
						execute: async (args: { importance: number }) => args,
					},
				},
				abort.signal
			)
			const score = (result.toolResult as { importance: number })?.importance
			return typeof score === 'number' ? Math.min(5, Math.max(1, Math.round(score))) : 3
		} catch {
			return this.t3ScoreImportance(entry)
		}
	}

	/** Summarize an L0 episodic entry into a shorter L1 semantic memory. */
	async summarize(entry: MemoryEntry): Promise<SummarizationResult> {
		if (!this.llm) return this.t3Summarize(entry)

		const prompt = buildSummarizationPrompt(entry)

		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[{ role: 'user', content: prompt }],
				{
					summarize: {
						description:
							'Return a JSON object with: title (string), summary (string), importance (1-5 integer), tags (string[])',
						inputSchema: {
							parse: (v: unknown) => v as SummarizationResult,
						} as never,
						execute: async (args: SummarizationResult) => args,
					},
				},
				abort.signal
			)
			return result.toolResult as SummarizationResult
		} catch {
			return this.t3Summarize(entry)
		}
	}

	// ── T3 fallbacks (no LLM) ──────────────────────────────────────────────────

	private t3ScoreImportance(entry: MemoryEntry): number {
		// Heuristic: length proxy + outcome signals
		const wordCount = entry.content.split(/\s+/).length
		if (wordCount < 20) return 2
		if (entry.outcome === 'failure') return 4
		if (entry.outcome === 'resolved' || entry.outcome === 'success') return 3
		return 2
	}

	private t3Summarize(entry: MemoryEntry): SummarizationResult {
		// Truncate to first 200 chars as a no-LLM summary
		const summary = entry.content.slice(0, 200).trim()
		const title =
			entry.title ?? entry.content.split(/[.!?\n]/)[0]?.slice(0, 80).trim() ?? 'Memory'
		return {
			summary,
			title,
			importance: this.t3ScoreImportance(entry),
			tags: entry.tags ?? [],
		}
	}
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildImportancePrompt(entry: MemoryEntry): string {
	return `You are a cognitive importance scorer. Rate the following memory on a scale of 1-5:
1 = trivial / low signal
2 = minor note
3 = moderately important
4 = highly important (failure, key decision, important insight)
5 = critical (must not be forgotten)

Memory type: ${entry.type}
Content: ${entry.content.slice(0, 500)}
Outcome: ${entry.outcome ?? 'unknown'}

Return a JSON object: { "importance": <integer 1-5> }`
}

function buildSummarizationPrompt(entry: MemoryEntry): string {
	return `Summarize the following memory into a concise semantic note.

Memory type: ${entry.type}
Content: ${entry.content.slice(0, 1000)}
Tags: ${(entry.tags ?? []).join(', ')}

Return a JSON object:
{
  "title": "<short title>",
  "summary": "<2-3 sentence summary>",
  "importance": <integer 1-5>,
  "tags": ["<tag1>", "<tag2>"]
}`
}
