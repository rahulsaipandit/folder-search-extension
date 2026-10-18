import type { IBrainEngine } from '../../../interfaces/IBrainEngine'
import type { ISourceIngestor, IngestorInput, IngestorOutput } from './types'
import { FileIngestor } from './FileIngestor'
import { PDFIngestor } from './PDFIngestor'
import { URLIngestor } from './URLIngestor'

/**
 * SourceIngestorOrchestrator - routes ingestion requests to the appropriate ingestor.
 *
 * Default ingestor order: URLIngestor → FileIngestor → PDFIngestor
 * The first ingestor whose `canHandle()` returns true is used.
 */
export class SourceIngestorOrchestrator {
	private readonly ingestors: ISourceIngestor[]

	constructor(ingestors?: ISourceIngestor[]) {
		this.ingestors = ingestors ?? [
			new URLIngestor(),
			new PDFIngestor(),  // PDFIngestor before FileIngestor so .pdf files go to PDF handler
			new FileIngestor(),
		]
	}

	/**
	 * Ingest content from the given input source.
	 * Throws if no ingestor can handle the input.
	 */
	async ingest(input: IngestorInput): Promise<IngestorOutput> {
		const ingestor = this.ingestors.find((i) => i.canHandle(input))
		if (!ingestor) {
			throw new Error(
				`[SourceIngestorOrchestrator] No ingestor found for type="${input.type}" source="${input.source.slice(0, 80)}"`
			)
		}
		return ingestor.ingest(input)
	}

	/**
	 * Ingest content and immediately store it into a BrainEngine as an episodic memory entry.
	 * Returns the assigned entry ID.
	 */
	async ingestAndStore(input: IngestorInput, brain: IBrainEngine): Promise<string> {
		const output = await this.ingest(input)

		const entryId = await brain.store({
			type: 'episodic',
			content: output.content,
			title: output.title,
			tags: input.metadata?.tags,
			userId: input.metadata?.userId,
			sessionId: input.metadata?.sessionId,
			lifecycleState: 'active',
			metadata: {
				sourceType: output.sourceType,
				sourceRef: input.source.slice(0, 500),
				wordCount: output.wordCount,
				extractedAt: output.extractedAt,
			},
		})

		return entryId
	}
}
