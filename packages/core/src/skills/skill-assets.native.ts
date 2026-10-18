// Built-in skill asset modules bundled by Metro (md is in assetExts).
// Add one require() here when adding a new SKILL.md to core/skills/.
// Web picks up new skills automatically via import.meta.glob — no change needed there.
export const BUILT_IN_SKILL_MODULES: number[] = [
  require('../../skills/summarizer/SKILL.md'),
  require('../../skills/code-reviewer/SKILL.md'),
  require('../../skills/explain-simply/SKILL.md'),
  require('../../skills/rewriter/SKILL.md'),
  require('../../skills/brainstormer/SKILL.md'),
  require('../../skills/negotiation/SKILL.md'),
  require('../../skills/feynman-learning/SKILL.md'),
  require('../../skills/storm-research/SKILL.md'),
  require('../../skills/win-win-negotiator/SKILL.md'),
  require('../../skills/skill-acquisition-map/SKILL.md'),
  require('../../skills/deliberate-practice-sprint/SKILL.md'),
  require('../../skills/project-based-learning-track/SKILL.md'),
  require('../../skills/anti-procrastination-framework/SKILL.md'),
  require('../../skills/therapist/SKILL.md'),
  require('../../skills/carl-rogers-therapist/SKILL.md'),
  require('../../skills/jungian-journaling/SKILL.md'),
  require('../../skills/meeting-insights/SKILL.md'),
  require('../../skills/symptom-triage/SKILL.md'),
]
