import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const rephraseSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'text' in v) {
			return v as { text: string; style?: 'concise' | 'formal' | 'casual' | 'technical' }
		}
		throw new Error('Expected { text: string; style?: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: rephraseSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const rephraseResultSchema = {
	parse: (v: unknown) => v as { result: string; method: 'deterministic' | 'llm' },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { result: string; method: 'deterministic' | 'llm' } }),
}

/** Deterministic rephrasing heuristics - no LLM */
function deterministicRephrase(
	text: string,
	style: 'concise' | 'formal' | 'casual' | 'technical'
): string | null {
	switch (style) {
		case 'concise': {
			// Truncate to first 2 sentences
			const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
			if (sentences.length <= 2) return null // Already short enough, LLM can help
			return sentences.slice(0, 2).join(' ').trim()
		}
		case 'formal':
			// Simple replacements: contractions → full form
			return text
				.replace(/\bdon't\b/g, 'do not')
				.replace(/\bcan't\b/g, 'cannot')
				.replace(/\bwon't\b/g, 'will not')
				.replace(/\bisn't\b/g, 'is not')
				.replace(/\baren't\b/g, 'are not')
				.replace(/\bwasn't\b/g, 'was not')
				.replace(/\bweren't\b/g, 'were not')
				.replace(/\bI'm\b/g, 'I am')
				.replace(/\byou're\b/g, 'you are')
				.replace(/\bthey're\b/g, 'they are')
		case 'casual':
			return text
				.replace(/\bdo not\b/g, "don't")
				.replace(/\bcannot\b/g, "can't")
				.replace(/\bwill not\b/g, "won't")
				.replace(/\bis not\b/g, "isn't")
				.replace(/\bare not\b/g, "aren't")
		case 'technical':
			return null // Always fall back to LLM for technical style
		default:
			return null
	}
}

export const textRephraserAction: ActionDefinition<
	{ text: string; style?: 'concise' | 'formal' | 'casual' | 'technical' },
	{ result: string; method: 'deterministic' | 'llm' }
> = {
	id: 'org.page-agent.text.rephrase',
	name: 'textRephraser',
	description: 'Rephrase text in a different style (concise/formal/casual/technical). Uses deterministic heuristics first, falls back to LLM.',
	version: '1.0.0',
	category: 'text',
	capabilities: [],
	inputSchema: rephraseSchema,
	outputSchema: rephraseResultSchema,
	execute: async ({ text, style = 'concise' }) => {
		const deterministic = deterministicRephrase(text, style)
		if (deterministic !== null) {
			return { result: deterministic, method: 'deterministic' }
		}
		// Signal to registry that LLM fallback is needed
		throw new Error(`Deterministic rephrase not applicable for style "${style}"`)
	},
	fallbackToLLM: true,
	timeoutMs: 30_000,
	userInvocable: true,
}
