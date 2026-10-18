import type { WikiKnowledgeBaseConfig, WikiPage, WikiRawEntry } from '../../types'
import type { IInferenceAdapter } from '../inference/IInferenceAdapter'
import { nextId } from '../../utils/nextId'

export interface IWikiPageRepo {
	create(page: WikiPage): Promise<WikiPage>
	get(id: string): Promise<WikiPage | undefined>
	update(id: string, updates: Partial<WikiPage>): Promise<void>
}

export class WikiPageProcessor {
	private inference: IInferenceAdapter
	private config: WikiKnowledgeBaseConfig
	private wikiPages: IWikiPageRepo

	constructor(inference: IInferenceAdapter, config: WikiKnowledgeBaseConfig, wikiPages: IWikiPageRepo) {
		this.inference = inference
		this.config = config
		this.wikiPages = wikiPages
	}

	async buildPage(rawEntry: WikiRawEntry): Promise<WikiPage> {
		const extraction = await this.inference.extractWikiPage(rawEntry.content, this.config)

		const page: WikiPage = {
			id: nextId('wiki'),
			slug: slugify(extraction.title),
			title: extraction.title,
			body: extraction.body,
			wikilinks: extraction.wikilinks.map(slugify),
			sourceRawIds: [rawEntry.id],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			version: 1,
		}

		await this.wikiPages.create(page)
		return page
	}

	async updatePage(existingPageId: string, newRawEntry: WikiRawEntry): Promise<WikiPage> {
		const existing = await this.wikiPages.get(existingPageId)
		if (!existing) throw new Error(`WikiPage ${existingPageId} not found`)

		const extraction = await this.inference.extractWikiPage(newRawEntry.content, this.config)
		const updated: WikiPage = {
			...existing,
			body: extraction.body,
			wikilinks: extraction.wikilinks.map(slugify),
			sourceRawIds: [...existing.sourceRawIds, newRawEntry.id],
			updatedAt: Date.now(),
			version: existing.version + 1,
		}

		await this.wikiPages.update(existingPageId, updated)
		return updated
	}
}

function slugify(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
}
