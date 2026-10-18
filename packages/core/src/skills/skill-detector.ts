import type { Skill } from './skill-types'

/**
 * Keyword-based skill detector (Phase 1/2).
 * Counts how many keywords from description + tags appear in the user message.
 * A skill is returned only if the raw count meets the minimum threshold.
 * Phase 3 replaces this with cosine similarity via browser-ml embeddings, at
 * which point Skill.scoreThreshold (0–1) will gate the semantic similarity score.
 */
export function detectSkill(userMessage: string, skills: Skill[]): Skill | null {
  const msg = userMessage.toLowerCase()
  let best: Skill | null = null
  let bestScore = 0

  for (const skill of skills) {
    const keywords = [
      ...skill.description.toLowerCase().split(/\W+/),
      ...skill.tags.map((t) => t.toLowerCase()),
    ]
    const score = keywords.filter((k) => k.length > 3 && msg.includes(k)).length
    if (score > bestScore) {
      bestScore = score
      best = skill
    }
  }

  return bestScore >= 2 ? best : null
}
