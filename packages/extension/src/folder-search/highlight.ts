export interface TextPart {
	text: string
	hit: boolean
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Splits `text` into parts, flagging the ones that match any of `terms` (case-insensitive). */
export function highlightParts(text: string, terms: string[]): TextPart[] {
	const cleaned = [...new Set(terms.map(t => t.trim()).filter(t => t.length > 1))]
	if (!cleaned.length || !text) return [{ text, hit: false }]
	const alternation = [...cleaned]
		.sort((a, b) => b.length - a.length)
		.map(escapeRegex)
		.join('|')
	return text
		.split(new RegExp(`(${alternation})`, 'gi'))
		.filter(Boolean)
		.map(part => ({ text: part, hit: cleaned.some(t => t.toLowerCase() === part.toLowerCase()) }))
}
