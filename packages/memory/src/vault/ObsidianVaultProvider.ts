import type { IBrainEngine } from '../interfaces/IBrainEngine'
import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type {
	CompileOptions,
	CompileResult,
	ContextPack,
	LintResult,
	PageFrontmatter,
	QueryResult,
	SourceMetadata,
	VaultPage,
	VaultStatus,
} from '../types'

/**
 * ObsidianVaultProvider - IVaultProvider backed by a local Obsidian vault directory.
 *
 * Reads and writes .md files with YAML frontmatter directly via Node.js fs/promises
 * (dynamically imported so the class does not break in browser builds).
 *
 * All agent-managed pages live under `vaultDir/<subfolder>/` (default: `page-agent/`)
 * to avoid polluting the user's vault root.
 *
 * Phase 4 - vault integration.
 */

export interface ObsidianVaultConfig {
	/** Absolute path to the Obsidian vault directory. */
	vaultDir: string
	/** Optional IBrainEngine used for queryWiki. */
	brain?: IBrainEngine
	/** Subdirectory within vault for agent-managed pages. Default: 'page-agent'. */
	subfolder?: string
}

export class ObsidianVaultProvider implements IVaultProvider {
	private readonly vaultDir: string
	private readonly brain: IBrainEngine | null
	private readonly subfolder: string

	/** In-memory page cache: slug → VaultPage */
	private cache = new Map<string, VaultPage>()
	private cacheLoaded = false

	constructor(config: ObsidianVaultConfig) {
		this.vaultDir = config.vaultDir
		this.brain = config.brain ?? null
		this.subfolder = config.subfolder ?? 'page-agent'
	}

	// ── Read operations ─────────────────────────────────────────────────────────

	async readPage(slug: string): Promise<VaultPage | null> {
		try {
			const fs = await importFs()
			if (!fs) return null

			const filePath = this.resolveSlugPath(slug)
			let raw: string
			try {
				raw = await fs.readFile(filePath, 'utf-8')
			} catch {
				return null
			}

			const page = parseMarkdownPage(slug, raw)
			this.cache.set(slug, page)
			return page
		} catch {
			return null
		}
	}

	async searchPages(
		query: string,
		options?: { topK?: number; tags?: string[] }
	): Promise<VaultPage[]> {
		try {
			await this.ensureCache()
			const topK = options?.topK ?? 10
			const filterTags = options?.tags ?? []

			const keywords = query.toLowerCase().split(/\s+/).filter(Boolean)
			const scored: { page: VaultPage; score: number }[] = []

			for (const page of this.cache.values()) {
				// Tag filter
				if (filterTags.length > 0) {
					const pageTags = page.frontmatter.tags ?? []
					const hasTag = filterTags.some((t) => pageTags.includes(t))
					if (!hasTag) continue
				}

				// BM25-lite keyword score
				const score = bm25Score(page, keywords)
				if (score > 0 || query === '') {
					scored.push({ page, score })
				}
			}

			scored.sort((a, b) => b.score - a.score)
			return scored.slice(0, topK).map((s) => s.page)
		} catch {
			return []
		}
	}

	async queryWiki(question: string): Promise<QueryResult> {
		// Prefer LLM synthesis if a brain is provided
		if (this.brain) {
			try {
				const result = await this.brain.think(question)
				return { answer: result.answer, sources: result.sources, confidence: result.confidence }
			} catch {
				// fall through to keyword search
			}
		}

		// Keyword fallback
		const pages = await this.searchPages(question, { topK: 3 })
		if (pages.length === 0) {
			return { answer: 'No relevant pages found.', sources: [], confidence: 0 }
		}

		const answer = pages
			.slice(0, 3)
			.map((p) => `**${p.title}**: ${p.content.slice(0, 300)}`)
			.join('\n\n')

		return {
			answer,
			sources: pages.map((p) => p.slug),
			confidence: 0.4,
		}
	}

	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		try {
			const pages = await this.searchPages(prompt, { topK: 20 })

			const artifacts: VaultPage[] = []
			let tokenCount = 0

			// Approx 4 chars per token
			const charsPerToken = 4

			for (const page of pages) {
				const estimated = Math.ceil(page.content.length / charsPerToken)
				if (tokenCount + estimated > budgetTokens) break
				artifacts.push(page)
				tokenCount += estimated
			}

			return { artifacts, totalTokens: tokenCount }
		} catch {
			return { artifacts: [], totalTokens: 0 }
		}
	}

	// ── Write operations ────────────────────────────────────────────────────────

	async ingestSource(content: string, metadata: SourceMetadata): Promise<string> {
		try {
			const fs = await importFs()
			if (!fs) return metadata.slug

			const frontmatter: PageFrontmatter = {
				title: metadata.title ?? metadata.slug,
				tags: metadata.tags ?? [],
				sources: [],
			}

			const filePath = this.resolveSlugPath(metadata.slug)
			await ensureDir(fs, this.subfolderPath())
			await fs.writeFile(filePath, serialiseMarkdownPage(content, frontmatter), 'utf-8')

			const page: VaultPage = {
				slug: metadata.slug,
				title: frontmatter.title,
				content,
				frontmatter,
				updatedAt: new Date().toISOString(),
			}
			this.cache.set(metadata.slug, page)

			return metadata.slug
		} catch {
			return metadata.slug
		}
	}

	/**
	 * Not applicable for Obsidian filesystem vault.
	 * Returns zero-compile result.
	 */
	async compileWiki(_options?: CompileOptions): Promise<CompileResult> {
		return { pagesCompiled: 0, pagesSkipped: 0, errors: [] }
	}

	async updatePage(slug: string, content: string, frontmatter: PageFrontmatter): Promise<void> {
		try {
			const fs = await importFs()
			if (!fs) return

			const filePath = this.resolveSlugPath(slug)
			await ensureDir(fs, this.subfolderPath())
			await fs.writeFile(filePath, serialiseMarkdownPage(content, frontmatter), 'utf-8')

			const page: VaultPage = {
				slug,
				title: frontmatter.title,
				content,
				frontmatter,
				updatedAt: new Date().toISOString(),
			}
			this.cache.set(slug, page)
		} catch {
			// Surface errors to callers; do not swallow silently
			throw new Error(`[ObsidianVaultProvider] Failed to write page "${slug}"`)
		}
	}

	// ── Status ──────────────────────────────────────────────────────────────────

	async lintWiki(): Promise<LintResult> {
		try {
			await this.ensureCache()
			const issues: LintResult['issues'] = []

			// Check for broken wikilinks [[slug]]
			const wikilinkRegex = /\[\[([^\]]+)\]\]/g
			for (const page of this.cache.values()) {
				let match: RegExpExecArray | null
				wikilinkRegex.lastIndex = 0
				while ((match = wikilinkRegex.exec(page.content)) !== null) {
					const linkedSlug = match[1]!.trim().split('|')[0]!.trim()
					// Check if the linked slug exists (as-is or in subfolder)
					const exists =
						this.cache.has(linkedSlug) || this.cache.has(`${this.subfolder}/${linkedSlug}`)
					if (!exists) {
						issues.push({
							slug: page.slug,
							message: `Broken wikilink: [[${linkedSlug}]]`,
							severity: 'warning',
						})
					}
				}
			}

			return { issues }
		} catch {
			return { issues: [] }
		}
	}

	async getStatus(): Promise<VaultStatus> {
		try {
			await this.ensureCache()
			return {
				pageCount: this.cache.size,
				provider: 'obsidian',
				lastSyncAt: new Date().toISOString(),
			}
		} catch {
			return { pageCount: 0, provider: 'obsidian' }
		}
	}

	// ── Private helpers ─────────────────────────────────────────────────────────

	private subfolderPath(): string {
		return joinPath(this.vaultDir, this.subfolder)
	}

	private resolveSlugPath(slug: string): string {
		// If slug already has a path separator, resolve from vaultDir
		if (slug.includes('/')) {
			return joinPath(this.vaultDir, `${slug}.md`)
		}
		return joinPath(this.vaultDir, this.subfolder, `${slug}.md`)
	}

	private async ensureCache(): Promise<void> {
		if (this.cacheLoaded) return

		try {
			const fs = await importFs()
			if (!fs) return

			await this.walkDir(fs, this.vaultDir)
			this.cacheLoaded = true
		} catch {
			this.cacheLoaded = true // prevent infinite retry
		}
	}

	private async walkDir(fs: FsModule, dir: string): Promise<void> {
		let entries: FsDirent[]
		try {
			entries = (await fs.readdir(dir, { withFileTypes: true })) as FsDirent[]
		} catch {
			return
		}

		for (const entry of entries) {
			const name = String(entry.name)
			const fullPath = joinPath(dir, name)

			if (entry.isDirectory()) {
				// Skip hidden directories like .obsidian
				if (!name.startsWith('.')) {
					await this.walkDir(fs, fullPath)
				}
			} else if (name.endsWith('.md')) {
				try {
					const raw = await fs.readFile(fullPath, 'utf-8')
					// Derive slug relative to vaultDir, without .md extension
					const relative = fullPath
						.slice(this.vaultDir.length)
						.replace(/^[\\/]/, '')
						.replace(/\.md$/, '')
						.replace(/\\/g, '/')
					const page = parseMarkdownPage(relative, raw)
					this.cache.set(relative, page)
				} catch {
					// Skip unreadable files
				}
			}
		}
	}
}

// ── YAML frontmatter helpers ────────────────────────────────────────────────

function parseMarkdownPage(slug: string, raw: string): VaultPage {
	const { frontmatter, body } = parseFrontmatter(raw)

	return {
		slug,
		title: (frontmatter.title as string | undefined) ?? slug,
		content: body.trim(),
		frontmatter: {
			title: (frontmatter.title as string | undefined) ?? slug,
			...frontmatter,
		},
		updatedAt: new Date().toISOString(),
	}
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(content)
	if (!match) return { frontmatter: {}, body: content }

	const yamlBlock = match[1] ?? ''
	const body = match[2] ?? ''
	const frontmatter: Record<string, unknown> = {}

	for (const line of yamlBlock.split('\n')) {
		const colonIdx = line.indexOf(':')
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const rawValue = line.slice(colonIdx + 1).trim()

		if (rawValue === 'true') {
			frontmatter[key] = true
			continue
		}
		if (rawValue === 'false') {
			frontmatter[key] = false
			continue
		}

		const num = Number(rawValue)
		if (!isNaN(num) && rawValue !== '') {
			frontmatter[key] = num
			continue
		}

		// Array-like: [a, b, c]
		if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
			const items = rawValue
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
				.filter(Boolean)
			frontmatter[key] = items
			continue
		}

		frontmatter[key] = rawValue.replace(/^['"]|['"]$/g, '')
	}

	return { frontmatter, body }
}

function serialiseMarkdownPage(content: string, frontmatter: PageFrontmatter): string {
	const lines: string[] = ['---']

	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) continue
		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`)
		} else if (typeof value === 'string') {
			lines.push(`${key}: "${value}"`)
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`)
		}
	}

	lines.push('---', '', content)
	return lines.join('\n')
}

// ── BM25-lite scoring ────────────────────────────────────────────────────────

function bm25Score(page: VaultPage, keywords: string[]): number {
	if (keywords.length === 0) return 1

	const text = `${page.title} ${page.content}`.toLowerCase()
	let score = 0

	for (const kw of keywords) {
		// Count occurrences (tf)
		let count = 0
		let idx = 0
		while ((idx = text.indexOf(kw, idx)) !== -1) {
			count++
			idx += kw.length
		}
		if (count > 0) {
			// BM25 TF component (simplified, k1=1.2, no IDF - single-doc scoring)
			const k1 = 1.2
			score += (count * (k1 + 1)) / (count + k1)

			// Boost for title matches
			if (page.title.toLowerCase().includes(kw)) score += 2
		}
	}

	return score
}

// ── fs/path dynamic import helpers ──────────────────────────────────────────

interface FsDirent {
	name: string | Buffer
	isDirectory(): boolean
}

interface FsModule {
	readFile(path: string, encoding: 'utf-8'): Promise<string>
	writeFile(path: string, data: string, encoding: 'utf-8'): Promise<void>
	readdir(path: string, opts: { withFileTypes: true }): Promise<unknown[]>
	mkdir(path: string, opts: { recursive: true }): Promise<string | undefined>
}

async function importFs(): Promise<FsModule | null> {
	try {
		return (await import('node:fs/promises')) as unknown as FsModule
	} catch {
		return null
	}
}

async function ensureDir(fs: FsModule, dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true })
}

/**
 * Portable path join - avoids importing node:path at module level.
 * Uses forward slashes, normalises separators.
 */
function joinPath(...parts: string[]): string {
	return parts
		.map((p, i) =>
			i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
		)
		.filter(Boolean)
		.join('/')
}
