import { ActionRegistry } from './ActionRegistry'
import { calculateAction, urlDecodeAction, urlEncodeAction } from './impl/compute'
import { currentTimeAction, epochTimeAction } from './impl/time'
import { htmlSanitizeAction, pageMarkdownAction, pageSummarizerAction } from './impl/page'
import { colorLookupAction, svgProcessorAction } from './impl/media'
import { textRephraserAction } from './impl/text'
import { clickAction, extractTextAction, fillAction, navigateAction, scrollAction } from './impl/browser'
import { queryWikiAction, readPageAction, searchPagesAction, executiveSummaryAction } from './impl/vault'
import { webSearchAction } from './impl/search'
import { goalCreateAction, goalListAction, goalCloseAction, goalGetAction } from './impl/goals'

export { ActionRegistry } from './ActionRegistry'
export type { ParsedActionFile, SemVer } from './types'
export { parseSemVer, compareSemVer } from './types'
export { prepareActionPrompt, extractActionBody } from './loader'
// Note: discoverActionFiles is Node.js-only - not re-exported here to avoid browser bundling issues.
// It is used internally by ActionRegistry.loadFromDirectory() via dynamic import.

// Built-in skills
export { calculateAction, urlEncodeAction, urlDecodeAction } from './impl/compute'
export { currentTimeAction, epochTimeAction } from './impl/time'
export { pageMarkdownAction, htmlSanitizeAction, pageSummarizerAction } from './impl/page'
export { svgProcessorAction, colorLookupAction } from './impl/media'
export { textRephraserAction } from './impl/text'
export { clickAction, fillAction, scrollAction, navigateAction, extractTextAction } from './impl/browser'
export { readPageAction, queryWikiAction, searchPagesAction, executiveSummaryAction } from './impl/vault'
export { webSearchAction } from './impl/search'
export type { WebSearchResult } from './impl/search'
export { goalCreateAction, goalListAction, goalCloseAction, goalGetAction } from './impl/goals'

const ALL_BUILT_IN_ACTIONS = [
	calculateAction, urlEncodeAction, urlDecodeAction,
	currentTimeAction, epochTimeAction,
	pageMarkdownAction, htmlSanitizeAction, pageSummarizerAction,
	svgProcessorAction, colorLookupAction,
	textRephraserAction,
	clickAction, fillAction, scrollAction, navigateAction, extractTextAction,
	readPageAction, queryWikiAction, searchPagesAction, executiveSummaryAction,
	webSearchAction,
	goalCreateAction, goalListAction, goalCloseAction, goalGetAction,
]

/**
 * Create a ActionRegistry pre-loaded with all built-in skills.
 */
export function createDefaultActionRegistry(): ActionRegistry {
	const registry = new ActionRegistry()
	for (const skill of ALL_BUILT_IN_ACTIONS) {
		registry.register(skill)
	}
	return registry
}
