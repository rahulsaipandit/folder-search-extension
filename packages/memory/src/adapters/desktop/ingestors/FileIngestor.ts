import type { ISourceIngestor, IngestorInput, IngestorOutput } from './types'

const SUPPORTED_EXTENSIONS = new Set([
	'.txt',
	'.md',
	'.json',
	'.csv',
	'.ts',
	'.js',
	'.py',
	'.jsx',
	'.tsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
])

/**
 * FileIngestor - reads text files from the filesystem.
 *
 * Supported formats:
 *   .txt / .md / .ts / .js / .jsx / .tsx / .py  - read as-is
 *   .json   - pretty-print key paths and values (structured summary)
 *   .csv    - convert to markdown table (first 50 rows)
 *
 * Uses Node.js `fs/promises` via dynamic import for browser tree-shaking.
 */
export class FileIngestor implements ISourceIngestor {
	canHandle(input: IngestorInput): boolean {
		if (input.type === 'pdf') return false
		if (input.type === 'url') return false
		if (input.type === 'text') return false
		// type === 'file': check extension
		const ext = getExtension(input.source)
		return SUPPORTED_EXTENSIONS.has(ext)
	}

	async ingest(input: IngestorInput): Promise<IngestorOutput> {
		const filePath = input.source
		const ext = getExtension(filePath)
		const rawContent = await this.readFile(filePath)

		let content: string
		if (ext === '.json') {
			content = this.processJson(rawContent, filePath)
		} else if (ext === '.csv') {
			content = this.processCsv(rawContent)
		} else {
			content = rawContent
		}

		const title = input.metadata?.title ?? fileNameToTitle(filePath)
		const wordCount = countWords(content)

		return {
			content,
			title,
			wordCount,
			sourceType: 'file',
			extractedAt: new Date().toISOString(),
		}
	}

	// ── File reading ──────────────────────────────────────────────────────────

	private async readFile(filePath: string): Promise<string> {
		// Dynamic import so this tree-shakes in browser builds
		const { readFile } = await import('node:fs/promises')
		const buffer = await readFile(filePath)
		return buffer.toString('utf-8')
	}

	// ── JSON processing ───────────────────────────────────────────────────────

	private processJson(raw: string, filePath: string): string {
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch (err) {
			throw new Error(`[FileIngestor] Invalid JSON in "${filePath}": ${String(err)}`, {
				cause: err,
			})
		}

		const lines: string[] = [`# JSON: ${fileNameToTitle(filePath)}`, '']
		this.flattenJsonPaths(parsed, '', lines, 0)
		return lines.join('\n')
	}

	private flattenJsonPaths(value: unknown, path: string, lines: string[], depth: number): void {
		if (depth > 6) {
			// Limit recursion depth
			lines.push(`${path}: [nested object]`)
			return
		}

		if (value === null || typeof value !== 'object') {
			const displayPath = path || '(root)'
			lines.push(`**${displayPath}**: ${JSON.stringify(value)}`)
			return
		}

		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`**${path}**: []`)
				return
			}
			// Show first 10 items
			for (let i = 0; i < Math.min(value.length, 10); i++) {
				this.flattenJsonPaths(value[i], `${path}[${i}]`, lines, depth + 1)
			}
			if (value.length > 10) {
				lines.push(`${path}: ... (${value.length - 10} more items)`)
			}
			return
		}

		// Object
		const entries = Object.entries(value as Record<string, unknown>)
		for (const [key, val] of entries) {
			const childPath = path ? `${path}.${key}` : key
			this.flattenJsonPaths(val, childPath, lines, depth + 1)
		}
	}

	// ── CSV processing ────────────────────────────────────────────────────────

	private processCsv(raw: string): string {
		const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
		if (lines.length === 0) return '(empty CSV)'

		const MAX_ROWS = 50
		const rows = lines.slice(0, MAX_ROWS + 1) // +1 for header

		// Parse CSV rows (simple: handles quoted fields with commas)
		const parsed = rows.map((line) => parseCsvLine(line))
		if (parsed.length === 0) return '(empty CSV)'

		const headers = parsed[0]!
		const dataRows = parsed.slice(1)

		// Build markdown table
		const tableLines: string[] = []
		tableLines.push('| ' + headers.join(' | ') + ' |')
		tableLines.push('| ' + headers.map(() => '---').join(' | ') + ' |')

		for (const row of dataRows) {
			// Pad/trim row to match header count
			const cells = headers.map((_, i) => (row[i] ?? '').replace(/\|/g, '\\|').trim())
			tableLines.push('| ' + cells.join(' | ') + ' |')
		}

		const skipped = lines.length - MAX_ROWS - 1
		if (skipped > 0) {
			tableLines.push('')
			tableLines.push(`_${skipped} more rows omitted_`)
		}

		return tableLines.join('\n')
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExtension(filePath: string): string {
	const idx = filePath.lastIndexOf('.')
	if (idx < 0) return ''
	return filePath.slice(idx).toLowerCase()
}

function fileNameToTitle(filePath: string): string {
	const parts = filePath.replace(/\\/g, '/').split('/')
	const last = parts[parts.length - 1] ?? filePath
	return last.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}

/**
 * Minimal CSV line parser - handles quoted fields containing commas.
 */
function parseCsvLine(line: string): string[] {
	const fields: string[] = []
	let current = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"'
				i++
			} else {
				inQuotes = !inQuotes
			}
		} else if (ch === ',' && !inQuotes) {
			fields.push(current)
			current = ''
		} else {
			current += ch
		}
	}
	fields.push(current)
	return fields
}
