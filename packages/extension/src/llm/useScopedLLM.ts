/**
 * useScopedLLM - React hook that creates the text-LLM instance used by Ask mode, scoped to the
 * calling component's lifecycle.
 *
 * The instance is created when the component mounts (or when the provider/model changes) and
 * disposed on unmount or when the config identity changes, so a browser (WebLLM) model engine is
 * unloaded once nothing references it.
 *
 * @example
 * ```tsx
 * const llm = useScopedLLM(settings)
 * const answer = llm && (await llm.invokeText([{ role: 'user', content: prompt }], signal))
 * ```
 */

import { useEffect, useMemo } from 'react'
import { LLM } from '@page-agent/llms'
import { getTextLLMConfig } from './providers/adapter'
import type { UnifiedSettings } from '../shared/settings'

/**
 * Returns a scoped LLM instance, or null when no private provider is configured yet - callers must
 * gate their AI actions on the null check and point the user at the AI provider settings page.
 *
 * The instance is recreated only when the provider identity changes (provider, model, endpoint).
 */
export function useScopedLLM(settings: UnifiedSettings): LLM | null {
	const config = useMemo(
		() => getTextLLMConfig(settings),
		// Intentionally only identity fields: unrelated setting changes must not tear down a loaded model.
		[
			settings.textLLMProvider,
			settings.textLLMEndpoint,
			settings.textLLMModel,
			settings.localEndpointUrl,
			settings.currentLocalModel,
			settings.currentLocalModelContextWindow,
		]
	)

	const llm = useMemo(() => (config ? new LLM(config) : null), [config])

	useEffect(() => {
		return () => {
			llm?.dispose()
		}
	}, [llm])

	return llm
}
