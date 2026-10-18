/**
 * VectorIndexSync - periodic sync from IDB stores into the SemanticSearchBridge.
 *
 * Phase 4 - ported from packages/extension/src/memory/vectorIndexSync.ts.
 * Uses injected data sources so it works with any IDB backend.
 */

import type { FactRecord, EntityRecord, EpisodeRecord, ProcedureRecord, ProcedureVersionRecord } from '../../types'
import type { SemanticSearchBridge } from './OramaIndex'

export interface IVectorSyncDataSources {
	getFacts(): Promise<FactRecord[]>
	getEntities(): Promise<EntityRecord[]>
	getEpisodesBySalience(threshold: number): Promise<EpisodeRecord[]>
	getProcedures(): Promise<ProcedureRecord[]>
	getLatestProcedureVersion(procedureId: string): Promise<ProcedureVersionRecord | undefined>
}

export class VectorIndexSync {
	private lastSyncTimestamp = 0
	private syncTimer: ReturnType<typeof setInterval> | null = null
	private isSyncing = false
	private bridge: SemanticSearchBridge
	private sources: IVectorSyncDataSources

	constructor(bridge: SemanticSearchBridge, sources: IVectorSyncDataSources) {
		this.bridge = bridge
		this.sources = sources
	}

	async syncNow(): Promise<{
		factsIndexed: number
		episodesIndexed: number
		entitiesIndexed: number
		proceduresIndexed: number
		total: number
	}> {
		if (this.isSyncing) return { factsIndexed: 0, episodesIndexed: 0, entitiesIndexed: 0, proceduresIndexed: 0, total: 0 }
		this.isSyncing = true

		try {
			await this.bridge.ensureEmbedder()

			const entries: { id: string; text: string; kind: any; metadata?: Record<string, unknown> }[] = []

			const facts = await this.sources.getFacts()
			for (const f of facts) {
				entries.push({ id: f.id, text: f.statement, kind: 'fact', metadata: { confidence: f.confidence, evidenceCount: f.evidenceCount } })
			}

			const episodes = await this.sources.getEpisodesBySalience(0.2)
			for (const ep of episodes) {
				entries.push({ id: ep.id, text: ep.summary, kind: 'episode', metadata: { outcome: ep.outcome, salience: ep.salience, timestamp: ep.timestamp } })
			}

			const entities = await this.sources.getEntities()
			for (const e of entities) {
				entries.push({ id: e.id, text: `${e.name}${e.description ? `: ${e.description}` : ''}`, kind: 'entity', metadata: { entityType: e.entityType } })
			}

			const procedures = await this.sources.getProcedures()
			for (const proc of procedures) {
				const version = await this.sources.getLatestProcedureVersion(proc.id)
				if (version) {
					entries.push({ id: proc.id, text: `${proc.name}: ${version.steps.map(s => s.name).join(', ')}`, kind: 'procedure', metadata: { domain: proc.domain, reliability: proc.reliabilityScore, status: proc.status } })
				}
			}

			await this.bridge.buildIndex(entries)
			this.lastSyncTimestamp = Date.now()

			return {
				factsIndexed: facts.length,
				episodesIndexed: episodes.length,
				entitiesIndexed: entities.length,
				proceduresIndexed: procedures.length,
				total: entries.length,
			}
		} finally {
			this.isSyncing = false
		}
	}

	startPeriodicSync(intervalMs = 5 * 60 * 1000): void {
		if (this.syncTimer) return
		this.syncTimer = setInterval(async () => {
			try { await this.syncNow() } catch (err) { console.warn('[VectorIndexSync] Periodic sync failed:', err) }
		}, intervalMs)
	}

	stopPeriodicSync(): void {
		if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null }
	}

	stats() {
		return { lastSyncTimestamp: this.lastSyncTimestamp, isSyncing: this.isSyncing, bridgeStats: this.bridge.stats() }
	}
}
