import { describe, expect, it, vi } from 'vitest'

import { getTextLLMConfig } from './adapter'

describe('getTextLLMConfig', () => {
	it('returns null until a private provider is configured, never a default provider', () => {
		expect(getTextLLMConfig({})).toBeNull()
		expect(getTextLLMConfig({ textLLMProvider: 'local' })).toBeNull() // no model yet
		expect(getTextLLMConfig({ textLLMProvider: 'browser' })).toBeNull() // no model yet
	})

	it('builds a local OpenAI-compatible config, preferring the Ask-specific endpoint and model', () => {
		const cfg = getTextLLMConfig({
			textLLMProvider: 'local',
			textLLMEndpoint: 'http://localhost:11434/v1',
			textLLMModel: 'llama3',
			localEndpointUrl: 'http://other/v1',
			currentLocalModel: 'ignored',
		})
		expect(cfg).toMatchObject({ provider: 'local', baseURL: 'http://localhost:11434/v1', model: 'llama3', apiKey: 'NA' })
	})

	it('falls back to the saved local endpoint, then to the LM Studio default', () => {
		expect(getTextLLMConfig({ textLLMProvider: 'local', textLLMModel: 'm', localEndpointUrl: 'http://x/v1' })?.baseURL).toBe('http://x/v1')
		expect(getTextLLMConfig({ textLLMProvider: 'local', textLLMModel: 'm' })?.baseURL).toBe('http://localhost:1234/v1')
	})

	it('builds a browser (WebLLM) config that never touches the network', () => {
		const cfg = getTextLLMConfig({ textLLMProvider: 'browser', currentLocalModel: 'gemma-2-2b', currentLocalModelContextWindow: 8192 })
		expect(cfg).toMatchObject({ provider: 'browser', baseURL: 'browser://', model: 'gemma-2-2b', currentLocalModelContextWindow: 8192 })
	})
})

describe('loadSettings', () => {
	async function loadWith(stored: unknown) {
		vi.resetModules()
		vi.doMock('../../shared/storageAdapter', () => ({
			getStorageAdapter: () => ({ get: async () => stored, set: async () => undefined }),
		}))
		return (await import('../../shared/settings')).loadSettings()
	}

	it('drops cloud, demo and use-global providers saved by older builds so Ask asks the user to choose', async () => {
		for (const legacy of ['openai', 'anthropic', 'demo', 'use-global']) {
			expect((await loadWith({ textLLMProvider: legacy })).textLLMProvider).toBeUndefined()
		}
	})

	it('keeps a valid private provider and fills defaults', async () => {
		const s = await loadWith({ textLLMProvider: 'browser', uiLanguage: 'de-DE' })
		expect(s).toMatchObject({ textLLMProvider: 'browser', uiLanguage: 'de-DE', currentLocalModelContextWindow: 8192 })
	})
})
