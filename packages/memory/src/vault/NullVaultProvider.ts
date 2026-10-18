import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type {
	CompileResult,
	ContextPack,
	LintResult,
	QueryResult,
	VaultPage,
	VaultStatus,
} from '../types'

/**
 * No-op vault provider - used when no vault is configured.
 * All write operations are silently dropped; reads return empty results.
 *
 * Kept in its own file so factory.ts can import it without pulling in
 * MCPVaultClient (which depends on @modelcontextprotocol/sdk, a package
 * not bundled into the mobile/web app).
 */
export class NullVaultProvider implements IVaultProvider {
	async readPage(): Promise<null> {
		return null
	}
	async searchPages(): Promise<VaultPage[]> {
		return []
	}
	async queryWiki(): Promise<QueryResult> {
		return { answer: '', sources: [], confidence: 0 }
	}
	async getContextPack(): Promise<ContextPack> {
		return { artifacts: [], totalTokens: 0 }
	}
	async ingestSource(): Promise<string> {
		return ''
	}
	async compileWiki(): Promise<CompileResult> {
		return { pagesCompiled: 0, pagesSkipped: 0, errors: [] }
	}
	async updatePage(): Promise<void> {
		/* no-op */
	}
	async lintWiki(): Promise<LintResult> {
		return { issues: [] }
	}
	async getStatus(): Promise<VaultStatus> {
		return { pageCount: 0, provider: 'null' }
	}
}
