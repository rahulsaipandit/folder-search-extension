export interface ChunkOptions {
	/** Soft target length. ~250 tokens at ~4 chars/token. */
	targetChars: number
	/** A single chunk never exceeds this. */
	maxChars: number
	/** Fraction of the previous chunk repeated at the start of the next one. */
	overlapRatio: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
	targetChars: 1000,
	maxChars: 1600,
	overlapRatio: 0.15,
}

export interface TextChunk {
	text: string
	/** Character offset of the chunk start in the (normalized) source text. */
	offset: number
	page?: number
}

interface Segment {
	text: string
	offset: number
}

/** Splits at `separator` matches, keeping each piece's offset in `text`. Empty pieces are dropped. */
function splitWithOffsets(text: string, separator: RegExp): Segment[] {
	const out: Segment[] = []
	const re = new RegExp(separator.source, separator.flags.includes('g') ? separator.flags : separator.flags + 'g')
	let last = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(text)) !== null) {
		if (m[0].length === 0) {
			re.lastIndex++
			continue
		}
		pushTrimmed(out, text.slice(last, m.index), last)
		last = m.index + m[0].length
	}
	pushTrimmed(out, text.slice(last), last)
	return out
}

function pushTrimmed(out: Segment[], raw: string, offset: number): void {
	const trimmedStart = raw.length - raw.trimStart().length
	const t = raw.trim()
	if (t) out.push({ text: t, offset: offset + trimmedStart })
}

/** Breaks an over-long paragraph into sentence-sized (or, failing that, word-bounded) segments. */
function splitLong(seg: Segment, maxChars: number): Segment[] {
	if (seg.text.length <= maxChars) return [seg]
	const sentences = splitWithOffsets(seg.text, /(?<=[.!?。！？])\s+/).map(s => ({
		text: s.text,
		offset: seg.offset + s.offset,
	}))
	const out: Segment[] = []
	for (const s of sentences) {
		if (s.text.length <= maxChars) {
			out.push(s)
			continue
		}
		for (let i = 0; i < s.text.length; i += maxChars) {
			let end = Math.min(i + maxChars, s.text.length)
			if (end < s.text.length) {
				const space = s.text.lastIndexOf(' ', end)
				if (space > i + maxChars / 2) end = space
			}
			pushTrimmed(out, s.text.slice(i, end), s.offset + i)
			i = end - maxChars
		}
	}
	return out
}

/** Paragraph/heading-aware chunking with whole-segment overlap. */
export function chunkText(
	input: string,
	options: Partial<ChunkOptions> = {},
	page?: number
): TextChunk[] {
	const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
	const text = input.replace(/\r\n?/g, '\n')
	if (!text.trim()) return []

	// Paragraph breaks are blank lines and markdown headings.
	const segments = splitWithOffsets(text, /\n{2,}|\n(?=#{1,6}\s)/).flatMap(s =>
		splitLong(s, opts.maxChars)
	)

	const chunks: TextChunk[] = []
	let current: Segment[] = []
	let currentLen = 0

	const emit = () => {
		if (!current.length) return
		chunks.push({ text: current.map(s => s.text).join('\n\n'), offset: current[0]!.offset, page })
	}

	const overlapTail = (segs: Segment[]): Segment[] => {
		const budget = opts.targetChars * opts.overlapRatio
		const tail: Segment[] = []
		let len = 0
		for (let i = segs.length - 1; i > 0; i--) {
			// `i > 0` guarantees at least one segment is not carried over, so we always progress.
			const s = segs[i]!
			if (len + s.text.length > budget) break
			tail.unshift(s)
			len += s.text.length
		}
		return tail
	}

	for (const seg of segments) {
		const added = seg.text.length + (current.length ? 2 : 0)
		if (current.length && currentLen + added > opts.targetChars) {
			emit()
			current = overlapTail(current)
			currentLen = current.reduce((n, s, i) => n + s.text.length + (i ? 2 : 0), 0)
		}
		current.push(seg)
		currentLen += seg.text.length + (current.length > 1 ? 2 : 0)
	}
	// Do not emit a trailing chunk that only repeats the overlap of the previous one.
	const lastEmitted = chunks[chunks.length - 1]
	const onlyOverlap =
		lastEmitted && current.length > 0 && current.every(s => s.offset < lastEmitted.offset + lastEmitted.text.length)
	if (!onlyOverlap) emit()
	return chunks
}

/** Chunks each page separately so chunks never straddle pages and carry their page number. */
export function chunkPages(
	pages: { page: number; text: string }[],
	options: Partial<ChunkOptions> = {}
): TextChunk[] {
	return pages.flatMap(p => chunkText(p.text, options, p.page))
}

/**
 * Text that is actually embedded for a document chunk (EmbeddingGemma 2 document prefix, design
 * §3.2). The file name and folder path are included so name-only matches work (design §5.4).
 */
export function buildDocumentInput(relPath: string, content: string): string {
	const title = relPath.replace(/[\\/]+/g, ' / ')
	return `title: ${title || 'none'} | text: ${content}`
}

export function buildQueryInput(query: string): string {
	return `task: search result | query: ${query}`
}
