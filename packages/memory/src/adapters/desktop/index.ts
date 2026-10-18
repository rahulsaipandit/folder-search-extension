/**
 * Desktop adapters (Phase 3 - Node.js / Electron).
 *
 * DesktopBrainEngine: IBrainEngine implementation for desktop.
 *   - Currently uses IndexedDB + Orama (web adapters) as fallback.
 *   - TODO Phase 3+: replace with PGLite + pgvector + Neo4j for full desktop power.
 *
 * MCPBrainServer: Wraps IBrainEngine as an MCP server so external agents
 *   (Claude Code, OpenClaw) can invoke memory operations via MCP tools.
 *
 * Phase 3 additions:
 *   - SourceIngestorOrchestrator / URLIngestor / FileIngestor / PDFIngestor
 *   - PostgresJobQueue: durable Postgres-backed job queue
 *   - MaintenanceCycle: 9-phase cognitive maintenance orchestrator
 */

export { IndexedDBStore as PGLiteStoreFallback, OramaIndex as PgVectorIndexFallback } from '../web/index'
export { DesktopBrainEngine } from './DesktopBrainEngine'
export { MCPBrainServer } from './MCPBrainServer'

// ── Source Ingestors ──────────────────────────────────────────────────────────
export {
	FileIngestor,
	PDFIngestor,
	SourceIngestorOrchestrator,
	URLIngestor,
} from './ingestors/index'
export type { ISourceIngestor, IngestorInput, IngestorOutput } from './ingestors/index'

// ── Postgres Job Queue ────────────────────────────────────────────────────────
export { PostgresJobQueue } from './PostgresJobQueue'
export type { PostgresJobQueueConfig } from './PostgresJobQueue'

// ── Maintenance Cycle (re-export from core) ───────────────────────────────────
export {
	MaintenanceCycle,
} from '../../core/pipeline/MaintenanceCycle'
export type {
	MaintenanceCycleConfig,
	MaintenanceCyclePhaseResult,
	MaintenanceCycleResult,
	MaintenancePhaseName,
} from '../../core/pipeline/MaintenanceCycle'
