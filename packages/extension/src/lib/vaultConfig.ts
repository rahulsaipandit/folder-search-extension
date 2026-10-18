import type { IVaultProvider } from '@page-agent/memory/interfaces'
import { NullVaultProvider, ObsidianRestVaultProvider, GitHubVaultProvider } from '@page-agent/memory/vault'

export type VaultProviderType = 'none' | 'obsidian-rest' | 'github'

export interface VaultConfig {
	type: VaultProviderType
	/** Obsidian: 'http://localhost:27123'  |  GitHub: 'owner/repo' */
	endpoint: string
	/** Subdirectory within vault. Default: 'page-agent' */
	subfolder?: string
}

const CONFIG_KEY = 'vaultConfig'
const TOKEN_KEY = 'vaultAuthToken'

export async function loadVaultConfig(): Promise<VaultConfig> {
	const result = await chrome.storage.sync.get(CONFIG_KEY)
	return (result[CONFIG_KEY] as VaultConfig | undefined) ?? { type: 'none', endpoint: '' }
}

export async function saveVaultConfig(config: VaultConfig): Promise<void> {
	await chrome.storage.sync.set({ [CONFIG_KEY]: config })
}

export async function loadVaultToken(): Promise<string> {
	const result = await chrome.storage.local.get(TOKEN_KEY)
	return (result[TOKEN_KEY] as string | undefined) ?? ''
}

export async function saveVaultToken(token: string): Promise<void> {
	await chrome.storage.local.set({ [TOKEN_KEY]: token })
}

/** Build an IVaultProvider from stored config + token. */
export async function createVaultProviderFromConfig(): Promise<IVaultProvider> {
	const config = await loadVaultConfig()
	const token = await loadVaultToken()

	if (config.type === 'obsidian-rest' && config.endpoint && token) {
		return new ObsidianRestVaultProvider({
			endpoint: config.endpoint,
			apiKey: token,
			subfolder: config.subfolder,
		})
	}

	if (config.type === 'github' && config.endpoint && token) {
		return new GitHubVaultProvider({
			repo: config.endpoint,
			token,
			subfolder: config.subfolder,
		})
	}

	return new NullVaultProvider()
}

/** Test connectivity for the given config + token. Returns null on success, error string on failure. */
export async function testVaultConnection(config: VaultConfig, token: string): Promise<string | null> {
	try {
		let provider: IVaultProvider

		if (config.type === 'obsidian-rest') {
			provider = new ObsidianRestVaultProvider({
				endpoint: config.endpoint,
				apiKey: token,
				subfolder: config.subfolder,
			})
		} else if (config.type === 'github') {
			provider = new GitHubVaultProvider({
				repo: config.endpoint,
				token,
				subfolder: config.subfolder,
			})
		} else {
			return 'No vault provider configured.'
		}

		const status = await provider.getStatus()
		if (status.provider === 'null') return 'Connection failed.'
		return null
	} catch (err) {
		return err instanceof Error ? err.message : 'Connection failed.'
	}
}
