/**
 * SKILL.md filesystem discovery - Open Agents pattern (v2.1).
 * Scans directories for SKILL.md files and parses them.
 * Node.js only - not bundled for browser.
 */
import type { ParsedActionFile } from './types'

/** Parse YAML-like frontmatter from a SKILL.md string. */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(content)
	if (!match) return { frontmatter: {}, body: content }

	const yamlBlock = match[1] ?? ''
	const body = match[2] ?? ''
	const frontmatter: Record<string, unknown> = {}

	for (const line of yamlBlock.split('\n')) {
		const colonIdx = line.indexOf(':')
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const rawValue = line.slice(colonIdx + 1).trim()

		// Parse booleans
		if (rawValue === 'true') {
			frontmatter[key] = true
			continue
		}
		if (rawValue === 'false') {
			frontmatter[key] = false
			continue
		}

		// Parse numbers
		const num = Number(rawValue)
		if (!isNaN(num) && rawValue !== '') {
			frontmatter[key] = num
			continue
		}

		// Strip quotes
		frontmatter[key] = rawValue.replace(/^['"]|['"]$/g, '')
	}

	return { frontmatter, body }
}

/** Discover SKILL.md files in a directory (recursive). Node.js only. */
export async function discoverActionFiles(dir: string): Promise<ParsedActionFile[]> {
	// Dynamic import to avoid bundling fs in browser builds
	const fs = await import('node:fs/promises')
	const path = await import('node:path')

	const results: ParsedActionFile[] = []

	async function walk(currentDir: string): Promise<void> {
		let entries: import('node:fs').Dirent[]
		try {
			entries = (await fs.readdir(currentDir, {
				withFileTypes: true,
			})) as import('node:fs').Dirent[]
		} catch {
			return
		}

		for (const entry of entries) {
			const entryName = entry.name
			const fullPath = path.join(currentDir, entryName)
			if (entry.isDirectory()) {
				await walk(fullPath)
			} else if (entryName.toLowerCase() === 'skill.md') {
				try {
					const content = (await fs.readFile(fullPath, 'utf-8')) as string
					const parsed = parseSkillFile(content, fullPath)
					if (parsed) results.push(parsed)
				} catch (err) {
					console.warn(`[SkillDiscovery] Failed to parse ${fullPath}:`, err)
				}
			}
		}
	}

	await walk(dir)
	return results
}

function parseSkillFile(content: string, filePath: string): ParsedActionFile | null {
	const { frontmatter, body } = parseFrontmatter(content)

	const name = (frontmatter.name as string) ?? ''
	if (!name) {
		console.warn(`[SkillDiscovery] SKILL.md at ${filePath} missing "name" - skipping`)
		return null
	}

	const description = (frontmatter.description as string) ?? ''
	const version = (frontmatter.version as string) ?? '1.0.0'
	const allowedToolsRaw = (frontmatter['allowed-tools'] as string) ?? ''
	const allowedTools = allowedToolsRaw
		? allowedToolsRaw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: []
	const disableModelInvocation = (frontmatter['disable-model-invocation'] as boolean) ?? false
	const userInvocable = (frontmatter['user-invocable'] as boolean) ?? true

	// Derive category from allowed-tools or directory name
	const pathParts = filePath.split(/[/\\]/)
	const dirName = pathParts[pathParts.length - 2] ?? 'misc'
	const category = allowedTools[0] ?? dirName

	// Generate stable ID from name
	const id = `skill.${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`

	return {
		id,
		name,
		description,
		version,
		category,
		allowedTools,
		disableModelInvocation,
		userInvocable,
		body: body.trim(),
	}
}
