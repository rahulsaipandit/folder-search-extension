import { globalActionRegistry } from '../actionRegistry'
import { CalculatorAction } from './calculator'
import { CurrentTimeAction } from './currentTime'
import { EpochTimeAction } from './epochTime'
import { HTMLSanitizeAction } from './htmlSanitize'
import { HumanizerAction } from './humanizer'
import { PageMarkdownAction } from './pageMarkdown'
import { PageSummarizerAction } from './pageSummarizer'
import { ReadSkillReferenceAction } from './readSkillReference'
import { StopSlopAction } from './stopSlop'
import { TextRephraserAction } from './textRephraser'
import { URLDecoderAction, URLEncoderAction } from './urlCoder'

export function registerBuiltInActions(): void {
	globalActionRegistry.register(CurrentTimeAction)
	globalActionRegistry.register(EpochTimeAction)
	globalActionRegistry.register(CalculatorAction)
	globalActionRegistry.register(URLEncoderAction)
	globalActionRegistry.register(URLDecoderAction)
	globalActionRegistry.register(TextRephraserAction)
	globalActionRegistry.register(PageSummarizerAction)
	globalActionRegistry.register(PageMarkdownAction)
	globalActionRegistry.register(HTMLSanitizeAction)
	globalActionRegistry.register(HumanizerAction)
	globalActionRegistry.register(StopSlopAction)
	globalActionRegistry.register(ReadSkillReferenceAction)
}
