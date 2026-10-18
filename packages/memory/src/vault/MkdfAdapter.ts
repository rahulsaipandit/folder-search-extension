import type { PageFrontmatter } from '../types'

/**
 * Thin adapter that converts a vault artifact (PageFrontmatter + body) into
 * MKDF (Generic Markdown Export Format) compatible output.
 *
 * MKDF layout:
 *   ---
 *   id: mkdf_<source>_<hash>
 *   source: page-agent
 *   type: <okf type>
 *   url: <resource>
 *   title: <title>
 *   capturedAt: <timestamp>
 *   tags: [...]
 *   synthesisQuality: T1|T2
 *   ---
 *
 *   ## Source Content
 *   <body>
 *
 *   ## AI Enrichment
 *   synthesizedBy: <synthesizedBy>
 *   confidence: <confidence>
 */

export interface MkdfDocument {
	frontmatter: MkdfFrontmatter
	/** Raw markdown body (Source Content section) */
	body: string
	/** Full serialised MKDF markdown string */
	markdown: string
}

export interface MkdfFrontmatter {
	id: string
	source: 'page-agent'
	type: string
	url: string | null
	title: string
	capturedAt: string
	tags: string[]
	synthesisQuality?: string
	synthesizedBy?: string
	confidence?: number
	provenanceState?: string
}

/** Convert a vault page into an MKDF document. */
export function toMkdf(slug: string, body: string, frontmatter: PageFrontmatter): MkdfDocument {
	const id = `mkdf_page-agent_${hashSlug(slug)}`
	const capturedAt = frontmatter.timestamp ?? frontmatter.synthesizedAt ?? new Date().toISOString()

	const fm: MkdfFrontmatter = {
		id,
		source: 'page-agent',
		type: frontmatter.type ?? inferType(frontmatter),
		url: frontmatter.resource ?? null,
		title: frontmatter.title,
		capturedAt,
		tags: frontmatter.tags ?? [],
		synthesisQuality: frontmatter.synthesisQuality,
		synthesizedBy: frontmatter.synthesizedBy,
		confidence: frontmatter.confidence,
		provenanceState: frontmatter.provenanceState,
	}

	const enrichment = [
		frontmatter.synthesizedBy ? `synthesizedBy: ${frontmatter.synthesizedBy}` : null,
		frontmatter.confidence != null ? `confidence: ${frontmatter.confidence}` : null,
		frontmatter.provenanceState ? `provenanceState: ${frontmatter.provenanceState}` : null,
		frontmatter.synthesisQuality ? `synthesisQuality: ${frontmatter.synthesisQuality}` : null,
	]
		.filter(Boolean)
		.join('\n')

	const markdown = [
		serialiseFrontmatter(fm),
		'',
		'## Source Content',
		'',
		body.trim(),
		...(enrichment ? ['', '## AI Enrichment', '', enrichment] : []),
	].join('\n')

	return { frontmatter: fm, body: body.trim(), markdown }
}

/** Parse a PageFrontmatter back out of an MKDF document's raw markdown. */
export function fromMkdf(
	raw: string
): { slug: string; body: string; frontmatter: PageFrontmatter } | null {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw)
	if (!match) return null

	const yamlBlock = match[1] ?? ''
	const rest = match[2] ?? ''

	const parsed = parseSimpleYaml(yamlBlock)
	const slug = slugFromId(String(parsed.id ?? ''))

	// Extract body from "## Source Content" section
	const bodyMatch = /## Source Content\n+([\s\S]*?)(?:\n## |$)/.exec(rest)
	const body = bodyMatch?.[1]?.trim() ?? rest.trim()

	const frontmatter: PageFrontmatter = {
		title: String(parsed.title ?? slug),
		type: parsed.type ? String(parsed.type) : undefined,
		resource: parsed.url ? String(parsed.url) : undefined,
		timestamp: parsed.capturedAt ? String(parsed.capturedAt) : undefined,
		synthesisQuality: (parsed.synthesisQuality as 'T1' | 'T2') ?? undefined,
		synthesizedBy: parsed.synthesizedBy ? String(parsed.synthesizedBy) : undefined,
		confidence: parsed.confidence != null ? Number(parsed.confidence) : undefined,
		provenanceState: parsed.provenanceState as PageFrontmatter['provenanceState'],
		tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : [],
	}

	return { slug, body, frontmatter }
}

function serialiseFrontmatter(fm: MkdfFrontmatter): string {
	const lines = ['---']
	lines.push(`id: "${fm.id}"`)
	lines.push(`source: "${fm.source}"`)
	lines.push(`type: "${fm.type}"`)
	if (fm.url) lines.push(`url: "${fm.url}"`)
	lines.push(`title: "${fm.title}"`)
	lines.push(`capturedAt: "${fm.capturedAt}"`)
	if (fm.tags.length > 0) lines.push(`tags: [${fm.tags.map((t) => `"${t}"`).join(', ')}]`)
	if (fm.synthesisQuality) lines.push(`synthesisQuality: "${fm.synthesisQuality}"`)
	lines.push('---')
	return lines.join('\n')
}

function inferType(fm: PageFrontmatter): string {
	if (fm.synthesisQuality) return 'synthesis'
	if (fm.provenanceState === 'inferred') return 'insight'
	if (fm.sources && fm.sources.length > 0) return 'synthesis'
	return 'artifact'
}

/** 6-hex polynomial hash of a slug — same scheme as MKDF spec. */
function hashSlug(slug: string): string {
	let h = 0
	for (let i = 0; i < slug.length; i++) {
		h = (Math.imul(31, h) + slug.charCodeAt(i)) | 0
	}
	return (h >>> 0).toString(16).padStart(6, '0').slice(0, 6)
}

function slugFromId(id: string): string {
	// mkdf_page-agent_<hash> → strip prefix, use as slug
	return id.replace(/^mkdf_page-agent_/, '') || id
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const line of yaml.split('\n')) {
		const colon = line.indexOf(':')
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		const raw = line.slice(colon + 1).trim()
		if (raw.startsWith('[') && raw.endsWith(']')) {
			result[key] = raw
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean)
		} else {
			result[key] = raw.replace(/^["']|["']$/g, '')
		}
	}
	return result
}
