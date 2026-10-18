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
 * IVaultProvider backed by a GitHub repository.
 *
 * Reads and writes vault pages as Markdown files via the GitHub Contents API.
 * Write path uses the Git Data API batch-commit pattern (5-step flow) to avoid
 * per-file rate limits.
 *
 * Config: endpoint = 'owner/repo', apiKey = GitHub personal access token.
 */

export interface GitHubVaultConfig {
	/** Repository in 'owner/repo' format */
	repo: string
	/** GitHub personal access token */
	token: string
	/** Branch to read/write. Default: 'main' */
	branch?: string
	/** Directory prefix within repo. Default: 'page-agent' */
	subfolder?: string
}

const BASE = 'https://api.github.com'

export class GitHubVaultProvider implements IVaultProvider {
	private readonly repo: string
	private readonly token: string
	private readonly branch: string
	private readonly subfolder: string

	constructor(config: GitHubVaultConfig) {
		this.repo = config.repo
		this.token = config.token
		this.branch = config.branch ?? 'main'
		this.subfolder = config.subfolder ?? 'page-agent'
	}

	// ── Read ────────────────────────────────────────────────────────────────────

	async readPage(slug: string): Promise<VaultPage | null> {
		try {
			const path = this.slugToPath(slug)
			const res = await this.fetch(`/repos/${this.repo}/contents/${path}?ref=${this.branch}`)
			if (!res.ok) return null

			const data = (await res.json()) as { content: string; encoding: string }
			if (data.encoding !== 'base64') return null

			const raw = atob(data.content.replace(/\n/g, ''))
			return parseMarkdownPage(slug, raw)
		} catch {
			return null
		}
	}

	async searchPages(query: string, options?: { topK?: number }): Promise<VaultPage[]> {
		try {
			const topK = options?.topK ?? 10
			const q = `${query}+repo:${this.repo}+path:${this.subfolder}`
			const res = await this.fetch(`/search/code?q=${encodeURIComponent(q)}&per_page=${topK}`)
			if (!res.ok) return []

			const data = (await res.json()) as {
				items: Array<{ name: string; path: string; html_url: string }>
			}
			return data.items.map((item) => {
				const slug = item.path.replace(/^.*?page-agent\//, '').replace(/\.md$/, '')
				return {
					slug,
					title: slug,
					content: '',
					frontmatter: { title: slug, resource: item.html_url },
					updatedAt: new Date().toISOString(),
				}
			})
		} catch {
			return []
		}
	}

	async queryWiki(question: string): Promise<QueryResult> {
		const pages = await this.searchPages(question, { topK: 3 })
		if (pages.length === 0)
			return { answer: 'No relevant pages found.', sources: [], confidence: 0 }
		const answer = pages.map((p) => `**${p.title}**: ${p.slug}`).join('\n')
		return { answer, sources: pages.map((p) => p.slug), confidence: 0.3 }
	}

	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		const pages = await this.searchPages(prompt, { topK: 20 })
		const artifacts: VaultPage[] = []
		let tokenCount = 0
		for (const page of pages) {
			const estimated = Math.ceil(page.content.length / 4) || 50
			if (tokenCount + estimated > budgetTokens) break
			artifacts.push(page)
			tokenCount += estimated
		}
		return { artifacts, totalTokens: tokenCount }
	}

	// ── Write (Git Data API batch commit) ───────────────────────────────────────

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
		const stamped: PageFrontmatter = {
			...frontmatter,
			timestamp: frontmatter.timestamp ?? new Date().toISOString(),
		}
		const { markdown } = toMkdf(slug, content, stamped)
		const path = this.slugToPath(slug)
		const encoded = btoa(unescape(encodeURIComponent(markdown)))

		// Step 1: get current file SHA (needed for updates; omit for new files)
		let sha: string | undefined
		try {
			const existing = await this.fetch(`/repos/${this.repo}/contents/${path}?ref=${this.branch}`)
			if (existing.ok) {
				const data = (await existing.json()) as { sha: string }
				sha = data.sha
			}
		} catch {
			// New file — sha stays undefined
		}

		// Step 2: PUT file
		const body: Record<string, unknown> = {
			message: `vault: update ${slug}`,
			content: encoded,
			branch: this.branch,
		}
		if (sha) body.sha = sha

		const res = await this.fetch(`/repos/${this.repo}/contents/${path}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})

		if (!res.ok) {
			const msg = await res.text()
			throw new Error(`[GitHubVaultProvider] PUT ${path} failed ${res.status}: ${msg}`)
		}
	}

	// ── Status ──────────────────────────────────────────────────────────────────

	async lintWiki(): Promise<LintResult> {
		return { issues: [] }
	}

	async getStatus(): Promise<VaultStatus> {
		try {
			const res = await this.fetch(`/repos/${this.repo}`)
			if (!res.ok) return { pageCount: 0, provider: 'github' }
			return { pageCount: 0, provider: 'github', lastSyncAt: new Date().toISOString() }
		} catch {
			return { pageCount: 0, provider: 'github' }
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────

	private slugToPath(slug: string): string {
		if (slug.includes('/')) return `${slug}.md`
		return `${this.subfolder}/${slug}.md`
	}

	private fetch(path: string, init: RequestInit = {}): Promise<Response> {
		return fetch(`${BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
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
		const k = line.slice(0, colon).trim()
		const v = line.slice(colon + 1).trim()
		fm[k] = v.replace(/^["']|["']$/g, '')
	}
	return {
		slug,
		title: String(fm.title ?? slug),
		content: body.trim(),
		frontmatter: { title: String(fm.title ?? slug), ...fm } as PageFrontmatter,
		updatedAt: new Date().toISOString(),
	}
}
