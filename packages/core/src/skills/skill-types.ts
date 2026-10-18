export interface Skill {
  id: string
  name: string         // lowercase, hyphens only e.g. "code-reviewer"
  displayName: string  // human-readable e.g. "Code Reviewer"
  description: string  // "Use when…" — drives keyword and semantic auto-detection
  tags: string[]
  instructionBody: string
  version: string
  author: string       // "user" | "built-in" | "imported"
  /** Per-skill threshold for semantic auto-detection (Phase 3). Default 0.70. Absent on pre-2.1 records. */
  scoreThreshold?: number
  /**
   * Bundled reference files from the skill's `references/` folder (e.g. `references/foo.md`),
   * loaded eagerly alongside instructionBody but NOT inlined into the task prefix — see
   * buildSkillTaskPrefix(). The agent fetches one on demand via the
   * "org.page-agent.skills.read-reference" action, keeping the per-turn prompt small
   * regardless of how many/large the reference files are (progressive disclosure).
   */
  referenceFiles?: { path: string; content: string }[]
  isBuiltIn: boolean   // prevents deletion; clone creates a user-owned copy
  createdAt: number    // Unix ms
  updatedAt: number    // Unix ms
}

export interface SkillSession {
  activeSkillId: string | null
}
