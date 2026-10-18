import { z } from 'zod';
import { ActionDefinition } from '../types';
import { getSkillByName } from '../../skills/skill-store';

const inputSchema = z.object({
  skillName: z.string().describe('The "name" of the currently active skill, e.g. "college-essay-counselor"'),
  path: z.string().describe('One of the paths listed in the skill\'s "Reference files available for this skill" block, e.g. "references/uc-piq-basics.md"'),
});

const outputSchema = z.union([
  z.object({ content: z.string() }),
  z.object({ error: z.string() }),
]);

/**
 * Progressive-disclosure companion to skill reference files: buildSkillTaskPrefix() (in
 * @page-agent/core/skills) only advertises reference file *paths* in the task prefix, never
 * their content. The agent calls this action (via the generic `call_skill` tool) to pull in
 * one specific file's content only when it decides that file is actually relevant — keeping
 * the per-turn prompt small regardless of how many/large a skill's bundled references are.
 */
export const ReadSkillReferenceAction: ActionDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  id: 'org.page-agent.skills.read-reference',
  name: 'Read Skill Reference File',
  description: 'Reads the content of one bundled reference file belonging to a skill, by skill name and file path',
  version: '1.0.0',
  capabilities: ['system.skills'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  execute: async (input) => {
    const skill = await getSkillByName(input.skillName);
    if (!skill) {
      return { error: `No skill named "${input.skillName}" found` };
    }
    const file = skill.referenceFiles?.find((f) => f.path === input.path);
    if (!file) {
      const available = (skill.referenceFiles ?? []).map((f) => f.path).join(', ') || '(none)';
      return { error: `Skill "${input.skillName}" has no reference file at "${input.path}". Available: ${available}` };
    }
    return { content: file.content };
  },
};
