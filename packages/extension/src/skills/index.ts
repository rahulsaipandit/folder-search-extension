// Engine (types, defaults, detector, prompt-builder, io) lives in @page-agent/core/skills
export type { Skill, SkillSession } from '@page-agent/core/skills'
export {
  detectSkill,
  buildSkillTaskPrefix,
  buildSkillIndexBlock,
  exportSkillsToJSON,
  importSkillsFromJSON,
  exportSkillToSKILLMD,
  importSkillFromSKILLMD,
} from '@page-agent/core/skills'

// Storage bridge (IndexedDB + OPFS) is extension-specific
export { getAllSkills, getOrSeedSkills, getSkillById, saveSkill, deleteSkill, seedDefaultSkills } from './skill-store'
