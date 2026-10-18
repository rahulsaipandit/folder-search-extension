/**
 * useScopedLLM - React hook that creates a text-LLM instance scoped to the calling
 * component, honoring the textLLMProvider override (see getTextLLMConfig in
 * providers/adapter.ts).
 *
 * The instance is:
 *   - created once when the component mounts (or when the provider/model changes)
 *   - automatically disposed when the component unmounts or the config identity changes
 *
 * This is the correct pattern for text-only sub-features
 * that need their own LLM session rather than sharing the global
 * navigation agent's (multimodal) client. It resolves through getTextLLMConfig, so a
 * textLLMProvider override (set independently of the navigation agent's apiProvider)
 * is respected here too.
 *
 * See: docs/designModularLLMProvider.md for the full design rationale.
 */

import { useEffect, useMemo } from 'react'
import { LLM } from '@page-agent/llms'
import { getTextLLMConfig } from './providers/adapter'
import type { UnifiedSettings } from '../shared/settings'

/**
 * Returns a scoped LLM instance tied to the calling component's lifecycle, or null
 * when text-LLM use is blocked (global provider is demo and no textLLMProvider
 * override is configured) - callers should gate their AI actions on this null check.
 *
 * The instance is recreated only when the provider identity changes (provider type,
 * model name, or endpoint URL). All other settings changes are ignored to avoid
 * unnecessary teardown of the underlying client.
 *
 * @param settings - The current unified settings (e.g. from loadSettings()).
 * @returns An LLM instance that will be disposed on unmount, or null if blocked.
 *
 * @example
 * ```tsx
 * function TextFeatureCard({ settings }: { settings: UnifiedSettings }) {
 *   const llm = useScopedLLM(settings)
 *   const abortRef = useRef<AbortController | null>(null)
 *
 *   async function analyze(text: string) {
 *     if (!llm) return // blocked - prompt user to configure a provider
 *     abortRef.current?.abort()
 *     abortRef.current = new AbortController()
 *     const result = await llm.invoke(
 *       [{ role: 'user', content: text }],
 *       {},
 *       abortRef.current.signal
 *     )
 *     // handle result...
 *   }
 *
 *   useEffect(() => () => { abortRef.current?.abort() }, [])
 * }
 * ```
 */
export function useScopedLLM(settings: UnifiedSettings): LLM | null {
	// Re-create the config only when the provider identity changes.
	// Intentionally omitting unrelated settings fields from the dep array - this
	// avoids teardown/reload of a browser (WebLLM) model engine just because
	// an unrelated setting (e.g. voiceLanguage) changed.
	const config = useMemo(
		() => getTextLLMConfig(settings),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			settings.apiProvider,
			settings.textLLMProvider,
			settings.textLLMEndpoint,
			settings.textLLMModel,
			settings.openaiModel,
			settings.openaiApiKey,
			settings.anthropicModel,
			settings.anthropicApiKey,
			settings.localEndpointUrl,
			settings.currentLocalModel,
			settings.demoBaseURL,
		]
	)

	// Create a new LLM instance whenever the config identity changes.
	const llm = useMemo(() => config ? new LLM(config) : null, [config])

	// Dispose the instance when the component unmounts or when llm is replaced
	// by a config change (the old instance is cleaned up before the new one is used).
	useEffect(() => {
		return () => {
			llm?.dispose()
		}
	}, [llm])

	return llm
}
