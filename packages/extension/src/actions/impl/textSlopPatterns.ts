// Shared pattern banks for de-AI-ifying text actions (humanizer.ts, stopSlop.ts).
// Concepts drawn from "Signs of AI writing" (Wikipedia), github.com/blader/humanizer (MIT)
// and github.com/hardikpandya/stop-slop (MIT). Patterns are reimplemented in original wording,
// not copied verbatim from any source.

export const AI_VOCAB = [
	'leverage',
	'leverages',
	'leveraged',
	'leveraging',
	'utilize',
	'utilizes',
	'utilized',
	'utilizing',
	'delve',
	'delves',
	'delved',
	'delving',
	'tapestry',
	'testament',
	'boasts',
	'robust',
	'seamless',
	'seamlessly',
	'furthermore',
	'additionally',
	'moreover',
	'underscore',
	'underscores',
	'underscored',
	'underscoring',
	'showcase',
	'showcases',
	'showcased',
	'showcasing',
	'navigate',
	'navigates',
	'navigated',
	'navigating',
	"in today's fast-paced world",
	'in the ever-evolving landscape of',
	// Expanded from the Wikipedia "Signs of AI writing" overused-vocabulary list.
	'elevate',
	'elevating',
	'unlock',
	'unlocking',
	'harness',
	'harnessing',
	'empower',
	'empowering',
	'foster',
	'fostering',
	'bolster',
	'bolstering',
	'pivotal',
	'myriad',
	'plethora',
	'multifaceted',
	'holistic',
	'synergy',
	'synergies',
	'game-changer',
	'game changer',
	'cutting-edge',
	'cutting edge',
	'revolutionize',
	'revolutionizing',
	'unprecedented',
	'paramount',
	'invaluable',
	'meticulous',
	'meticulously',
	'vibrant',
	'intricate',
	'intricacies',
	'in the realm of',
	"in today's digital age",
	'at the heart of',
]

export const FILLER_PHRASES = [
	"it's important to note that",
	'it is important to note that',
	"it's worth noting that",
	'it is worth noting that',
	'when it comes to',
	'at the end of the day',
	'needless to say',
	'in order to',
	'due to the fact that',
]

export const CHATBOT_ARTIFACTS = [
	'as an ai',
	'i cannot',
	"i don't have personal",
	"i'm just a language model",
	'as of my last update',
	'as of my knowledge cutoff',
	'i hope this helps',
	'let me know if you have any questions',
	'feel free to reach out',
]

export const SYCOPHANTIC_PHRASES = [
	'great question',
	"i'd be happy to",
	'certainly!',
	'absolutely!',
	'happy to help',
]

export const HEDGING_PHRASES = [
	'may potentially',
	'it could be argued that',
	'some might say',
	'arguably',
	'to some extent',
	'in some ways',
]

export const GENERIC_CONCLUSIONS = ['in conclusion', 'overall,', 'in summary,', 'to summarize,']

export const CONDESCENDING_PHRASES = [
	'in other words',
	'simply put',
	'to put it another way',
	'as you can see',
	'you might be wondering',
]

// "Inflated importance" content pattern (Signs of AI writing): overstating the significance of
// an unremarkable claim rather than just stating it.
export const INFLATED_IMPORTANCE_PHRASES = [
	'cannot be overstated',
	'cannot be understated',
	'plays a vital role',
	'plays a crucial role',
	'stands as a testament',
	'serves as a testament',
	'a pivotal moment',
	'a watershed moment',
	'marks a significant milestone',
	'in the annals of',
]

// "Vague sourcing" content pattern (Signs of AI writing): attributing a claim to an unnamed,
// unverifiable authority instead of a specific source.
export const VAGUE_ATTRIBUTION_PHRASES = [
	'studies show',
	'studies have shown',
	'research suggests',
	'research shows',
	'experts agree',
	'experts say',
	'it is widely believed',
	'many believe',
	'some argue',
	'critics argue',
]

// Formulaic transition words that, repeated across a text, are a "repeated sentence openings"
// signal (Signs of AI writing language pattern) rather than a per-occurrence banned phrase.
export const FORMULAIC_OPENERS = [
	'moreover,',
	'furthermore,',
	'additionally,',
	'however,',
	'in addition,',
	'as a result,',
	'consequently,',
	'notably,',
]

// Common non-adverb words ending in "-ly" that would otherwise be miscounted by countAdverbs's
// suffix heuristic (family, apply, supply chain, early, holy, ugly, ... are not adverb padding).
const NON_ADVERB_LY_WORDS = new Set([
	'family',
	'families',
	'supply',
	'supplies',
	'apply',
	'applies',
	'applied',
	'comply',
	'complies',
	'complied',
	'reply',
	'replies',
	'replied',
	'rely',
	'relies',
	'relied',
	'imply',
	'implies',
	'implied',
	'multiply',
	'assembly',
	'anomaly',
	'early',
	'only',
	'holy',
	'ugly',
	'silly',
	'jolly',
	'rally',
	'belly',
	'jelly',
	'bully',
	'ally',
	'allies',
	'fly',
	'flies',
	'ply',
	'butterfly',
	'monopoly',
	'oligopoly',
])

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu

function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary-aware phrase counting. Plain substring counting would double-count a phrase that
// is itself a substring of another listed phrase (e.g. "seamless" inside "seamlessly") and would
// false-positive on unrelated words that merely contain a listed word (e.g. "robust" inside
// "robustness"). \b works on the boundary between a listed phrase's first/last word character and
// a non-word character, so it still matches multi-word phrases correctly.
export function countPhrases(text: string, phrases: string[]): number {
	const lower = text.toLowerCase()
	let count = 0
	for (const phrase of phrases) {
		const pattern = new RegExp(`\\b${escapeRegExp(phrase.toLowerCase())}\\b`, 'g')
		const matches = lower.match(pattern)
		count += matches ? matches.length : 0
	}
	return count
}

export function normalizePunctuation(text: string): {
	text: string
	dashCount: number
	boldCount: number
	curlyQuoteCount: number
	emojiCount: number
} {
	const dashMatches = text.match(/\s[—–]\s|—|–/g)
	const dashCount = dashMatches ? dashMatches.length : 0
	let result = text.replace(/\s[—–]\s/g, ', ').replace(/[—–]/g, ', ')

	const boldMatches = result.match(/\*\*[^*]+\*\*/g)
	const boldCount = boldMatches ? boldMatches.length : 0
	result = result.replace(/\*\*([^*]+)\*\*/g, '$1')

	const curlyMatches = result.match(/[‘’“”]/g)
	const curlyQuoteCount = curlyMatches ? curlyMatches.length : 0
	result = result.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')

	const emojiMatches = result.match(EMOJI_REGEX)
	const emojiCount = emojiMatches ? emojiMatches.length : 0
	result = result.replace(EMOJI_REGEX, '')

	result = result
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/ +([.,!?])/g, '$1')
		.trim()

	return { text: result, dashCount, boldCount, curlyQuoteCount, emojiCount }
}

export function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter(Boolean)
}

export function countAdverbs(text: string): number {
	const matches = text.match(/\b\w+ly\b/gi)
	if (!matches) return 0
	return matches.filter((word) => !NON_ADVERB_LY_WORDS.has(word.toLowerCase())).length
}

export function wordCount(text: string): number {
	const matches = text.match(/\b\w+\b/g)
	return matches ? matches.length : 0
}

// "Forced rule of three" language pattern (Signs of AI writing): a comma-separated list of
// exactly three short items joined by "and", used as a rhetorical flourish rather than because
// the content actually calls for a list (e.g. "fast, reliable, and secure").
export function countRuleOfThree(text: string): number {
	const pattern =
		/\b[\w'-]+(?:\s[\w'-]+){0,2},\s[\w'-]+(?:\s[\w'-]+){0,2},?\sand\s[\w'-]+(?:\s[\w'-]+){0,2}\b/gi
	const matches = text.match(pattern)
	return matches ? matches.length : 0
}

// Simple passive-voice heuristic (be-verb + past participle), a "Signs of AI writing" language
// pattern. Regex-based, so it over/under-counts on edge cases (adjectival participles like
// "excited" read as false positives) - a rough signal for the rhythm/density score, not a parser.
export function countPassiveVoice(text: string): number {
	const matches = text.match(/\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/gi)
	return matches ? matches.length : 0
}

// "Repeated sentence openings" language pattern (Signs of AI writing): the same formulaic
// transition word used to open more than one sentence in the same text reads as templated.
export function countRepeatedOpeners(text: string): number {
	const sentences = splitSentences(text)
	const counts = new Map<string, number>()
	for (const sentence of sentences) {
		const lower = sentence.toLowerCase()
		const opener = FORMULAIC_OPENERS.find((o) => lower.startsWith(o))
		if (opener) counts.set(opener, (counts.get(opener) ?? 0) + 1)
	}
	let repeated = 0
	for (const count of counts.values()) {
		if (count > 1) repeated += count
	}
	return repeated
}
