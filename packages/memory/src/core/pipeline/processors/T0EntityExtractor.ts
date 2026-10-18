import type { Entity, MemoryEntry } from '../../../types'

/**
 * T0 Entity Extractor - zero LLM cost, pure regex + heuristics.
 *
 * Extracts named entity references from memory content so the graph
 * can wire itself as memory accumulates.
 */

// ── Patterns ────────────────────────────────────────────────────────────────

const PERSON_PATTERN =
	/\b([A-Z][a-z]+ (?:[A-Z][a-z]+ )?[A-Z][a-z]+)\b/g
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const HASHTAG_PATTERN = /#([a-zA-Z][a-zA-Z0-9_-]+)/g
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
const CAMEL_CASE_TECH = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g

// Common stop-words to avoid false positives (e.g. "New York", "United States")
const STOP_PHRASES = new Set([
	'United States',
	'New York',
	'Los Angeles',
	'San Francisco',
	'United Kingdom',
	'The User',
	'The System',
	'The App',
])

// ── Extraction ───────────────────────────────────────────────────────────────

interface ExtractedEntityRef {
	name: string
	type: Entity['type']
	/** Approximate character offset in original content */
	offset: number
}

export function extractEntityRefs(content: string): ExtractedEntityRef[] {
	const refs: ExtractedEntityRef[] = []

	// Wikilinks - highest confidence, explicit references
	for (const match of content.matchAll(WIKILINK_PATTERN)) {
		refs.push({ name: match[1]!, type: 'concept', offset: match.index ?? 0 })
	}

	// Hashtags → concepts
	for (const match of content.matchAll(HASHTAG_PATTERN)) {
		refs.push({ name: match[1]!, type: 'concept', offset: match.index ?? 0 })
	}

	// URLs → external resource references (no entity created, just tracked)
	for (const match of content.matchAll(URL_PATTERN)) {
		refs.push({ name: match[0]!, type: 'other', offset: match.index ?? 0 })
	}

	// Emails → persons
	for (const match of content.matchAll(EMAIL_PATTERN)) {
		refs.push({ name: match[0]!, type: 'person', offset: match.index ?? 0 })
	}

	// CamelCase tech terms → systems / concepts
	for (const match of content.matchAll(CAMEL_CASE_TECH)) {
		if (!STOP_PHRASES.has(match[0]!)) {
			refs.push({ name: match[1]!, type: 'system', offset: match.index ?? 0 })
		}
	}

	// Proper-noun triples (Title Case) → person or organization
	for (const match of content.matchAll(PERSON_PATTERN)) {
		if (!STOP_PHRASES.has(match[0]!)) {
			refs.push({ name: match[0]!, type: 'person', offset: match.index ?? 0 })
		}
	}

	return deduplicateRefs(refs)
}

function deduplicateRefs(refs: ExtractedEntityRef[]): ExtractedEntityRef[] {
	const seen = new Map<string, ExtractedEntityRef>()
	for (const ref of refs) {
		const key = ref.name.toLowerCase()
		if (!seen.has(key)) {
			seen.set(key, ref)
		}
	}
	return Array.from(seen.values())
}

// ── Entry-level extraction ────────────────────────────────────────────────────

/**
 * Enrich a MemoryEntry with extracted entity names (mutates tags and entities arrays).
 * Returns entity names extracted.
 */
export function enrichEntryWithEntities(entry: MemoryEntry): string[] {
	const fullText = [entry.title ?? '', entry.content].join(' ')
	const refs = extractEntityRefs(fullText)
	const names = refs.map((r) => r.name)

	// Merge with existing entities without duplicates
	const existing = new Set(entry.entities ?? [])
	for (const name of names) {
		existing.add(name)
	}
	entry.entities = Array.from(existing)

	return names
}
