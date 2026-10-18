import type { LLMConfig } from '@page-agent/llms'

// Demo LLM for testing
export const DEMO_MODEL = 'qwen3.5-plus'
//RP_DONE:
export const DEMO_BASE_URL =
	import.meta.env.WXT_DEMO_BASE_URL || 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run'
export const DEMO_API_KEY = 'NA' //RP_DONE:

export const DEMO_CONFIG: LLMConfig = {
	provider: 'openai', //RP_DONE:
	baseURL: DEMO_BASE_URL,
	model: DEMO_MODEL,
	apiKey: DEMO_API_KEY, //RP_DONE:
	maxRetries: 3, //RP_DONE:
}

/** Legacy testing endpoints that should be auto-migrated to DEMO_BASE_URL */
export const LEGACY_TESTING_ENDPOINTS = [
	'https://hwcxiuzfylggtcktqgij.supabase.co/functions/v1/llm-testing-proxy',
]

export function isTestingEndpoint(url: string): boolean {
	const normalized = url.replace(/\/+$/, '')
	return normalized === DEMO_BASE_URL || LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)
}

/**
 * True when a config "is" the shared demo config, regardless of which baseURL it's
 * currently pointed at - i.e. apiKey/model match the demo fingerprint. Used to tell a
 * stale cached demo baseURL apart from a deliberately configured private provider.
 */
function isDemoConfig(config: LLMConfig): boolean {
	return (
		config.provider === 'openai' && config.apiKey === DEMO_API_KEY && config.model === DEMO_MODEL
	)
}

/**
 * Auto-migrates a cached demo LLMConfig whose baseURL has gone stale - either one of the
 * hardcoded LEGACY_TESTING_ENDPOINTS, or (when `customized` is false) any other baseURL that
 * no longer matches the live DEMO_BASE_URL constant, e.g. because the shared test endpoint
 * moved since this config was cached, or a bad placeholder shipped in a build.
 *
 * `customized` should reflect UnifiedSettings.demoBaseURLCustomized - when true, the user
 * deliberately pointed the demo provider at a custom URL and it must NOT be overwritten.
 */
export function migrateLegacyEndpoint(config: LLMConfig, customized = false): LLMConfig {
	const normalized = config.baseURL.replace(/\/+$/, '')
	if (LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)) {
		return { ...DEMO_CONFIG }
	}
	if (!customized && isDemoConfig(config) && normalized !== DEMO_BASE_URL) {
		return { ...DEMO_CONFIG }
	}
	return config
}
