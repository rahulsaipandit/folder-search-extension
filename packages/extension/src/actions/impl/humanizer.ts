import { z } from 'zod'

import { ActionDefinition } from '../types'
import {
	AI_VOCAB,
	CHATBOT_ARTIFACTS,
	FILLER_PHRASES,
	GENERIC_CONCLUSIONS,
	HEDGING_PHRASES,
	INFLATED_IMPORTANCE_PHRASES,
	SYCOPHANTIC_PHRASES,
	VAGUE_ATTRIBUTION_PHRASES,
	countPassiveVoice,
	countPhrases,
	countRepeatedOpeners,
	countRuleOfThree,
	normalizePunctuation,
	splitSentences,
	wordCount,
} from './textSlopPatterns'

const inputSchema = z.object({
	text: z.string(),
	voiceSample: z.string().optional(), // 2-3 paragraphs of the user's own writing to calibrate tone
})

const outputSchema = z.object({
	humanized: z.string(),
	findings: z.array(z.object({ pattern: z.string(), count: z.number() })),
	originalLength: z.number(),
	newLength: z.number(),
	voiceProfile: z.object({ avgSentenceWords: z.number(), sentenceCount: z.number() }).optional(),
})

type Input = z.infer<typeof inputSchema>
type Output = z.infer<typeof outputSchema>

// Deterministic pass over the "Signs of AI writing" pattern set.
// Only mechanical, grammar-safe fixes mutate the text (dashes, curly quotes, bold markers, emoji,
// and whole chatbot-artifact sentences, which are self-contained and safe to drop entirely).
// Word/phrase-level content patterns (AI vocabulary, filler, hedging, sycophantic tone) are
// detection-only: blanking a word like "robust" or "boasts" out of a sentence breaks its grammar
// ("a seamless, robust architecture" -> "a , architecture"), so those need the LLM fallback to
// actually rewrite - this pass just surfaces them as findings for it to act on.
function humanize(text: string): {
	humanized: string
	findings: { pattern: string; count: number }[]
} {
	const findings: { pattern: string; count: number }[] = []

	const punct = normalizePunctuation(text)
	let result = punct.text
	if (punct.dashCount) findings.push({ pattern: 'em/en dash overuse', count: punct.dashCount })
	if (punct.boldCount) findings.push({ pattern: 'boldface overuse', count: punct.boldCount })
	if (punct.curlyQuoteCount)
		findings.push({ pattern: 'curly quotes', count: punct.curlyQuoteCount })
	if (punct.emojiCount) findings.push({ pattern: 'emojis', count: punct.emojiCount })

	// Chatbot artifacts and cutoff disclaimers read as whole sentences, not phrases - safe to drop.
	const chatbotSentences = splitSentences(result).filter((s) =>
		CHATBOT_ARTIFACTS.some((phrase) => s.toLowerCase().includes(phrase))
	)
	if (chatbotSentences.length) {
		findings.push({
			pattern: 'chatbot artifacts / cutoff disclaimers',
			count: chatbotSentences.length,
		})
		result = splitSentences(result)
			.filter((s) => !chatbotSentences.includes(s))
			.join(' ')
	}

	const vocabCount = countPhrases(result, AI_VOCAB)
	if (vocabCount) findings.push({ pattern: 'AI vocabulary', count: vocabCount })

	const fillerCount = countPhrases(result, FILLER_PHRASES)
	if (fillerCount) findings.push({ pattern: 'filler phrases', count: fillerCount })

	const hedgingCount = countPhrases(result, HEDGING_PHRASES)
	if (hedgingCount) findings.push({ pattern: 'excessive hedging', count: hedgingCount })

	const conclusionCount = countPhrases(result, GENERIC_CONCLUSIONS)
	if (conclusionCount) findings.push({ pattern: 'generic conclusions', count: conclusionCount })

	const sycophanticCount = countPhrases(result, SYCOPHANTIC_PHRASES)
	if (sycophanticCount) findings.push({ pattern: 'sycophantic tone', count: sycophanticCount })

	const inflatedCount = countPhrases(result, INFLATED_IMPORTANCE_PHRASES)
	if (inflatedCount) findings.push({ pattern: 'inflated importance', count: inflatedCount })

	const vagueAttributionCount = countPhrases(result, VAGUE_ATTRIBUTION_PHRASES)
	if (vagueAttributionCount)
		findings.push({ pattern: 'vague attribution', count: vagueAttributionCount })

	const ruleOfThreeCount = countRuleOfThree(result)
	if (ruleOfThreeCount) findings.push({ pattern: 'forced rule-of-three', count: ruleOfThreeCount })

	const passiveVoiceCount = countPassiveVoice(result)
	if (passiveVoiceCount) findings.push({ pattern: 'passive voice', count: passiveVoiceCount })

	const repeatedOpenerCount = countRepeatedOpeners(result)
	if (repeatedOpenerCount)
		findings.push({ pattern: 'repeated sentence openings', count: repeatedOpenerCount })

	result = result
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim()

	return { humanized: result, findings }
}

export const HumanizerAction: ActionDefinition<Input, Output> = {
	id: 'org.page-agent.text.humanize',
	name: 'Humanizer',
	description:
		'Removes AI-writing markers from text. Mechanically fixes em dashes, boldface spam, curly quotes, ' +
		'emojis, and chatbot-artifact sentences. Detects (but does not blindly delete, to avoid breaking ' +
		'grammar) AI vocabulary, filler phrases, hedging, generic conclusions, sycophantic tone, inflated ' +
		'importance, vague attribution, forced rule-of-three, passive voice, and repeated sentence openings - ' +
		'rewriting those needs the LLM fallback. Optionally pass a voiceSample (2-3 paragraphs of the ' +
		"user's own writing) to calibrate rhythm; the deterministic pass reports sentence-length stats only.",
	version: '1.0.0',
	capabilities: ['system.text'],
	triggers: [
		'humanize this',
		'make this sound human',
		'remove ai writing',
		'de-ai this text',
		'sounds like ai',
	],
	inputSchema,
	outputSchema,
	fallbackToLLM: true, // Structural rewrites (rule-of-three, elegant variation, voice mirroring) need the LLM
	// No-fabrication guardrail (adopted from blader/humanizer's validate-against-source step): the
	// deterministic pass only ever hands the LLM fallback a diagnosis (findings) - it never has
	// access to any fact outside `text`/`voiceSample`, so it cannot itself invent supporting detail
	// when a fallback rewrite is requested. This instructs the LLM to keep that same constraint.
	instructionDoc:
		'When rewriting text flagged by this action, only reorganize, condense, or restate content ' +
		'already present in the original `text` (or `voiceSample`, for tone only). Do not invent ' +
		'statistics, names, examples, sources, or other specifics that are not already stated by the ' +
		'user or present in the input text, even if the rewrite would read more naturally with them. ' +
		'If a flagged phrase (e.g. a vague-attribution or inflated-importance finding) cannot be fixed ' +
		'without adding an unverifiable specific, remove the claim instead of fabricating a source for it.',
	execute: async (input, _context) => {
		const { humanized, findings } = humanize(input.text)

		let voiceProfile: Output['voiceProfile']
		if (input.voiceSample) {
			const sentences = splitSentences(input.voiceSample)
			const words = wordCount(input.voiceSample)
			voiceProfile = {
				avgSentenceWords: sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0,
				sentenceCount: sentences.length,
			}
		}

		return {
			humanized,
			findings,
			originalLength: input.text.length,
			newLength: humanized.length,
			voiceProfile,
		}
	},
}
