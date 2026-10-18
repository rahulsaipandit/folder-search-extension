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
 * Central Vault access interface (backed by MCP).
 * All interaction with the canonical knowledge store goes through here.
 * Implementations: MCPVaultClient (generic), TolariaVaultProvider, ObsidianVaultProvider.
 */
export interface IVaultProvider {
	// ── Read operations (all platforms) ────────────────────────────────────

	/** Read a single page by slug. */
	readPage(slug: string): Promise<VaultPage | null>

	/** Full-text and semantic search across vault pages. */
	searchPages(query: string, options?: { topK?: number; tags?: string[] }): Promise<VaultPage[]>

	/** Ask the vault a natural-language question and get a synthesized answer. */
	queryWiki(question: string): Promise<QueryResult>

	/** Get a token-budget-aware context pack for injecting into an agent prompt. */
	getContextPack(prompt: string, budgetTokens?: number): Promise<ContextPack>

	// ── Write operations (synthesis engine + desktop) ───────────────────────

	/** Register a raw source for future synthesis compilation. Returns source slug. */
	ingestSource(content: string, metadata: SourceMetadata): Promise<string>

	/** Trigger the wiki compile pipeline (two-phase synthesis). */
	compileWiki(options?: CompileOptions): Promise<CompileResult>

	/** Write or overwrite a vault page directly (used by synthesis engine). */
	updatePage(slug: string, content: string, frontmatter: PageFrontmatter): Promise<void>

	// ── Status ──────────────────────────────────────────────────────────────

	/** Validate vault integrity. */
	lintWiki(): Promise<LintResult>

	/** Get current vault status (page count, last sync, provider name). */
	getStatus(): Promise<VaultStatus>
}
