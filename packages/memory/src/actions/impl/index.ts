// Barrel re-export for all built-in skill implementations.

export { calculateAction, urlEncodeAction, urlDecodeAction } from './compute'
export { currentTimeAction, epochTimeAction } from './time'
export { pageMarkdownAction, htmlSanitizeAction, pageSummarizerAction } from './page'
export { svgProcessorAction, colorLookupAction } from './media'
export { textRephraserAction } from './text'
export { clickAction, fillAction, scrollAction, navigateAction, extractTextAction } from './browser'
export { readPageAction, queryWikiAction, searchPagesAction, executiveSummaryAction } from './vault'
export { webSearchAction } from './search'
export type { WebSearchResult } from './search'
export { goalCreateAction, goalListAction, goalCloseAction, goalGetAction } from './goals'
