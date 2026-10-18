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
import { toMkdf } from './MkdfAdapter'

/**
 * Browser-compatible IVaultProvider backed by the Obsidian Local REST API.
 *
 * Requires the "Obsidian Local REST API" community plugin to be installed
 * and running (default: http://localhost:27123).
 *
 * Config stored in chrome.storage.sync (via vaultConfig.ts in the extension).
 * Auth token stored in chrome.storage.local.
 *
 * Obsidian REST API endpoints used:
 *   GET  /vault/{path}          — read a file
 *   PUT  /vault/{path}          — create or overwrite a file
 *   POST /search/simple/        — full-text search
 *   GET  /                      — status check
 */

export interface ObsidianRestConfig {
	/** Base URL of the Obsidian Local REST API. Default: http://localhost:27123 */
	endpoint: string
	/** Bearer API key from the plugin settings */
	apiKey: string
	/** Subdirectory within vault for agent-managed pages. Default: 'page-agent' */
	subfolder?: string
}

export class ObsidianRestVaultProvider implements IVaultProvider {
	private readonly endpoint: string
	private readonly apiKey: string
	private readonly subfolder: string

	constructor(config: ObsidianRestConfig) {
		this.endpoint = config.endpoint.replace(/\/$/, '')
		this.apiKey = config.apiKey
		this.subfolder = config.subfolder ?? 'page-agent'
	}

	// ── Read ────────────────────────────────────────────────────────────────────

	async readPage(slug: string): Promise<VaultPage | null> {
		try {
			const path = this.slugToPath(slug)
			const res = await this.fetch(`/vault/${path}`)
			if (!res.ok) return null
			const raw = await res.text()
			return parseMarkdownPage(slug, raw)
		} catch {
			return null
		}
	}

	async searchPages(query: string, options?: { topK?: number }): Promise<VaultPage[]> {
		try {
			const topK = options?.topK ?? 10
			const res = await this.fetch(
				`/search/simple/?query=${encodeURIComponent(query)}&contextLength=200`,
				{
					method: 'POST',
				}
			)
			if (!res.ok) return []

			const results = (await res.json()) as Array<{
				filename: string
				score: number
				matches: Array<{ context: string }>
			}>
			const pages: VaultPage[] = []

			for (const r of results.slice(0, topK)) {
				const slug = r.filename.replace(/^.*?\/page-agent\//, '').replace(/\.md$/, '')
				const snippet = r.matches[0]?.context ?? ''
				pages.push({
					slug,
					title: slug,
					content: snippet,
					frontmatter: { title: slug },
					updatedAt: new Date().toISOString(),
				})
			}
			return pages
		} catch {
			return []
		}
	}

	async queryWiki(question: string): Promise<QueryResult> {
		const pages = await this.searchPages(question, { topK: 3 })
		if (pages.length === 0) {
			return { answer: 'No relevant pages found.', sources: [], confidence: 0 }
		}
		const answer = pages.map((p) => `**${p.title}**: ${p.content.slice(0, 300)}`).join('\n\n')
		return { answer, sources: pages.map((p) => p.slug), confidence: 0.4 }
	}

	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		const pages = await this.searchPages(prompt, { topK: 20 })
		const artifacts: VaultPage[] = []
		let tokenCount = 0
		for (const page of pages) {
			const estimated = Math.ceil(page.content.length / 4)
			if (tokenCount + estimated > budgetTokens) break
			artifacts.push(page)
			tokenCount += estimated
		}
		return { artifacts, totalTokens: tokenCount }
	}

	// ── Write ───────────────────────────────────────────────────────────────────

	async ingestSource(content: string, metadata: SourceMetadata): Promise<string> {
		const frontmatter: PageFrontmatter = {
			title: metadata.title ?? metadata.slug,
			type: metadata.type ?? 'artifact',
			tags: metadata.tags ?? [],
			timestamp: new Date().toISOString(),
		}
		await this.updatePage(metadata.slug, content, frontmatter)
		return metadata.slug
	}

	async compileWiki(_options?: CompileOptions): Promise<CompileResult> {
		return { pagesCompiled: 0, pagesSkipped: 0, errors: [] }
	}

	async updatePage(slug: string, content: string, frontmatter: PageFrontmatter): Promise<void> {
		// Stamp OKF timestamp on write
		const stamped: PageFrontmatter = {
			...frontmatter,
			timestamp: frontmatter.timestamp ?? new Date().toISOString(),
		}
		const { markdown } = toMkdf(slug, content, stamped)
		const path = this.slugToPath(slug)

		const res = await this.fetch(`/vault/${path}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/markdown' },
			body: markdown,
		})

		if (!res.ok) {
			throw new Error(`[ObsidianRestVaultProvider] PUT /vault/${path} failed: ${res.status}`)
		}
	}

	// ── Status ──────────────────────────────────────────────────────────────────

	async lintWiki(): Promise<LintResult> {
		return { issues: [] }
	}

	async getStatus(): Promise<VaultStatus> {
		try {
			const res = await this.fetch('/')
			if (!res.ok) return { pageCount: 0, provider: 'obsidian-rest' }
			return { pageCount: 0, provider: 'obsidian-rest', lastSyncAt: new Date().toISOString() }
		} catch {
			return { pageCount: 0, provider: 'obsidian-rest' }
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────

	private slugToPath(slug: string): string {
		if (slug.includes('/')) return `${slug}.md`
		return `${this.subfolder}/${slug}.md`
	}

	private fetch(path: string, init: RequestInit = {}): Promise<Response> {
		return fetch(`${this.endpoint}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				...(init.headers ?? {}),
			},
		})
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseMarkdownPage(slug: string, raw: string): VaultPage {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw)
	if (!match)
		return {
			slug,
			title: slug,
			content: raw.trim(),
			frontmatter: { title: slug },
			updatedAt: new Date().toISOString(),
		}

	const yamlBlock = match[1] ?? ''
	const body = match[2] ?? ''
	const fm: Record<string, unknown> = {}

	for (const line of yamlBlock.split('\n')) {
		const colon = line.indexOf(':')
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		const raw = line.slice(colon + 1).trim()
		if (raw.startsWith('[') && raw.endsWith(']')) {
			fm[key] = raw
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean)
		} else {
			fm[key] = raw.replace(/^["']|["']$/g, '')
		}
	}

	return {
		slug,
		title: String(fm.title ?? slug),
		content: body.trim(),
		frontmatter: { title: String(fm.title ?? slug), ...fm } as PageFrontmatter,
		updatedAt: new Date().toISOString(),
	}
}
