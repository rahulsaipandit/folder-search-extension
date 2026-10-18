import type { IBrainEngine } from '../../interfaces/IBrainEngine'
import type { IVaultProvider } from '../../interfaces/IVaultProvider'
import type { MemoryEntry } from '../../types'

/**
 * KnowledgeGapDetector - Phase 5 proactive synthesis agent.
 *
 * Detects gaps in the knowledge vault by comparing:
 * 1. Frequently retrieved entity clusters with no corresponding vault page
 * 2. High-salience episodic clusters that haven't been synthesized yet
 * 3. Vault pages with low confidence that have new supporting evidence
 *
 * Design: Section 5 (Autonomous Cognition) of designCognitiveBrain.md
 */
export interface KnowledgeGap {
  type: 'missing_page' | 'low_confidence_page' | 'unsynthesized_cluster'
  entityCluster: string[]           // Entities that form the gap topic
  evidenceEntryIds: string[]        // Entry IDs that could fill the gap
  urgency: 'low' | 'medium' | 'high'
  suggestedSlug: string
  reason: string
}

export class KnowledgeGapDetector {
  private readonly brain: IBrainEngine
  private readonly vault: IVaultProvider | null
  constructor(brain: IBrainEngine, vault: IVaultProvider | null) {
    this.brain = brain
    this.vault = vault
  }

  /**
   * Scan memory and vault for knowledge gaps.
   * Returns actionable gaps sorted by urgency.
   */
  async detect(entries: MemoryEntry[]): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = []

    // Gap type 1: frequently co-occurring entities with no vault page
    const entityClusters = this.buildEntityClusters(entries)
    for (const [clusterKey, { entities, entryIds }] of entityClusters) {
      if (entryIds.length < 3) continue // Require at least 3 mentions

      const slug = entities.slice(0, 2).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const hasPage = await this.vaultHasPage(slug)
      if (!hasPage) {
        gaps.push({
          type: 'missing_page',
          entityCluster: entities,
          evidenceEntryIds: entryIds.slice(0, 10),
          urgency: entryIds.length >= 8 ? 'high' : entryIds.length >= 5 ? 'medium' : 'low',
          suggestedSlug: slug,
          reason: `${entryIds.length} entries mention entities [${entities.slice(0, 3).join(', ')}] but no vault page exists`,
        })
      }
    }

    // Gap type 2: high-salience entries (salience > 0.7) not yet synthesized
    const highSalience = entries.filter(
      (e) =>
        (e.salience ?? 0) > 0.7 &&
        e.type !== 'artifact' &&
        e.lifecycleState === 'active' &&
        !e.synthesizedAt
    )
    if (highSalience.length >= 5) {
      gaps.push({
        type: 'unsynthesized_cluster',
        entityCluster: this.extractTopEntities(highSalience),
        evidenceEntryIds: highSalience.slice(0, 10).map((e) => e.id),
        urgency: 'high',
        suggestedSlug: 'auto-synthesis-' + Date.now().toString(36),
        reason: `${highSalience.length} high-salience entries haven't been synthesized into the vault`,
      })
    }

    // Gap type 3: vault pages with low confidence (< 0.6) that have new evidence
    if (this.vault) {
      try {
        const vaultStatus = await this.vault.getStatus()
        if (vaultStatus.pageCount > 0) {
          // Check recently retrieved L1 semantics that match T1-quality vault pages
          const recentSemantics = entries.filter(
            (e) => e.type === 'semantic' && (e.retrievalCount ?? 0) > 2
          )
          for (const entry of recentSemantics.slice(0, 5)) {
            const entitySlug = (entry.entities ?? []).slice(0, 2).join('-').toLowerCase()
            if (entitySlug && await this.vaultHasPage(entitySlug)) {
              // Try to get the page to check its confidence
              const page = await this.vault.readPage(entitySlug).catch(() => null)
              if (page && (page.frontmatter.confidence ?? 1) < 0.6) {
                gaps.push({
                  type: 'low_confidence_page',
                  entityCluster: entry.entities ?? [],
                  evidenceEntryIds: [entry.id],
                  urgency: 'medium',
                  suggestedSlug: entitySlug,
                  reason: `Vault page "${entitySlug}" has confidence ${(page.frontmatter.confidence ?? 0).toFixed(2)} and new evidence available`,
                })
              }
            }
          }
        }
      } catch {
        // Vault unavailable - skip gap type 3
      }
    }

    // Sort by urgency
    const urgencyOrder = { high: 0, medium: 1, low: 2 }
    return gaps.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildEntityClusters(
    entries: MemoryEntry[]
  ): Map<string, { entities: string[]; entryIds: string[] }> {
    // Count co-occurrences of entity pairs across entries
    const clusters = new Map<string, { entities: string[]; entryIds: string[] }>()

    for (const entry of entries) {
      const entities = (entry.entities ?? []).slice(0, 4)
      if (entities.length < 2) continue

      // Use sorted entity pair as cluster key
      for (let i = 0; i < entities.length - 1; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const key = [entities[i]!, entities[j]!].sort().join('::')
          if (!clusters.has(key)) {
            clusters.set(key, { entities: [entities[i]!, entities[j]!], entryIds: [] })
          }
          clusters.get(key)!.entryIds.push(entry.id)
        }
      }
    }

    return clusters
  }

  private extractTopEntities(entries: MemoryEntry[]): string[] {
    const freq = new Map<string, number>()
    for (const entry of entries) {
      for (const entity of entry.entities ?? []) {
        freq.set(entity, (freq.get(entity) ?? 0) + 1)
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entity]) => entity)
  }

  private async vaultHasPage(slug: string): Promise<boolean> {
    if (!this.vault) return false
    try {
      const page = await this.vault.readPage(slug)
      return page !== null
    } catch {
      return false
    }
  }
}
