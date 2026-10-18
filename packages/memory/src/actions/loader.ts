/**
 * SKILL.md loader utilities - $ARGUMENTS substitution and frontmatter stripping.
 * Follows Open Agents pattern.
 */

/**
 * Strip YAML frontmatter from a SKILL.md body and substitute $ARGUMENTS.
 */
export function prepareActionPrompt(body: string, args: unknown): string {
	const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
	return body.replace(/\$ARGUMENTS/g, argsStr)
}

/**
 * Extract the plain text body from a SKILL.md (after frontmatter).
 */
export function extractActionBody(content: string): string {
	const match = /^---\n[\s\S]*?\n---\n([\s\S]*)$/m.exec(content)
	return match ? (match[1] ?? content).trim() : content.trim()
}
