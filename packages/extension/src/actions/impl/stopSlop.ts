import { z } from 'zod'

import { ActionDefinition } from '../types'
import {
	AI_VOCAB,
	CHATBOT_ARTIFACTS,
	CONDESCENDING_PHRASES,
	FILLER_PHRASES,
	GENERIC_CONCLUSIONS,
	HEDGING_PHRASES,
	INFLATED_IMPORTANCE_PHRASES,
	SYCOPHANTIC_PHRASES,
	VAGUE_ATTRIBUTION_PHRASES,
	countAdverbs,
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
})

const scoreSchema = z.object({
	directness: z.number(),
	rhythm: z.number(),
	trust: z.number(),
	authenticity: z.number(),
	density: z.number(),
})

const outputSchema = z.object({
	scores: scoreSchema,
	total: z.number(), // out of 50
	verdict: z.enum(['pass', 'rewrite']),
	gateTriggered: z.boolean(), // true if any single dimension scored <= 3
	findings: z.array(z.string()),
	rewritten: z.string().optional(), // present only when verdict is 'rewrite'
})

type Input = z.infer<typeof inputSchema>
type Output = z.infer<typeof outputSchema>

const PASS_THRESHOLD = 35 // out of 50
const GATE_FLOOR = 3 // any single dimension at or below this forces a rewrite regardless of total

function clampScore(n: number): number {
	return Math.max(1, Math.min(10, Math.round(n)))
}

function stdev(nums: number[]): number {
	if (nums.length < 2) return 0
	const mean = nums.reduce((a, b) => a + b, 0) / nums.length
	const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
	return Math.sqrt(variance)
}

// Heuristic 1-10 scoring per dimension, based on countable surface signals.
// A real semantic rewrite/score needs the LLM fallback; this is the deterministic-first pass.
function scoreText(text: string): { scores: z.infer<typeof scoreSchema>; findings: string[] } {
	const findings: string[] = []
	const words = wordCount(text) || 1
	const sentences = splitSentences(text)
	const per100 = (count: number) => (count / words) * 100

	// Directness: penalize hedging and "there is/are"/"it is" throat-clearing openers.
	const hedgingCount = countPhrases(text, HEDGING_PHRASES)
	const throatClearing = (text.match(/\b(there (is|are|was|were)|it is|it was)\b/gi) || []).length
	const directness = clampScore(10 - per100(hedgingCount) * 4 - per100(throatClearing) * 2)
	if (hedgingCount) findings.push(`${hedgingCount} hedging phrase(s) blunt directness`)
	if (throatClearing) findings.push(`${throatClearing} throat-clearing opener(s) (there is/it is)`)

	// Rhythm: penalize low sentence-length variance (metronomic), em/en dash overuse, passive
	// voice, forced rule-of-three lists, and repeated formulaic sentence openers - all structural
	// "templated" signals rather than banned words.
	const sentenceLengths = sentences.map((s) => wordCount(s))
	const variance = stdev(sentenceLengths)
	const dashCount = (text.match(/[—–]/g) || []).length
	const passiveVoiceCount = countPassiveVoice(text)
	const ruleOfThreeCount = countRuleOfThree(text)
	const repeatedOpenerCount = countRepeatedOpeners(text)
	const rhythmPenalty =
		(variance < 3 && sentences.length > 2 ? 4 : 0) +
		per100(dashCount) * 3 +
		per100(passiveVoiceCount) * 2 +
		per100(ruleOfThreeCount) * 3 +
		per100(repeatedOpenerCount) * 2
	const rhythm = clampScore(10 - rhythmPenalty)
	if (variance < 3 && sentences.length > 2)
		findings.push('sentence lengths are metronomic (low variance)')
	if (dashCount) findings.push(`${dashCount} em/en dash(es)`)
	if (passiveVoiceCount) findings.push(`${passiveVoiceCount} passive-voice construction(s)`)
	if (ruleOfThreeCount) findings.push(`${ruleOfThreeCount} forced rule-of-three list(s)`)
	if (repeatedOpenerCount)
		findings.push(`${repeatedOpenerCount} repeated formulaic sentence opener(s)`)

	// Trust: penalize over-explaining/condescending phrases and vague, unverifiable attribution
	// ("studies show", "experts agree") - both ask the reader to take a claim on faith.
	const condescendingCount = countPhrases(text, CONDESCENDING_PHRASES)
	const vagueAttributionCount = countPhrases(text, VAGUE_ATTRIBUTION_PHRASES)
	const trust = clampScore(10 - per100(condescendingCount) * 5 - per100(vagueAttributionCount) * 4)
	if (condescendingCount) findings.push(`${condescendingCount} condescending explainer phrase(s)`)
	if (vagueAttributionCount) findings.push(`${vagueAttributionCount} vague-attribution phrase(s)`)

	// Authenticity: penalize AI vocabulary, generic conclusions, sycophantic tone, chatbot
	// artifacts, and inflated-importance phrasing (overstating an ordinary claim's significance).
	const vocabCount = countPhrases(text, AI_VOCAB)
	const conclusionCount = countPhrases(text, GENERIC_CONCLUSIONS)
	const sycophanticCount = countPhrases(text, SYCOPHANTIC_PHRASES)
	const chatbotCount = countPhrases(text, CHATBOT_ARTIFACTS)
	const inflatedCount = countPhrases(text, INFLATED_IMPORTANCE_PHRASES)
	const authenticity = clampScore(
		10 -
			per100(vocabCount) * 3 -
			per100(conclusionCount) * 3 -
			per100(sycophanticCount) * 4 -
			per100(chatbotCount) * 5 -
			per100(inflatedCount) * 4
	)
	if (vocabCount) findings.push(`${vocabCount} AI-vocabulary word(s)`)
	if (conclusionCount) findings.push(`${conclusionCount} generic conclusion phrase(s)`)
	if (sycophanticCount) findings.push(`${sycophanticCount} sycophantic phrase(s)`)
	if (chatbotCount) findings.push(`${chatbotCount} chatbot artifact(s)`)
	if (inflatedCount) findings.push(`${inflatedCount} inflated-importance phrase(s)`)

	// Density: penalize filler phrases and adverb-heavy padding relative to word count.
	const fillerCount = countPhrases(text, FILLER_PHRASES)
	const adverbCount = countAdverbs(text)
	const density = clampScore(10 - per100(fillerCount) * 4 - per100(adverbCount) * 1.5)
	if (fillerCount) findings.push(`${fillerCount} filler phrase(s)`)
	if (adverbCount > words * 0.05) findings.push(`adverb-heavy: ${adverbCount} -ly word(s)`)

	return { scores: { directness, rhythm, trust, authenticity, density }, findings }
}

// Mechanical rewrite pass shared in spirit with humanizer.ts's cleanup. Only grammar-safe
// punctuation fixes and whole-sentence removal mutate the text - blanking out word/phrase-level
// patterns (AI vocabulary, hedging, condescending asides) mid-sentence breaks grammar instead of
// fixing it, so those stay as findings for the LLM fallback to actually rewrite.
function mechanicalRewrite(text: string): string {
	const result = normalizePunctuation(text).text
	const sentences = splitSentences(result).filter(
		(s) => !CHATBOT_ARTIFACTS.some((phrase) => s.toLowerCase().includes(phrase))
	)
	return sentences
		.join(' ')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

export const StopSlopAction: ActionDefinition<Input, Output> = {
	id: 'org.page-agent.text.stopslop',
	name: 'Stop Slop',
	description:
		'Scores text 1-10 across five dimensions - directness, rhythm, trust, authenticity, density - for a ' +
		'total out of 50. Below 35, or any single dimension at 3 or below, triggers a mechanical rewrite pass. ' +
		'Deterministic scoring is a heuristic based on surface signals (hedging, dash/adverb/passive-voice ' +
		'density, forced rule-of-three lists, repeated openers, vague attribution, inflated importance, ' +
		'banned phrases); a faithful semantic score/rewrite needs the LLM fallback.',
	version: '1.0.0',
	capabilities: ['system.text'],
	triggers: ['stop slop', 'score this writing', 'is this ai slop', 'rate this text'],
	inputSchema,
	outputSchema,
	fallbackToLLM: true,
	// No-fabrication guardrail (adopted from blader/humanizer's validate-against-source step): a
	// low score should drive a restructuring rewrite, never an excuse to pad the text with new,
	// unverifiable specifics just to read as more "authentic" or "trustworthy".
	instructionDoc:
		'When rewriting text flagged by this action, only reorganize, condense, or restate content ' +
		'already present in the original `text`. Do not invent statistics, names, examples, or ' +
		'sources that are not already stated by the user or present in the input text - doing so ' +
		'would raise the authenticity/trust score by deception rather than by improving the writing. ' +
		'If a flagged vague-attribution or inflated-importance phrase cannot be fixed without adding ' +
		'an unverifiable specific, remove the claim instead of fabricating support for it.',
	execute: async (input, _context) => {
		const { scores, findings } = scoreText(input.text)
		const total =
			scores.directness + scores.rhythm + scores.trust + scores.authenticity + scores.density
		const gateTriggered = Object.values(scores).some((s) => s <= GATE_FLOOR)
		const verdict: Output['verdict'] = total < PASS_THRESHOLD || gateTriggered ? 'rewrite' : 'pass'

		return {
			scores,
			total,
			verdict,
			gateTriggered,
			findings,
			rewritten: verdict === 'rewrite' ? mechanicalRewrite(input.text) : undefined,
		}
	},
}
