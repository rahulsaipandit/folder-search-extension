import type { HistoricalEvent } from '@page-agent/core';
import { type DBSchema, type IDBPDatabase } from 'idb';
export interface SessionRecord {
    id: string;
    task: string;
    history: HistoricalEvent[];
    status: 'in_progress' | 'completed' | 'error';
    createdAt: number;
    updatedAt: number;
}
export interface FavoriteRecord {
    id: string;
    prompt: string;
    createdAt: number;
    label?: string;
}
export interface WidgetInstance {
    instanceId: string;
    widgetId: string;
    version: string;
    status: 'idle' | 'running' | 'waiting' | 'scheduled' | 'completed' | 'failed' | 'paused' | 'cancelled';
    currentStep: string | null;
    attempt: number;
    input: Record<string, unknown>;
    state: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    lastRunAt: number | null;
    nextRunAt: number | null;
    taskId: string;
    parentInstanceId?: string;
    role: string;
    ownedTabId?: number;
    output?: Record<string, unknown>;
}
export interface TaskScratchpad {
    taskId: string;
    key: string;
    value: unknown;
    updatedAt: number;
}
export interface WidgetEvent {
    instanceId: string;
    seq: number;
    type: string;
    stepId: string | null;
    ts: number;
    payload: Record<string, unknown>;
    prevHash: string;
    eventHash: string;
}
export interface Lease {
    instanceId: string;
    ownerId: string;
    expiresAt: number;
    heartbeatAt: number;
}
export interface WorkQueueItem {
    instanceId: string;
    priority: number;
    nextRunAt: number;
}
export interface Signal {
    instanceId: string;
    signalName: string;
    payload: Record<string, unknown>;
    createdAt: number;
}
export interface Snapshot {
    snapshotId: string;
    instanceId: string;
    seq: number;
    stateHash: string;
    stateJson: string;
    createdAt: number;
}
export interface TabContext {
    tabId: number;
    url: string;
    title: string;
    lastSeenAt: number;
    domHash: string;
}
export interface KVMetadata {
    key: string;
    value: unknown;
    updatedAt: number;
}
interface PageAgentDB extends DBSchema {
    sessions: {
        key: string;
        value: SessionRecord;
        indexes: {
            'by-created': number;
        };
    };
    favorites: {
        key: string;
        value: FavoriteRecord;
        indexes: {
            'by-created': number;
        };
    };
    widget_instances: {
        key: 'instanceId';
        value: WidgetInstance;
        indexes: {
            'by-status': string;
            'by-widgetId': string;
            'by-created': number;
            'by-taskId': string;
            'by-parentId': string;
        };
    };
    task_scratchpad: {
        key: [string, string];
        value: TaskScratchpad;
        indexes: {
            'by-taskId': string;
        };
    };
    widget_events: {
        key: ['instanceId', 'seq'];
        value: WidgetEvent;
        indexes: {
            'by-type': string;
            'by-stepId': string;
        };
    };
    work_queue: {
        key: 'nextRunAt';
        value: WorkQueueItem;
        indexes: {
            'by-instanceId': string;
            'by-priority': number;
        };
    };
    leases: {
        key: 'instanceId';
        value: Lease;
        indexes: {
            'by-expiresAt': number;
            'by-owner': string;
        };
    };
    signals: {
        key: ['instanceId', 'signalName'];
        value: Signal;
        indexes: {
            'by-createdAt': number;
        };
    };
    snapshots: {
        key: 'snapshotId';
        value: Snapshot;
        indexes: {
            'by-instanceId': string;
            'by-seq': number;
        };
    };
    tab_context: {
        key: 'tabId';
        value: TabContext;
        indexes: {
            'by-lastSeenAt': number;
        };
    };
    kv_metadata: {
        key: 'key';
        value: KVMetadata;
    };
}
export declare function getDB(): Promise<IDBPDatabase<PageAgentDB>>;
/** Create a session at task start, persisted immediately as in_progress */
export declare function createSession(task: string): Promise<SessionRecord>;
/** Incrementally persist history after each step */
export declare function updateSession(id: string, history: HistoricalEvent[]): Promise<void>;
/** Mark session as completed or error when done */
export declare function finalizeSession(id: string, status: 'completed' | 'error'): Promise<void>;
/** Finalize all in_progress sessions as error (called on startup when agent is not running) */
export declare function cleanupStaleSessions(): Promise<void>;
/** @deprecated Use createSession + finalizeSession instead */
export declare function saveSession(session: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionRecord>;
/** List sessions, newest first */
export declare function listSessions(): Promise<SessionRecord[]>;
export declare function getSession(id: string): Promise<SessionRecord | undefined>;
export declare function deleteSession(id: string): Promise<void>;
export declare function clearSessions(): Promise<void>;
export declare function saveFavorite(prompt: string, label?: string): Promise<FavoriteRecord>;
/** List favorites, newest first */
export declare function listFavorites(): Promise<FavoriteRecord[]>;
export declare function getFavorite(id: string): Promise<FavoriteRecord | undefined>;
export declare function deleteFavorite(id: string): Promise<void>;
export declare function clearFavorites(): Promise<void>;
/** Check if a prompt is already favorited */
export declare function isFavorite(prompt: string): Promise<boolean>;
/** Remove a favorite by prompt text */
export declare function removeFavoriteByPrompt(prompt: string): Promise<void>;
/** All instances belonging to a task tree (same taskId) */
export declare function getTaskTree(rootInstanceId: string): Promise<WidgetInstance[]>;
/** All child instances of a given parent */
export declare function getChildInstances(parentInstanceId: string): Promise<WidgetInstance[]>;
/** All instances across all tasks */
export declare function getAllInstances(): Promise<WidgetInstance[]>;
/** Read a value from the task-scoped shared scratchpad */
export declare function readTaskScratchpad(taskId: string, key: string): Promise<unknown>;
/** Write a value to the task-scoped shared scratchpad */
export declare function writeTaskScratchpad(taskId: string, key: string, value: unknown): Promise<void>;
/** Read all scratchpad entries for a task */
export declare function readAllTaskScratchpad(taskId: string): Promise<TaskScratchpad[]>;
export {};
