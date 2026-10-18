import type { IBrainEngine } from './interfaces/IBrainEngine'
import type { IVaultProvider } from './interfaces/IVaultProvider'
import { MemoryService, type MemoryServiceConfig } from './core/MemoryService'
import type { TieredLLMConfig } from './types'
import { NullVaultProvider } from './vault/NullVaultProvider'
// MCPVaultClient is intentionally NOT imported here - it depends on
// @modelcontextprotocol/sdk which is not installed in the host app's
// node_modules. Callers that need vault support should import MCPVaultClient
// directly from './vault/MCPVaultClient' in a Node.js / server context.

/**
 * Factory for creating a web BrainEngine (IndexedDB + Orama + optional MCP vault).
 *
 * This is the primary entry point for the browser extension and web app consumers.
 * Desktop and mobile consumers should use their platform-specific adapters.
 *
 * Returns IBrainEngine - the universal memory interface (v2.1).
 * The concrete type is MemoryService which also implements the legacy IMemoryService
 * interface; callers that need the full CRUD surface can cast to IMemoryService.
 */

export interface CreateWebMemoryServiceOptions {
	/** IndexedDB database name (default: "page-agent-memory") */
	dbName?: string
	/** Tiered LLM configuration for T1 synthesis */
	llm?: TieredLLMConfig
	/** Vault MCP server URL - if not provided, a NullVaultProvider is used */
	vaultUrl?: string
	/** Vault API key */
	vaultApiKey?: string
	/**
	 * Pre-constructed vault provider. When supplied, vaultUrl and vaultApiKey are ignored.
	 * Use this to pass in ObsidianRestVaultProvider or GitHubVaultProvider from the
	 * extension, which constructs the provider from chrome.storage config.
	 */
	vaultProvider?: IVaultProvider
	/** Session ID for working memory */
	sessionId?: string
	/** Working memory token budget (default: 4096) */
	tokenBudget?: number
	/** Number of entries before auto-synthesizing (default: 10) */
	synthesisThreshold?: number
}

/** @deprecated Use createWebBrainEngine() - returns the same instance typed as IBrainEngine */
export async function createWebMemoryService(
	options: CreateWebMemoryServiceOptions = {}
): Promise<IBrainEngine> {
	return createWebBrainEngine(options)
}

export async function createWebBrainEngine(
	options: CreateWebMemoryServiceOptions = {}
): Promise<IBrainEngine> {
	// Dynamic imports - tree-shaken when not used in non-web environments
	const { IndexedDBStore } = await import('./adapters/web/IndexedDBStore')
	const { OramaIndex } = await import('./adapters/web/OramaIndex')

	const store = new IndexedDBStore(options.dbName)
	const index = new OramaIndex()

	// Vault: use the caller-supplied provider (ObsidianRestVaultProvider,
	// GitHubVaultProvider, etc.) or fall back to NullVaultProvider.
	// MCPVaultClient is intentionally excluded — it requires @modelcontextprotocol/sdk
	// which is not in mobile/web bundles.
	const vault: IVaultProvider = options.vaultProvider ?? new NullVaultProvider()

	const config: MemoryServiceConfig = {
		store,
		index,
		vault,
		llm: options.llm,
		sessionId: options.sessionId,
		tokenBudget: options.tokenBudget,
		synthesisThreshold: options.synthesisThreshold,
	}

	const service = new MemoryService(config)
	await service.initialize()
	return service
}
