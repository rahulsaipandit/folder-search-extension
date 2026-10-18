import type { LLM } from '@page-agent/llms'

import type { IVaultProvider } from '../../interfaces/IVaultProvider'
import type { MemoryEntry, PageFrontmatter, SynthesisQuality, TieredLLMConfig } from '../../types'

/**
 * Synthesis Engine - Two-phase compile pipeline (from LLM-Wiki-Compiler).
 *
 * Phase 1: Concept Extraction
 *   - SHA-256 change detection per source
 *   - T1 (mobile) or T2 (desktop) LLM extracts 3–8 concepts per source
 *   - Builds cross-source reverse dependency index
 *
 * Phase 2: Page Rendering
 *   - For each concept slug, collect contributing source content
 *   - LLM renders canonical markdown page with citations + wikilinks
 *   - Pushes to vault via IVaultProvider
 */

export interface SourceState {
	hash: string
	concepts: string[]
	compiledAt: string
	synthesisQuality: SynthesisQuality
}

export interface ExtractedConcept {
	concept: string
	summary: string
	confidence: number
	provenanceState: 'extracted' | 'merged' | 'inferred' | 'ambiguous'
	contradictedBy: string[]
	tags: string[]
}

export class SynthesisEngine {
	private llm: LLM | null = null
	private readonly quality: SynthesisQuality
	private readonly vault: IVaultProvider | null
	private readonly llmConfig: TieredLLMConfig | undefined
	/** slug → SourceState */
	private readonly sourceStates = new Map<string, SourceState>()
	/** concept slug → contributing source slugs */
	private readonly reverseIndex = new Map<string, Set<string>>()

	constructor(config: {
		llm?: TieredLLMConfig
		quality?: SynthesisQuality
		vault?: IVaultProvider
	}) {
		this.quality = config.quality ?? 'T1'
		this.vault = config.vault ?? null
		this.llmConfig = config.llm
	}

	async initialize(): Promise<void> {
		// Fix: use stored llmConfig instead of broken (this as any).config reference
		const llmCfg = this.quality === 'T2'
			? this.llmConfig?.t2
			: this.llmConfig?.t1

		if (!llmCfg) return

		try {
			const { LLM } = await import('@page-agent/llms')
			this.llm = new LLM({
				baseURL: llmCfg.baseURL,
				model: llmCfg.model,
				apiKey: llmCfg.apiKey ?? '',
				temperature: 0.3,
				maxRetries: 1,
			})
		} catch {
			console.warn('[Memory/Synthesis] LLM unavailable - synthesis disabled')
		}
	}

	/**
	 * Phase 4 - T1→T2 upgrade detection.
	 *
	 * Scans vault artifacts synthesized with T1 quality and returns their slugs
	 * so the job queue can schedule T2 re-synthesis when desktop is available.
	 * Returns the list of slugs that should be upgraded.
	 */
	async detectT1UpgradeCandidates(entries: MemoryEntry[]): Promise<string[]> {
		// Only meaningful when running as T2 (desktop)
		if (this.quality !== 'T2') return []

		const candidates: string[] = []
		for (const [slug, state] of this.sourceStates) {
			if (state.synthesisQuality === 'T1') {
				candidates.push(slug)
			}
		}

		// Also check entries tagged with T1 synthesis quality
		for (const entry of entries) {
			if (
				entry.synthesisQuality === 'T1' &&
				entry.lifecycleState === 'active' &&
				entry.type === 'artifact'
			) {
				const slug = entry.metadata?.slug as string | undefined ?? entry.id
				if (!candidates.includes(slug)) candidates.push(slug)
			}
		}

		return candidates
	}

	/**
	 * Upgrade T1 vault artifacts to T2 quality.
	 * Called by desktop runtime's job queue after T1 artifacts are detected.
	 * Returns the number of artifacts upgraded.
	 */
	async upgradeT1Artifacts(slugs: string[], entries: MemoryEntry[]): Promise<number> {
		if (this.quality !== 'T2' || !this.vault) return 0

		let upgraded = 0
		for (const slug of slugs) {
			try {
				// Find the source entries that contributed to this slug
				const contributing = entries.filter((e) =>
					this.reverseIndex.get(slug)?.has(e.id) ?? false
				)

				if (contributing.length === 0) continue

				// Re-render with T2 quality LLM
				const state = this.sourceStates.get(slug)
				if (!state) continue

				const conceptEntry: ExtractedConcept & { sources: string[] } = {
					concept: slug,
					summary: contributing.map((e) => e.content.slice(0, 150)).join('; '),
					confidence: 0.8,
					provenanceState: 'merged',
					contradictedBy: [],
					tags: [],
					sources: contributing.map((e) => e.id),
				}

				await this.renderAndPushPage(slug, conceptEntry, contributing, 'T2')

				// Update source state to T2
				this.sourceStates.set(slug, {
					...state,
					synthesisQuality: 'T2',
					compiledAt: new Date().toISOString(),
				})
				upgraded++
			} catch (err) {
				console.warn(`[Synthesis] T1→T2 upgrade failed for "${slug}":`, err)
			}
		}

		return upgraded
	}

	/**
	 * Main entry point: compile changed entries into vault artifacts.
	 * Returns the number of artifacts produced.
	 */
	async compile(entries: MemoryEntry[]): Promise<number> {
		if (!this.vault) return 0

		const changed = await this.detectChangedEntries(entries)
		if (changed.length === 0) return 0

		// Phase 1: extract concepts from changed entries
		const conceptMap = new Map<string, ExtractedConcept & { sources: string[] }>()

		for (const entry of changed) {
			const concepts = await this.extractConcepts(entry)
			for (const concept of concepts) {
				const slug = slugify(concept.concept)
				const existing = conceptMap.get(slug)
				if (existing) {
					// Merge: keep highest-confidence version, collect sources
					if (concept.confidence > existing.confidence) {
						conceptMap.set(slug, { ...concept, sources: [...existing.sources, entry.id] })
					} else {
						existing.sources.push(entry.id)
					}
				} else {
					conceptMap.set(slug, { ...concept, sources: [entry.id] })
				}
				// Update reverse index
				if (!this.reverseIndex.has(slug)) this.reverseIndex.set(slug, new Set())
				this.reverseIndex.get(slug)!.add(entry.id)
			}

			// Record source state
			this.sourceStates.set(entry.id, {
				hash: await hashContent(entry.content),
				concepts: Array.from(conceptMap.keys()),
				compiledAt: new Date().toISOString(),
				synthesisQuality: this.quality,
			})
		}

		// Phase 2: render pages for each concept and push to vault
		let produced = 0
		for (const [slug, concept] of conceptMap) {
			try {
				const contributing = entries.filter((e) => concept.sources.includes(e.id))
				await this.renderAndPushPage(slug, concept, contributing)
				produced++
			} catch (err) {
				console.warn(`[Memory/Synthesis] Failed to render page "${slug}":`, err)
			}
		}

		return produced
	}

	// ── Phase 1 ──────────────────────────────────────────────────────────────

	private async extractConcepts(entry: MemoryEntry): Promise<ExtractedConcept[]> {
		if (!this.llm) return this.t3ExtractConcepts(entry)

		const prompt = buildConceptExtractionPrompt(entry)
		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[{ role: 'user', content: prompt }],
				{
					extract_concepts: {
						description: 'Extract 3-8 concepts from the memory content',
						inputSchema: {
							parse: (v: unknown) => v as { concepts: ExtractedConcept[] },
						} as never,
						execute: async (args: { concepts: ExtractedConcept[] }) => args,
					},
				},
				abort.signal
			)
			return (result.toolResult as { concepts: ExtractedConcept[] })?.concepts ?? []
		} catch {
			return this.t3ExtractConcepts(entry)
		}
	}

	private t3ExtractConcepts(entry: MemoryEntry): ExtractedConcept[] {
		// Fallback: treat the entire entry as a single concept
		const title = entry.title ?? entry.content.slice(0, 60).trim()
		return [
			{
				concept: title,
				summary: entry.content.slice(0, 200),
				confidence: 0.5,
				provenanceState: 'extracted',
				contradictedBy: [],
				tags: entry.tags ?? [],
			},
		]
	}

	// ── Phase 2 ──────────────────────────────────────────────────────────────

	private async renderAndPushPage(
		slug: string,
		concept: ExtractedConcept & { sources: string[] },
		contributing: MemoryEntry[],
		qualityOverride?: SynthesisQuality
	): Promise<void> {
		if (!this.vault) return

		const effectiveQuality = qualityOverride ?? this.quality
		const content = this.llm
			? await this.renderWithLLM(slug, concept, contributing)
			: this.renderWithoutLLM(slug, concept, contributing)

		const frontmatter: PageFrontmatter = {
			title: concept.concept,
			sources: concept.sources,
			synthesisQuality: effectiveQuality,
			synthesizedBy: 'memory-engine',
			synthesizedAt: new Date().toISOString(),
			lastUpgradedAt: qualityOverride === 'T2' ? new Date().toISOString() : null,
			confidence: concept.confidence,
			provenanceState: concept.provenanceState,
			contradictedBy: concept.contradictedBy,
			tags: concept.tags,
		}

		await this.vault.updatePage(slug, content, frontmatter)
	}

	private async renderWithLLM(
		slug: string,
		concept: ExtractedConcept,
		contributing: MemoryEntry[]
	): Promise<string> {
		const sourceText = contributing
			.map((e) => `### Source: ${e.id}\n${e.content.slice(0, 800)}`)
			.join('\n\n')

		const prompt = buildPageRenderPrompt(concept, sourceText)
		try {
			const abort = new AbortController()
			const result = await this.llm!.invoke(
				[{ role: 'user', content: prompt }],
				{
					render_page: {
						description: 'Render a canonical markdown page for this concept',
						inputSchema: {
							parse: (v: unknown) => v as { content: string },
						} as never,
						execute: async (args: { content: string }) => args,
					},
				},
				abort.signal
			)
			return (result.toolResult as { content: string })?.content ?? this.renderWithoutLLM(slug, concept, contributing)
		} catch {
			return this.renderWithoutLLM(slug, concept, contributing)
		}
	}

	private renderWithoutLLM(
		slug: string,
		concept: ExtractedConcept,
		contributing: MemoryEntry[]
	): string {
		const lines = [
			`# ${concept.concept}`,
			'',
			concept.summary,
			'',
			'## Sources',
			'',
			...contributing.map((e) => `- ${e.title ?? e.id} (${e.createdAt})`),
			'',
			concept.tags.length > 0 ? `**Tags:** ${concept.tags.join(', ')}` : '',
		]
		return lines.filter((l) => l !== undefined).join('\n')
	}

	// ── Change detection ─────────────────────────────────────────────────────

	private async detectChangedEntries(entries: MemoryEntry[]): Promise<MemoryEntry[]> {
		const changed: MemoryEntry[] = []
		for (const entry of entries) {
			const hash = await hashContent(entry.content)
			const state = this.sourceStates.get(entry.id)
			if (!state || state.hash !== hash) {
				changed.push(entry)
			}
		}
		return changed
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function hashContent(content: string): Promise<string> {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const encoded = new TextEncoder().encode(content)
		const buf = await crypto.subtle.digest('SHA-256', encoded)
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	}
	// Node.js fallback (dynamic import to avoid bundling issues in browser)
	try {
		const { createHash } = await import('node:crypto')
		return createHash('sha256').update(content).digest('hex')
	} catch {
		// Last resort: simple length+first-chars hash
		return `${content.length}-${content.slice(0, 32)}`
	}
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80)
}

function buildConceptExtractionPrompt(entry: MemoryEntry): string {
	return `Extract 3-8 key concepts from this memory. For each concept provide:
- concept: short name
- summary: 1-2 sentence description
- confidence: 0.0 to 1.0
- provenanceState: "extracted" | "merged" | "inferred" | "ambiguous"
- contradictedBy: array of concept names that contradict this
- tags: relevant tags

Memory (${entry.type}): ${entry.content.slice(0, 1000)}

Return JSON: { "concepts": [...] }`
}

function buildPageRenderPrompt(
	concept: ExtractedConcept,
	sourceText: string
): string {
	return `Render a canonical markdown knowledge page for the concept: "${concept.concept}"

Summary: ${concept.summary}
Tags: ${concept.tags.join(', ')}

Source material:
${sourceText.slice(0, 2000)}

Requirements:
- Start with # title
- Include paragraph-level citations using ^[source-id] format
- Use [[wikilinks]] for related concepts
- 200-500 words
- Human-readable and well-structured

Return JSON: { "content": "<markdown content>" }`
}
