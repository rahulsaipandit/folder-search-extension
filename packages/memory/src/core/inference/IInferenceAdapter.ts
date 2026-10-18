import type { InferenceRequest, InferenceResult, WikiKnowledgeBaseConfig } from '../../types'

export interface IInferenceAdapter {
	initialize(): Promise<void>
	infer(request: InferenceRequest): Promise<InferenceResult>
	extractEntities(text: string): Promise<{ entities: string[]; topics: string[]; isProcedural: boolean }>
	classifyOutcome(text: string): Promise<{ outcome: string; failureMode?: string; confidence: number }>
	extractWikiPage(text: string, config: WikiKnowledgeBaseConfig): Promise<{ title: string; body: string; wikilinks: string[] }>
	getStatus(): { isReady: boolean; clientType: string }
}
