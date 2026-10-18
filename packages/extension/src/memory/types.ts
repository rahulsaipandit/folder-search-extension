// ===================================================================
// Smriti Memory System - Extension-Local Types
// ===================================================================
// Only types that are specific to the browser extension live here.
// All platform-agnostic types live in @page-agent/memory and are
// imported directly by the files that need them.
// ===================================================================

import type {
  ConsolidationJob,
  EntityKind,
  NodeKind,
  ActivationItem,
  WorkingMemoryBudget,
  EpisodeRecord,
  OutcomeType,
} from "@page-agent/memory"
export type { EntityKind, NodeKind, ActivationItem, WorkingMemoryBudget, OutcomeType }

// ─── Graph visualization types (MemoryBrowser) ────────────────────────────────

export interface CanonicalNode {
  id: string
  kind: string
  label: string
  weight?: number
  metadata?: Record<string, unknown>
}

export interface ScoredGraphEdge {
  from: string
  to: string
  type: string
  weight: number
}

// ─── Storage Quota ────────────────────────────────────────────────────────────

export interface StorageQuota {
  maxBytesTotal: number
  maxBytesEmbeddings: number
  maxEpisodes: number
  maxProcedureVersions: number
  maxRawTurns: number
  maxGraphEdges: number
  watermarkThreshold: number
}

export const DEFAULT_QUOTA: StorageQuota = {
  maxBytesTotal: 200 * 1024 * 1024,
  maxBytesEmbeddings: 50 * 1024 * 1024,
  maxEpisodes: 10_000,
  maxProcedureVersions: 500,
  maxRawTurns: 5_000,
  maxGraphEdges: 100_000,
  watermarkThreshold: 0.85,
}

// ─── Graph Cache - extension-local (visualization layer) ─────────────────────

export interface GraphCacheEntry {
  nodeId: string
  nodeKind: NodeKind
  serialized: string
  version: number
}

// ─── State Snapshots - extension-local (ActivationItem[] strongly typed) ──────

export type SnapshotType = "turn" | "consolidation" | "periodic"

export interface StateSnapshot {
  id: string
  turnId: string
  snapshotType: SnapshotType
  timestamp: number
  workerId: string
  storeName: string
  workingMemory: {
    items: ActivationItem[]
    budget: WorkingMemoryBudget
  }
  graphCacheEntries: GraphCacheEntry[]
  pendingConsolidationJobs: string[]
  pendingExtractionJobs: string[]
  activeSessionId: string
  lastTurnTimestamp: number
  activeTaskContext?: {
    taskId: string
    taskType: string
    pinnedItems: string[]
  }
}

export interface RecoveryResult {
  recovered: boolean
  reason?: string
  lostItems: string[]
  recoveredItems: string[]
  resumedJobs?: string[]
  recoveredWorkingMemory?: ActivationItem[]
  recoveredGraphCache?: Map<string, GraphCacheEntry>
  activeSessionId?: string
  activeTaskContext?: StateSnapshot["activeTaskContext"]
  timeToRecover: number
  coldStart?: boolean
}

// ─── System State ─────────────────────────────────────────────────────────────

export interface SystemState {
  turnId: string
  workingMemory: { items: ActivationItem[]; budget: WorkingMemoryBudget }
  graphCache: Map<string, GraphCacheEntry>
  consolidationQueue: { pending: ConsolidationJob[] }
  extractionQueue: { pending: ConsolidationJob[] }
  sessionId: string
  lastTurnTimestamp: number
  activeTaskId?: string
  activeTaskType?: string
}

// ─── Turn ──────────────────────────────────────────────────────────────────────
// Re-export from @page-agent/memory; TurnRecord is used throughout extension but
// lives in packages/memory now.
export type { TurnRecord, EpisodeRecord } from "@page-agent/memory"
