import type { IBrainEngine } from '../../interfaces/IBrainEngine'
import type { MemoryEntry } from '../../types'

/**
 * ConflictDetector - Phase 5 organizational monitoring and conflict detection.
 *
 * Detects contradictions between memory entries:
 * 1. Direct contradictions (entity X described with opposing predicates)
 * 2. Temporal conflicts (same fact with different values at different times)
 * 3. Procedural inconsistencies (two procedures for the same task with different steps)
 *
 * Design: Section 5 (Autonomous Cognition) of designCognitiveBrain.md
 */
export interface MemoryConflict {
  type: 'direct_contradiction' | 'temporal_conflict' | 'procedural_inconsistency'
  entryIds: [string, string]   // The two conflicting entries
  description: string
  severity: 'low' | 'medium' | 'high'
  resolvedBy?: string          // Entry ID of the resolution, if known
}

// Negation phrase pairs that indicate contradiction
const CONTRADICTION_PATTERNS: [RegExp, RegExp][] = [
  [/\bis\b/i, /\bis not\b|\bisn't\b/i],
  [/\bcan\b/i, /\bcannot\b|\bcan't\b/i],
  [/\bwill\b/i, /\bwill not\b|\bwon't\b/i],
  [/\balways\b/i, /\bnever\b/i],
  [/\benabled\b/i, /\bdisabled\b/i],
  [/\bactive\b/i, /\binactive\b/i],
  [/\bsucceeded\b/i, /\bfailed\b/i],
  [/\bapproved\b/i, /\brejected\b/i],
]

export class ConflictDetector {
  private readonly brain: IBrainEngine
  constructor(brain: IBrainEngine) {
    this.brain = brain
  }

  /**
   * Scan a set of entries for conflicts.
   * Returns conflicts sorted by severity.
   */
  async detect(entries: MemoryEntry[]): Promise<MemoryConflict[]> {
    const conflicts: MemoryConflict[] = []

    // Index entries by shared entities for efficient pair comparison
    const byEntity = this.groupByEntity(entries)

    for (const [, entityEntries] of byEntity) {
      if (entityEntries.length < 2) continue

      // Check pairs within the same entity group
      for (let i = 0; i < entityEntries.length - 1; i++) {
        for (let j = i + 1; j < entityEntries.length; j++) {
          const a = entityEntries[i]!
          const b = entityEntries[j]!

          const conflict = this.checkPair(a, b)
          if (conflict && !conflicts.find(
            (c) => c.entryIds.includes(a.id) && c.entryIds.includes(b.id)
          )) {
            conflicts.push(conflict)
          }
        }
      }
    }

    // Check procedural inconsistencies separately
    const procedures = entries.filter((e) => e.type === 'procedure')
    const procedureConflicts = this.detectProceduralConflicts(procedures)
    conflicts.push(...procedureConflicts)

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 }
    return conflicts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  }

  /**
   * Mark a conflict as resolved by a specific entry.
   * Adds a `contradicts` relation in the brain engine.
   */
  async resolveConflict(
    conflict: MemoryConflict,
    resolvedByEntryId: string
  ): Promise<void> {
    for (const entryId of conflict.entryIds) {
      await this.brain.addRelation(entryId, {
        targetId: resolvedByEntryId,
        type: 'contradicts',
        weight: 0.9,
        metadata: { conflictType: conflict.type, resolvedAt: new Date().toISOString() },
      })
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private groupByEntity(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const map = new Map<string, MemoryEntry[]>()
    for (const entry of entries) {
      for (const entity of entry.entities ?? []) {
        if (!map.has(entity)) map.set(entity, [])
        map.get(entity)!.push(entry)
      }
    }
    return map
  }

  private checkPair(a: MemoryEntry, b: MemoryEntry): MemoryConflict | null {
    // Temporal conflict: same title/entity, very different content, different times
    if (a.title && b.title && a.title === b.title) {
      const timeA = new Date(a.createdAt).getTime()
      const timeB = new Date(b.createdAt).getTime()
      const daysDiff = Math.abs(timeA - timeB) / 86_400_000

      if (daysDiff > 1 && a.content !== b.content) {
        return {
          type: 'temporal_conflict',
          entryIds: [a.id, b.id],
          description: `Entry "${a.title}" was recorded differently ${daysDiff.toFixed(0)} days apart`,
          severity: daysDiff > 30 ? 'medium' : 'low',
        }
      }
    }

    // Direct contradiction: shared entity + opposing predicates
    const sharedEntities = (a.entities ?? []).filter((e) => (b.entities ?? []).includes(e))
    if (sharedEntities.length === 0) return null

    for (const [posPattern, negPattern] of CONTRADICTION_PATTERNS) {
      const aHasPos = posPattern.test(a.content) && !negPattern.test(a.content)
      const bHasPos = posPattern.test(b.content) && !negPattern.test(b.content)
      const aHasNeg = negPattern.test(a.content)
      const bHasNeg = negPattern.test(b.content)

      if ((aHasPos && bHasNeg) || (aHasNeg && bHasPos)) {
        return {
          type: 'direct_contradiction',
          entryIds: [a.id, b.id],
          description: `Entries about [${sharedEntities[0]}] contain contradictory statements`,
          severity: sharedEntities.length >= 2 ? 'high' : 'medium',
        }
      }
    }

    return null
  }

  private detectProceduralConflicts(procedures: MemoryEntry[]): MemoryConflict[] {
    const conflicts: MemoryConflict[] = []

    // Group procedures by shared entities (same task domain)
    const byEntityCluster = this.groupByEntity(procedures)

    for (const [, group] of byEntityCluster) {
      if (group.length < 2) continue

      // Check for step-count inconsistency (heuristic: very different lengths suggest different procedures)
      for (let i = 0; i < group.length - 1; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!
          const b = group[j]!

          const stepsA = (a.content.match(/\d+\./g) ?? []).length
          const stepsB = (b.content.match(/\d+\./g) ?? []).length

          if (stepsA > 2 && stepsB > 2 && Math.abs(stepsA - stepsB) > 2) {
            conflicts.push({
              type: 'procedural_inconsistency',
              entryIds: [a.id, b.id],
              description: `Procedure "${a.title ?? a.id}" has ${stepsA} steps but "${b.title ?? b.id}" has ${stepsB} steps for a similar task`,
              severity: 'medium',
            })
          }
        }
      }
    }

    return conflicts
  }
}
