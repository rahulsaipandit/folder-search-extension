/**
 * Common types for desktop source ingestors.
 * Ingestors convert external content (PDF, URL, file, text) into
 * structured plain-text / markdown ready for BrainEngine ingestion.
 */

export interface IngestorInput {
	/** File path, URL, or raw content string depending on `type`. */
	source: string
	type: 'pdf' | 'url' | 'file' | 'text'
	metadata?: {
		title?: string
		tags?: string[]
		userId?: string
		sessionId?: string
	}
}

export interface IngestorOutput {
	/** Extracted plain text / markdown content. */
	content: string
	/** Human-readable title derived from the source. */
	title: string
	/** Approximate word count of the extracted content. */
	wordCount: number
	/** The ingestor type that handled this input. */
	sourceType: string
	/** ISO-8601 timestamp of extraction. */
	extractedAt: string
}

export interface ISourceIngestor {
	/** Returns true if this ingestor can handle the given input. */
	canHandle(input: IngestorInput): boolean
	/** Extract content from the input source. */
	ingest(input: IngestorInput): Promise<IngestorOutput>
}
