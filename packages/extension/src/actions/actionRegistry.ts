import { ActionDefinition } from './types';

export class ActionRegistry {
  private actions: Map<string, ActionDefinition<any, any>[]> = new Map();

  register<TInput, TOutput>(definition: ActionDefinition<TInput, TOutput>): void {
    const { id, version } = definition;
    if (!this.actions.has(id)) {
      this.actions.set(id, []);
    }
    const versions = this.actions.get(id)!;
    // Check for duplicate versions
    if (versions.some(s => s.version === version)) {
      throw new Error(`Action ${id} version ${version} already registered`);
    }
    // Insert in sorted order so get() and resolve() always return the latest without sorting.
    const insertIdx = versions.findIndex(v => this.compareVersions(v.version, version) > 0);
    if (insertIdx === -1) {
      versions.push(definition);
    } else {
      versions.splice(insertIdx, 0, definition);
    }
  }

  /**
   * Exact-ID lookup with optional semver constraint.
   * Returns the latest matching version or null.
   */
  get<TInput, TOutput>(
    actionId: string,
    versionConstraint?: string
  ): ActionDefinition<TInput, TOutput> | null {
    const versions = this.actions.get(actionId);
    if (!versions || versions.length === 0) return null;

    if (!versionConstraint) {
      return versions[versions.length - 1] as ActionDefinition<TInput, TOutput>;
    }

    // Simple semver range resolution: e.g., "^1.0.0" matches 1.x.x
    const matching = versions.filter(v => this.matchesConstraint(v.version, versionConstraint));
    if (matching.length === 0) return null;
    return matching[matching.length - 1] as ActionDefinition<TInput, TOutput>;
  }

  /**
   * Deterministic-first resolution for natural language queries.
   *
   * Resolution order (per the Cognitive Brain Architecture spec):
   *   1. Exact action-ID match - zero ambiguity, fastest path.
   *   2. Trigger-keyword scan - collects ALL matching (action, trigger) pairs,
   *      then returns the action whose matched trigger string is longest.
   *      Longest-match wins so a specific trigger like "what is this page about"
   *      always beats a broader one like "what is" regardless of registration order.
   *   3. Returns null - caller decides whether to consult the LLM.
   *
   * Only the latest registered version of each matching action is returned.
   */
  resolve<TInput, TOutput>(query: string): ActionDefinition<TInput, TOutput> | null {
    // Pass 1: exact ID match (handles programmatic invocations).
    const exact = this.get<TInput, TOutput>(query);
    if (exact) return exact;

    // Pass 2: collect all trigger matches, pick the one with the longest trigger string.
    const lower = query.toLowerCase();
    let bestAction: ActionDefinition<any, any> | null = null;
    let bestTriggerLen = -1;

    for (const versions of this.actions.values()) {
      const latest = versions[versions.length - 1];
      if (!latest.triggers || latest.triggers.length === 0) continue;
      for (const trigger of latest.triggers) {
        const t = trigger.toLowerCase();
        if (lower.includes(t) && t.length > bestTriggerLen) {
          bestAction = latest;
          bestTriggerLen = t.length;
        }
      }
    }

    return bestAction as ActionDefinition<TInput, TOutput> | null;
  }

  private matchesConstraint(version: string, constraint: string): boolean {
    if (constraint.startsWith('^')) {
      const [major, minor] = constraint.slice(1).split('.').map(Number);
      const [vMajor, vMinor] = version.split('.').map(Number);
      return vMajor === major && vMinor >= minor;
    }
    return version === constraint;
  }

  private compareVersions(a: string, b: string): number {
    const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
    const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return aPatch - bPatch;
  }

  list(): string[] {
    return Array.from(this.actions.keys());
  }

  clear(): void {
    this.actions.clear();
  }
}

// Global instance
export const globalActionRegistry = new ActionRegistry();
