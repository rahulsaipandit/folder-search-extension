// Built-in skill asset modules for Metro web builds.
// .md files are in assetExts (metro.config.js) so require() works on web.
// On web, require() returns an asset URL; expo-asset + fetch() reads the content.
// Mirrors skill-assets.native.ts — keep both lists in sync when adding skills.
export const BUILT_IN_SKILL_MODULES: any[] = [
  require('../../skills/summarizer/SKILL.md'),
  require('../../skills/code-reviewer/SKILL.md'),
  require('../../skills/explain-simply/SKILL.md'),
  require('../../skills/rewriter/SKILL.md'),
  require('../../skills/brainstormer/SKILL.md'),
  require('../../skills/negotiation/SKILL.md'),
  require('../../skills/feynman-learning/SKILL.md'),
];
