import type { Skill } from './skill-types'

export function exportSkillsToJSON(skills: Skill[]): string {
  return JSON.stringify(skills, null, 2)
}

export function importSkillsFromJSON(json: string): Skill[] {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of skills')
  return parsed as Skill[]
}

export function exportSkillToSKILLMD(skill: Skill): string {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `display_name: ${skill.displayName}`,
    `description: ${skill.description}`,
    `version: ${skill.version}`,
    `author: ${skill.author}`,
    `tags: [${skill.tags.join(', ')}]`,
    `score_threshold: ${skill.scoreThreshold ?? 0.70}`,
    '---',
    '',
  ].join('\n')
  return frontmatter + skill.instructionBody
}

export function importSkillFromSKILLMD(markdown: string, overrides: Partial<Skill> = {}): Skill {
  // Normalize CRLF to LF so frontmatter parsing is agnostic to the source file's line endings.
  const normalized = markdown.replace(/\r\n/g, '\n')
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n/)
  if (!fmMatch) throw new Error('No YAML frontmatter found')

  const fm = fmMatch[1]
  const body = normalized.slice(fmMatch[0].length).trim()

  const get = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim() : ''
  }

  const tagsRaw = get('tags').replace(/^\[|\]$/g, '')
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  const scoreThreshold = parseFloat(get('score_threshold')) || 0.70

  const now = Date.now()
  const name = get('name')
  const displayNameRaw = get('display_name')
  return {
    id: crypto.randomUUID(),
    name,
    displayName: displayNameRaw || name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: get('description'),
    tags,
    instructionBody: body,
    version: get('version') || '1.0.0',
    author: get('author') || 'imported',
    scoreThreshold,
    createdAt: now,
    updatedAt: now,
    isBuiltIn: false,
    ...overrides,
  }
}
