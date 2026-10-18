/**
 * Onboarding keyword suggestions (design doc §3 item 3): plain LLM generation from the
 * extension's own name/description, unscored — there is no rank/volume signal yet at
 * add-extension time to score against (the four-dimension scoring this tool applies
 * needs the still-unbuilt search-rank endpoint, design doc §8 item 2). Competitor-mining and
 * autocomplete-sourced suggestions are out of scope for the same reason.
 */
import type { LLM, Tool } from '@page-agent/llms'
import { z } from 'zod'

const LLM_TIMEOUT_MS = 30_000

/** Suggests 5 short keyword chips for a Chrome extension's name/description, for a given locale. */
export async function suggestKeywords(
	llm: LLM,
	extension: { name: string; description: string },
	locale: string,
): Promise<string[]> {
	const tool: Tool<{ keywords: string[] }, { keywords: string[] }> = {
		description: 'Return the best Chrome Web Store search keywords for this extension.',
		inputSchema: z.object({
			keywords: z.array(z.string().min(2).max(40)).length(5),
		}),
		execute: async (args) => args,
	}

	const system =
		'You are a Chrome Web Store Optimization keyword researcher. Given an extension\'s name and ' +
		'description, generate exact search phrases real users would type to find it in the Chrome ' +
		`Web Store, in the "${locale}" locale. Exclude generic "<name> extension"-style phrases. Return ` +
		'exactly 5 short (2-4 word) phrases, most relevant first.'
	const user = `Extension: ${extension.name}\nDescription: ${extension.description}`

	const result = await llm.invoke(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		],
		{ suggest_extension_keywords: tool },
		AbortSignal.timeout(LLM_TIMEOUT_MS),
		{ toolChoiceName: 'suggest_extension_keywords' },
	)
	return (result.toolResult as { keywords: string[] }).keywords
}
