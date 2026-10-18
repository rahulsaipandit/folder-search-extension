/**
 * ImportanceProcessor - Scores memory importance using hybrid keyword + LLM approach
 *
 * Ported from GA's lib/memory/processors/ImportanceProcessor.ts.
 * Rates memories 1-5 with detailed reasoning.
 */

import type { IMemoryProcessor, ProcessorContext, CreateableMemoryEntry } from '../IMemoryProcessor'
import type { MemoryEntry } from '../../../types'

/**
 * LLM service interface for importance scoring
 */
export interface LLMService {
	complete(
		prompt: string,
		options?: {
			maxTokens?: number
			temperature?: number
			responseFormat?: { type: string }
		}
	): Promise<string>
}

/**
 * Memory heuristics configuration
 * Exported for use in external services.
 */
export const MEMORY_HEURISTICS = {
	SCORING: {
		CRITICAL: {
			KEYWORDS: ['important', 'critical', 'urgent', 'asap'],
			PATTERNS: [] as RegExp[],
			BASE_IMPORTANCE: 10,
			TAG: 'critical',
		},
		HIGH: {
			KEYWORDS: [
				'goal',
				'preference',
				'remember',
				'never forget',
				'career',
				'job change',
				'quitting',
				'resigning',
				'data scientist',
				'teaching job',
				'become',
			],
			PATTERNS: [] as RegExp[],
			BASE_IMPORTANCE: 9,
			TAG: 'high-priority',
		},
		IDENTITY: {
			KEYWORDS: ['i am', 'my name', 'i live', 'i work'],
			PATTERNS: [/(?:my|i)\s+(?:name|live|work|job|career)/i],
			BASE_IMPORTANCE: 9,
			TAG: 'identity',
		},
		EMOTIONAL: {
			KEYWORDS: ['feel', 'happy', 'sad', 'love', 'hate'],
			PATTERNS: [] as RegExp[],
			BASE_IMPORTANCE: 7,
			TAG: 'emotional',
		},
		TASK: {
			KEYWORDS: ['todo', 'task', 'remind me', "don't forget"],
			PATTERNS: [] as RegExp[],
			BASE_IMPORTANCE: 8,
			TAG: 'task',
		},
	},
	FALLBACK: {
		CRITICAL: { KEYWORDS: ['important', 'critical', 'asap'], BUMP: 3, TAG: 'critical' },
		HIGH: { KEYWORDS: ['goal', 'preference', 'remember'], BUMP: 2, TAG: 'high-priority' },
		PERSONAL: { KEYWORDS: ['i am', 'my name', 'i live'], BUMP: 2, TAG: 'personal' },
	},
	IMPORTANT_KEYWORDS: ['name', 'i am', "i'm", 'goal', 'preference', 'important', 'remember'],
	CLASSIFICATION: {
		IDENTITY_TRIGGERS: ['i am', "i'm", 'my name', 'i live', 'i work', 'i study', 'i was born'],
		PREFERENCE_TRIGGERS: ['i prefer', 'i like', 'i love', 'i hate', 'i want', 'my favorite'],
		TEMPORAL_EXCLUSIONS: [
			'age',
			'old',
			'years old',
			'birthday',
			'yesterday',
			'last week',
			'last month',
			'last year',
		],
	},
}

export class ImportanceProcessor implements IMemoryProcessor {
	name = 'importance-scorer'
	description = 'Rates memory importance 1-5 using hybrid keyword + LLM approach'

	private llmService: LLMService | null
	private options: { timeoutMs?: number; useCache?: boolean }
	private timeoutMs: number
	private useCache: boolean
	private cache: Map<string, { importance: number; reasoning: string; suggestedTags: string[] }>

	constructor(
		llmService: LLMService | null,
		options: {
			timeoutMs?: number
			useCache?: boolean
		} = {}
	) {
		this.llmService = llmService
		this.options = options
		this.timeoutMs = options.timeoutMs || 30000
		this.useCache = options.useCache !== false
		this.cache = new Map()
	}

	/**
	 * Check if processing should run - only if importance is not yet set
	 */
	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		return entry.importance === undefined
	}

	/**
	 * Process entry - calculate and assign importance score
	 */
	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | null> {
		const { content } = entry

		// Check cache first - update in-place to avoid creating a duplicate entry
		const cacheKey = this.getCacheKey(content)
		if (this.useCache && this.cache.has(cacheKey)) {
			const cached = this.cache.get(cacheKey)!
			await context.memory.update(entry.id, {
				importance: cached.importance,
				metadata: {
					...entry.metadata,
					importance_reasoning: cached.reasoning,
					suggestedTags: cached.suggestedTags,
				},
			})
			return null
		}

		// 1. FAST PATH: Keyword-based pre-scoring
		const preScoreResult = this.preScore(content)

		// 2. COGNITIVE PATH: LLM analysis
		let llmResult: {
			importance: number
			reasoning: string
			keyInsights: string[]
			suggestedTags: string[]
			confidence: number
		} | null = null

		const llmService = this.llmService ?? context.llmService
		if (llmService) {
			try {
				const prompt = this.getImportancePrompt(content)
				const response = await this.callLLMWithTimeout(prompt, this.timeoutMs, llmService)
				llmResult = this.parseLLMResponse(response)
				llmResult = this.validateResult(llmResult)
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error)
				console.warn('[ImportanceProcessor] LLM scoring failed:', msg)
			}
		}

		// 3. HYBRID MERGE: Combine both results
		const finalResult = this.mergeScoring(preScoreResult, llmResult, content)

		// Cache result
		if (this.useCache) {
			this.cache.set(cacheKey, finalResult)
			this.manageCacheSize()
		}

		// Update original entry in-place, return null (no new entry)
		await context.memory.update(entry.id, {
			importance: finalResult.importance,
			confidence: finalResult.confidence,
			metadata: {
				...entry.metadata,
				importance_reasoning: finalResult.reasoning,
				keyInsights: finalResult.keyInsights,
				suggestedTags: finalResult.suggestedTags,
			},
		})

		return null
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

	private getImportancePrompt(content: string): string {
		return `Analyze the following memory and rate its importance from 1-10.
Consider:
- Is it about the user's identity, goals, or preferences?
- Does it contain emotional or personal information?
- Is it a task or reminder?
- Is it just routine conversation?

Memory: ${content.slice(0, 500)}

Respond with JSON:
{
  "importance": <1-10>,
  "reasoning": "<brief explanation>",
  "keyInsights": ["<insight1>", "<insight2>"],
  "suggestedTags": ["<tag1>", "<tag2>"],
  "confidence": <0-1>
}`
	}

	private preScore(content: string): {
		importance: number
		triggers: string[]
		isHighConfidence: boolean
	} {
		const lower = content.toLowerCase()
		const triggers: string[] = []
		let baseImportance = 3

		const { SCORING } = MEMORY_HEURISTICS

		for (const categoryKey in SCORING) {
			const category = SCORING[categoryKey as keyof typeof SCORING]
			let matched = false

			if (category.KEYWORDS && category.KEYWORDS.some((kw: string) => lower.includes(kw))) {
				matched = true
			}

			if (
				category.PATTERNS &&
				(category.PATTERNS as RegExp[]).some((regex: RegExp) => regex.test(content))
			) {
				matched = true
			}

			if (matched) {
				triggers.push(category.TAG)
				baseImportance = Math.max(baseImportance, category.BASE_IMPORTANCE)
			}
		}

		// Convert 1-10 scale to 1-5 scale
		const normalizedImportance = Math.ceil(baseImportance / 2)

		return {
			importance: normalizedImportance,
			triggers,
			isHighConfidence: triggers.length > 0,
		}
	}

	private mergeScoring(
		preScore: { importance: number; triggers: string[]; isHighConfidence: boolean },
		llmScore: {
			importance: number
			reasoning: string
			keyInsights: string[]
			suggestedTags: string[]
			confidence: number
		} | null,
		content: string
	): {
		importance: number
		reasoning: string
		keyInsights: string[]
		suggestedTags: string[]
		confidence: number
	} {
		if (!llmScore) {
			const fallback = this.fallbackScoring(content)
			return {
				importance: Math.max(fallback.importance, preScore.importance),
				reasoning: fallback.reasoning,
				keyInsights: fallback.keyInsights,
				suggestedTags: [...new Set([...fallback.suggestedTags, ...preScore.triggers])],
				confidence: 0.5,
			}
		}

		// Convert LLM 1-10 to 1-5 scale
		const llmImportance = Math.ceil(llmScore.importance / 2)

		// LLM is primary, but keyword triggers can "bump" importance
		const mergedImportance = preScore.isHighConfidence
			? Math.max(llmImportance, preScore.importance)
			: llmImportance

		return {
			importance: mergedImportance,
			reasoning: llmScore.reasoning,
			keyInsights: llmScore.keyInsights,
			suggestedTags: [...new Set([...llmScore.suggestedTags, ...preScore.triggers])],
			confidence: llmScore.confidence,
		}
	}

	private async callLLMWithTimeout(
		prompt: string,
		timeoutMs: number,
		llmService: LLMService | { complete(prompt: string): Promise<string> }
	): Promise<string> {
		const timeoutPromise = new Promise<string>((_, reject) => {
			setTimeout(() => reject(new Error('LLM call timed out')), timeoutMs)
		})

		const llmPromise = llmService.complete(prompt, {
			maxTokens: 512,
			temperature: 0.3,
			responseFormat: { type: 'json' },
		} as Parameters<LLMService['complete']>[1])

		return Promise.race([llmPromise, timeoutPromise])
	}

	private parseLLMResponse(response: string): any {
		if (!response) {
			throw new Error('Empty response from LLM')
		}

		const jsonMatch = response.match(/\{[\s\S]*\}/)
		if (!jsonMatch) {
			throw new Error('No JSON found in LLM response')
		}

		try {
			return JSON.parse(jsonMatch[0])
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to parse JSON: ${msg}`)
		}
	}

	private validateResult(result: any): any {
		let importance = Math.round(result.importance)
		if (isNaN(importance) || importance < 1) importance = 3
		if (importance > 10) importance = 10

		const reasoning = result.reasoning || 'No reasoning provided'
		const keyInsights = Array.isArray(result.keyInsights) ? result.keyInsights : []
		const suggestedTags = Array.isArray(result.suggestedTags) ? result.suggestedTags : []

		let confidence = result.confidence
		if (isNaN(confidence) || confidence < 0) confidence = 0.5
		if (confidence > 1) confidence = 1

		return { importance, reasoning, keyInsights, suggestedTags, confidence }
	}

	private fallbackScoring(content: string): {
		importance: number
		reasoning: string
		keyInsights: string[]
		suggestedTags: string[]
	} {
		const lower = content.toLowerCase()
		const words = content.split(/\s+/).length

		let importance = 3
		let reasoning = 'Routine interaction'
		const keyInsights: string[] = []
		let suggestedTags = ['conversation']

		if (words > 200) {
			importance = 6
			reasoning = 'Significant detail in interaction'
			keyInsights.push('Detailed exchange')
		}

		const { FALLBACK, SCORING, IMPORTANT_KEYWORDS } = MEMORY_HEURISTICS

		for (const levelKey in FALLBACK) {
			const level = FALLBACK[levelKey as keyof typeof FALLBACK]
			if (level.KEYWORDS.some((kw: string) => lower.includes(kw))) {
				importance = Math.min(10, importance + level.BUMP)
				reasoning = `Contains ${levelKey.toLowerCase()} information`
				suggestedTags.push(level.TAG)
				if (levelKey === 'CRITICAL' || levelKey === 'HIGH') {
					keyInsights.push(levelKey === 'CRITICAL' ? 'Personal revelation' : 'Preference indicated')
				}
			}
		}

		// Identity detection
		const identityCategory = SCORING.IDENTITY
		const hasIdentityPattern = identityCategory.PATTERNS?.some((regex: RegExp) => regex.test(content))
		const hasIdentityKeyword = identityCategory.KEYWORDS?.some((kw: string) => lower.includes(kw))
		const hasImportantKeyword = IMPORTANT_KEYWORDS?.some(
			(kw: string) =>
				lower.includes(kw) &&
				(kw.includes('name') || kw.includes('i am') || kw.includes("i'm"))
		)

		if (hasIdentityPattern || hasIdentityKeyword || hasImportantKeyword) {
			importance = Math.max(importance, identityCategory.BASE_IMPORTANCE)
			suggestedTags.push(identityCategory.TAG)
			keyInsights.push('Identity information')
		}

		// Convert to 1-5 scale
		return {
			importance: Math.ceil(importance / 2),
			reasoning,
			keyInsights,
			suggestedTags,
		}
	}

	private getCacheKey(content: string): string {
		return content.slice(0, 100).replace(/\s+/g, ' ').trim()
	}

	private manageCacheSize(): void {
		const maxCacheSize = 1000
		if (this.cache.size > maxCacheSize) {
			const entriesToRemove = this.cache.size - maxCacheSize
			const keys = Array.from(this.cache.keys()).slice(0, entriesToRemove)
			for (const key of keys) {
				this.cache.delete(key)
			}
		}
	}

	clearCache(): void {
		this.cache.clear()
	}

	getCacheStats(): { size: number; enabled: boolean } {
		return {
			size: this.cache.size,
			enabled: this.useCache,
		}
	}
}

export default ImportanceProcessor
