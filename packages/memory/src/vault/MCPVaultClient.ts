import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

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
 * Generic MCP Vault Client.
 *
 * Connects to any MCP-compatible vault server (Tolaria, Obsidian, custom).
 * Implements IVaultProvider entirely through MCP tool calls.
 *
 * MCP tool surface:
 *   read_page, search_pages, query_wiki, get_context_pack
 *   ingest_source, compile_wiki, update_page
 *   lint_wiki, get_status
 */

export interface MCPVaultConfig {
	/** MCP server URL (SSE endpoint). e.g. "http://localhost:3001/sse" */
	serverUrl: string
	/** Optional auth token */
	apiKey?: string
	/** Provider name for display (default: "mcp") */
	providerName?: string
}

export class MCPVaultClient implements IVaultProvider {
	private client: Client | null = null
	private readonly config: MCPVaultConfig
	private connected = false

	constructor(config: MCPVaultConfig) {
		this.config = config
	}

	async connect(): Promise<void> {
		if (this.connected) return

		this.client = new Client({ name: 'page-agent-memory', version: '1.0.0' }, { capabilities: {} })

		const transport = new StreamableHTTPClientTransport(new URL(this.config.serverUrl))
		await this.client.connect(transport)
		this.connected = true
	}

	async disconnect(): Promise<void> {
		await this.client?.close()
		this.connected = false
		this.client = null
	}

	// ── Read operations ─────────────────────────────────────────────────────

	async readPage(slug: string): Promise<VaultPage | null> {
		const result = await this.call<{ page: VaultPage | null }>('read_page', { slug })
		return result.page
	}

	async searchPages(
		query: string,
		options?: { topK?: number; tags?: string[] }
	): Promise<VaultPage[]> {
		const result = await this.call<{ pages: VaultPage[] }>('search_pages', {
			query,
			top_k: options?.topK ?? 10,
			tags: options?.tags,
		})
		return result.pages ?? []
	}

	async queryWiki(question: string): Promise<QueryResult> {
		const result = await this.call<QueryResult>('query_wiki', { question })
		return result
	}

	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		const result = await this.call<ContextPack>('get_context_pack', {
			prompt,
			budget_tokens: budgetTokens,
		})
		return result
	}

	// ── Write operations ────────────────────────────────────────────────────

	async ingestSource(content: string, metadata: SourceMetadata): Promise<string> {
		const result = await this.call<{ slug: string }>('ingest_source', { content, metadata })
		return result.slug
	}

	async compileWiki(options?: CompileOptions): Promise<CompileResult> {
		const result = await this.call<CompileResult>('compile_wiki', {
			force_recompile: options?.forceRecompile ?? false,
			quality: options?.quality ?? 'T1',
		})
		return result
	}

	async updatePage(slug: string, content: string, frontmatter: PageFrontmatter): Promise<void> {
		await this.call<unknown>('update_page', { slug, content, frontmatter })
	}

	// ── Status ──────────────────────────────────────────────────────────────

	async lintWiki(): Promise<LintResult> {
		return this.call<LintResult>('lint_wiki', {})
	}

	async getStatus(): Promise<VaultStatus> {
		const result = await this.call<VaultStatus>('get_status', {})
		return { ...result, provider: this.config.providerName ?? 'mcp' }
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
		if (!this.connected || !this.client) {
			await this.connect()
		}

		const result = await this.client!.callTool({ name: tool, arguments: args })

		if (result.isError) {
			throw new Error(`[MCPVaultClient] Tool "${tool}" failed: ${JSON.stringify(result.content)}`)
		}

		// MCP returns content as an array of text/image blocks
		const content = result.content as { type: string; text?: string }[] | undefined
		const textBlock = content?.find((c) => c.type === 'text')
		if (!textBlock) return {} as T

		try {
			return JSON.parse(textBlock.text ?? '') as T
		} catch {
			return (textBlock.text ?? '') as unknown as T
		}
	}
}

export { NullVaultProvider } from './NullVaultProvider'
