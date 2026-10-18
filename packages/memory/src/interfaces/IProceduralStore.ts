import type {
	ProcedureRecord,
	ProcedureVersionRecord,
	ProcedureStep,
} from '../types'

/**
 * Storage contract for versioned procedural memory.
 * Implementations: IndexedDBProceduralStore (web/extension),
 *   SQLiteProceduralStore (mobile - Phase 3),
 *   PGLiteProceduralStore (desktop - Phase 3).
 */
export interface IProceduralStore {
	// ── Procedure CRUD ────────────────────────────────────────────────────────

	createProcedure(params: {
		id: string
		name: string
		domain: string
		latestVersionId: string
		stableVersionId?: string
		status: ProcedureRecord['status']
		tags: string[]
		linkedEntities: string[]
		reliabilityScore: number
		successCount: number
		failureCount: number
		consecutiveSuccesses: number
	}): Promise<ProcedureRecord>

	getProcedure(id: string): Promise<ProcedureRecord | null>
	getProcedureByName(name: string): Promise<ProcedureRecord | null>
	getProceduresByDomain(domain: string): Promise<ProcedureRecord[]>
	getAllProcedures(): Promise<ProcedureRecord[]>
	updateProcedure(id: string, partial: Partial<ProcedureRecord>): Promise<void>

	// ── Version CRUD ──────────────────────────────────────────────────────────

	createVersion(params: {
		id: string
		procedureId: string
		version: number
		parentVersionId?: string
		steps: ProcedureStep[]
		rationale: string
		createdFromEpisodeIds: string[]
		status: ProcedureVersionRecord['status']
	}): Promise<ProcedureVersionRecord>

	getVersion(id: string): Promise<ProcedureVersionRecord | null>
	getLatestVersion(procedureId: string): Promise<ProcedureVersionRecord | null>
	getVersionHistory(procedureId: string): Promise<ProcedureVersionRecord[]>

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	initialize(): Promise<void>
	close(): Promise<void>
}
