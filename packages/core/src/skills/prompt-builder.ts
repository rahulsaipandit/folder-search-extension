import type { Skill } from './skill-types'

/**
 * Reference files are advertised by path only, never inlined — the agent pulls one in on
 * demand via the read-reference action. This keeps the prefix small regardless of how many
 * or how large the skill's bundled reference files are (progressive disclosure, matching the
 * Anthropic Agent Skills design this format is based on).
 */
function buildReferenceFilesBlock(activeSkill: Skill): string {
  const files = activeSkill.referenceFiles
  if (!files || files.length === 0) return ''

  const list = files.map((f) => `- ${f.path}`).join('\n')
  return (
    `\n\n### Reference files available for this skill\n` +
    `These are NOT loaded above — call the \`call_skill\` tool with ` +
    `actionId "org.page-agent.skills.read-reference" and input ` +
    `{ "skillName": "${activeSkill.name}", "path": "<one of the paths below>" } to read one ` +
    `when the instructions above tell you it's relevant:\n${list}`
  )
}

export function buildSkillTaskPrefix(activeSkill: Skill): string {
  const referenceBlock = buildReferenceFilesBlock(activeSkill)
  return `<skill-instructions>\n## Active Skill: ${activeSkill.displayName}\n\n${activeSkill.instructionBody}${referenceBlock}\n</skill-instructions>\n\n`
}

export function buildSkillIndexBlock(skills: Skill[]): string {
  if (skills.length === 0) return ''
  const index = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return `## Available Skills\n${index}`
}
