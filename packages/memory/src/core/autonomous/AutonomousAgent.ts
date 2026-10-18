import type { IBrainEngine } from '../../interfaces/IBrainEngine'
import type { IVaultProvider } from '../../interfaces/IVaultProvider'
import type { MemoryEntry } from '../../types'
import { ConflictDetector, type MemoryConflict } from './ConflictDetector'
import { KnowledgeGapDetector, type KnowledgeGap } from './KnowledgeGapDetector'

/**
 * AutonomousAgent - Phase 5 self-managing cognitive agent.
 *
 * Runs maintenance cycles that:
 * 1. Detect knowledge gaps → schedule synthesis jobs
 * 2. Detect conflicts → flag for resolution or auto-resolve
 * 3. Trigger proactive synthesis for high-priority gaps
 * 4. Refine low-confidence vault artifacts with new evidence
 *
 * Designed to run as a background task - call `runCycle()` periodically.
 * Non-destructive: never deletes entries, only marks/flags/synthesizes.
 *
 * Design: Section 5 (Autonomous Cognition) of designCognitiveBrain.md
 */
export interface AutonomousCycleResult {
  gapsDetected: KnowledgeGap[]
  conflictsDetected: MemoryConflict[]
  synthesisTriggered: number   // Number of synthesis jobs triggered
  artifactsRefined: number     // Number of vault artifacts updated
  cycleMs: number
}

export interface AutonomousAgentConfig {
  brain: IBrainEngine
  vault?: IVaultProvider
  /** Max entries to scan per cycle (performance limit). Default: 200 */
  scanLimit?: number
  /** Only trigger synthesis for gaps with urgency >= threshold. Default: 'medium' */
  synthesisUrgencyThreshold?: 'low' | 'medium' | 'high'
  /** Auto-resolve conflicts by noting them in the vault. Default: false */
  autoResolveConflicts?: boolean
}

export class AutonomousAgent {
  private readonly brain: IBrainEngine
  private readonly vault: IVaultProvider | null
  private readonly gapDetector: KnowledgeGapDetector
  private readonly conflictDetector: ConflictDetector
  private readonly scanLimit: number
  private readonly synthesisUrgencyThreshold: 'low' | 'medium' | 'high'
  private readonly autoResolveConflicts: boolean

  constructor(config: AutonomousAgentConfig) {
    this.brain = config.brain
    this.vault = config.vault ?? null
    this.scanLimit = config.scanLimit ?? 200
    this.synthesisUrgencyThreshold = config.synthesisUrgencyThreshold ?? 'medium'
    this.autoResolveConflicts = config.autoResolveConflicts ?? false
    this.gapDetector = new KnowledgeGapDetector(this.brain, this.vault)
    this.conflictDetector = new ConflictDetector(this.brain)
  }

  /**
   * Run one autonomous maintenance cycle.
   * Safe to call at any frequency - returns quickly if nothing to do.
   */
  async runCycle(): Promise<AutonomousCycleResult> {
    const startedAt = Date.now()

    // Retrieve recent high-salience entries for analysis
    const entries = await this.getAnalysisSet()

    // Run detectors in parallel
    const [gaps, conflicts] = await Promise.all([
      this.gapDetector.detect(entries),
      this.conflictDetector.detect(entries),
    ])

    let synthesisTriggered = 0
    let artifactsRefined = 0

    // Trigger synthesis for actionable gaps
    const urgencyOrder = { low: 0, medium: 1, high: 2 }
    const thresholdLevel = urgencyOrder[this.synthesisUrgencyThreshold]

    for (const gap of gaps) {
      if (urgencyOrder[gap.urgency] >= thresholdLevel) {
        const triggered = await this.triggerSynthesisForGap(gap, entries)
        if (triggered) synthesisTriggered++
      }
    }

    // Handle conflicts
    if (conflicts.length > 0) {
      artifactsRefined += await this.handleConflicts(conflicts, entries)
    }

    return {
      gapsDetected: gaps,
      conflictsDetected: conflicts,
      synthesisTriggered,
      artifactsRefined,
      cycleMs: Date.now() - startedAt,
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getAnalysisSet(): Promise<MemoryEntry[]> {
    // Get top-K entries by recency + salience for the analysis window
    const results = await this.brain.search('', {
      topK: this.scanLimit,
      filter: { lifecycleState: 'active', minSalience: 0.1 },
    })
    return results.items.map((r) => r.entry)
  }

  private async triggerSynthesisForGap(
    gap: KnowledgeGap,
    entries: MemoryEntry[]
  ): Promise<boolean> {
    try {
      const evidenceEntries = entries.filter((e) =>
        gap.evidenceEntryIds.includes(e.id)
      )

      if (evidenceEntries.length === 0) return false

      // For missing pages: synthesize from evidence entries
      if (gap.type === 'missing_page' || gap.type === 'unsynthesized_cluster') {
        const count = await this.brain.synthesize(evidenceEntries)
        return count > 0
      }

      // For low-confidence pages: re-synthesize with new evidence
      if (gap.type === 'low_confidence_page') {
        const count = await this.brain.synthesize(evidenceEntries)
        return count > 0
      }

      return false
    } catch (err) {
      console.warn('[AutonomousAgent] Synthesis failed for gap:', gap.suggestedSlug, err)
      return false
    }
  }

  private async handleConflicts(
    conflicts: MemoryConflict[],
    entries: MemoryEntry[]
  ): Promise<number> {
    let refined = 0

    for (const conflict of conflicts.slice(0, 10)) { // Cap at 10 per cycle
      try {
        if (this.autoResolveConflicts) {
          // Auto-resolution: add `contradicts` relations and note the conflict
          await this.conflictDetector.resolveConflict(conflict, conflict.entryIds[0])

          // Store a new episodic entry documenting the conflict for human review
          await this.brain.store({
            type: 'working',
            content: `⚠️ CONFLICT DETECTED (${conflict.type}): ${conflict.description}. Entry IDs: ${conflict.entryIds.join(', ')}`,
            title: `Conflict: ${conflict.type}`,
            tags: ['conflict', 'needs-review'],
            metadata: {
              prospective: true,
              fireAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), // 24h
              conflictType: conflict.type,
              conflictEntryIds: conflict.entryIds,
            },
          })
          refined++
        }
        // If autoResolveConflicts is false, conflicts are just returned for human handling
      } catch {
        // Non-fatal - continue with other conflicts
      }
    }

    return refined
  }
}
