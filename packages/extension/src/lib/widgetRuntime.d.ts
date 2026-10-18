import { z } from 'zod';
import type { WidgetInstance } from './db';
export { z };
export type { WidgetInstance };
export type StepHandler = (ctx: WidgetContext) => Promise<unknown>;
export interface SpawnRequest {
    role: string;
    widgetId: string;
    input: Record<string, unknown>;
}
export interface WidgetDefinition {
    id: string;
    name: string;
    version: string;
    description: string;
    capabilities: string[];
    input: z.ZodType;
    steps: Record<string, StepHandler>;
}
export interface WidgetContext {
    instanceId: string;
    state: Record<string, unknown>;
    input: Record<string, unknown>;
    browser: {
        tabs: {
            query: (filter: Record<string, unknown>) => Promise<unknown[]>;
            create: (createProperties: {
                url?: string;
                active?: boolean;
            }) => Promise<unknown>;
            update: (tabId: number, updateProperties: {
                url?: string;
                active?: boolean;
            }) => Promise<unknown>;
            remove: (tabId: number) => Promise<boolean>;
        };
        windows: {
            getAll: () => Promise<unknown[]>;
        };
    };
    page: {
        extract: (opts: {
            tabId: number;
        }) => Promise<string>;
        clickElement: (tabId: number, index: number) => Promise<unknown>;
        inputText: (tabId: number, index: number, text: string) => Promise<unknown>;
        scroll: (tabId: number, direction: 'up' | 'down', numPages?: number) => Promise<unknown>;
    };
    llm: {
        complete: (prompt: string) => Promise<string>;
        extract: <T>(content: string, schema: z.ZodType<T>) => Promise<T>;
    };
    storage: {
        put: (key: string, value: unknown) => Promise<void>;
        get: (key: string) => Promise<unknown>;
    };
    timer: {
        wait: (durationMs: number) => Promise<void>;
        schedule: (timestamp: number) => Promise<void>;
        cron: (expression: string) => Promise<void>;
    };
    signals: {
        wait: (signalName: string) => Promise<unknown>;
        send: (instanceId: string, signalName: string, payload?: Record<string, unknown>) => Promise<void>;
    };
    tools: {
        executeBash: (command: string, cwd?: string) => Promise<{
            stdout: string;
            stderr: string;
            exitCode: number;
        }>;
        readFile: (path: string) => Promise<Uint8Array>;
        readFileAsText: (path: string) => Promise<string>;
        writeFile: (path: string, content: Uint8Array | string) => Promise<void>;
        listFiles: (path?: string) => Promise<string[]>;
        deleteFile: (path: string) => Promise<void>;
        fileExists: (path: string) => Promise<boolean>;
        getFileInfo: (path: string) => Promise<{
            size: number;
            lastModified: number;
        } | null>;
        fetchUrl: (url: string, options?: RequestInit) => Promise<{
            status: number;
            headers: Record<string, string>;
            body: string;
        }>;
        updateMemory: (key: string, content: string) => Promise<void>;
        readMemory: (key: string) => Promise<string | null>;
    };
    /** Spawn parallel child agents. Returns their instanceIds. */
    spawn: (requests: SpawnRequest[]) => Promise<string[]>;
    /**
     * Collect outputs from child agents. Suspends until all are complete.
     * Re-entrant: safe to call again after resuming from a collect pause.
     */
    collect: (childInstanceIds: string[]) => Promise<Array<Record<string, unknown>>>;
    /** Task-scoped shared memory readable and writable by any agent in the same task tree. */
    taskMemory: {
        read: (key: string) => Promise<unknown>;
        write: (key: string, value: unknown) => Promise<void>;
    };
}
/**
 * Define a new widget with type safety
 */
export declare function defineWidget<T extends z.ZodType>(def: {
    id: string;
    name: string;
    version: string;
    description: string;
    capabilities: string[];
    input: T;
    steps: Record<string, StepHandler>;
}): WidgetDefinition;
/**
 * Create a new widget instance.
 * opts.taskId - omit for root agents (taskId defaults to instanceId).
 * opts.parentInstanceId - set when spawned by a parent agent.
 * opts.role - defaults to 'worker'.
 */
export declare function createWidgetInstance(widget: WidgetDefinition, input: Record<string, unknown>, opts?: {
    taskId?: string;
    parentInstanceId?: string;
    role?: string;
}): Promise<WidgetInstance>;
/**
 * Execute a single step on a widget instance.
 * Returns the step after this one, or null if this was the last step.
 * On timer/signal pause, returns pause=true and nextStep=stepName so the
 * scheduler re-enters the same step after the wait.
 */
export declare function executeStep(instance: WidgetInstance, stepName: string): Promise<{
    success: boolean;
    nextStep: string | null;
    pause: boolean;
    error?: Error;
}>;
export declare function registerWidget(widget: WidgetDefinition): void;
export declare function getRegisteredWidget(widgetId: string): WidgetDefinition | undefined;
/**
 * Get all active widget instances
 */
export declare function getActiveInstances(): Promise<WidgetInstance[]>;
/**
 * Stop a running widget instance
 */
export declare function stopWidgetInstance(instanceId: string): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * Permanently delete a widget instance and all associated data
 */
export declare function deleteWidgetInstance(instanceId: string): Promise<{
    success: boolean;
    error?: string;
}>;
