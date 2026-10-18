import { z } from 'zod';

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  id: string; // Unique identifier, e.g., 'org.page-agent.time.current'
  name: string; // Human-readable name, e.g., 'Get Current Time'
  description: string; // Brief description for agent context
  version: string; // Semantic version, e.g., '1.0.0'
  capabilities: string[]; // Required capabilities, e.g., ['system.time']
  /**
   * Keyword triggers for deterministic-first routing.
   * When a natural language query matches any trigger (case-insensitive substring),
   * the registry resolves this action without consulting the LLM.
   * Examples: ['what time', 'current time', 'what is the time']
   */
  triggers?: string[];
  inputSchema: z.ZodType<TInput>; // Zod schema for input validation
  outputSchema: z.ZodType<TOutput>; // Zod schema for output validation
  fallbackToLLM?: boolean; // Opt-in: allow fallback to LLM if action fails (default: false)
  timeoutMs?: number; // Override execution timeout; defaults to 5000ms (deterministic) or 30000ms (LLM-assisted)
  /**
   * Natural-language guidance injected into the agent system prompt when this action
   * is active. This is the trainable surface for the trajectory optimization loop —
   * the FORGE→TRAIN DAG refines it from scored failure trajectories without touching
   * execute(). Undefined means the agent receives only `description` as guidance.
   *
   * See: packages/extension/docs/SkillOptDesign.md
   */
  instructionDoc?: string;
  /**
   * Few-shot usage examples attached to the action.
   * Used by TRAIN to understand expected behaviour when proposing instructionDoc edits.
   */
  examples?: ActionExample[];
  execute: (input: TInput, context: ActionContext) => Promise<TOutput>; // Execution function
}

/** A few-shot usage example for an action, used during trajectory-driven optimization. */
export interface ActionExample {
  input: string;
  expectedOutput: string;
  notes?: string;
}

export interface ActionMeta {
  name: string;
  description: string;
  /**RP_DONE: Zod input schema - returned so the LLM macro tool receives correct parameter definitions.
   * Action tools were registered with z.any() schema → LLM received no parameter spec → called action with {} → real schema validation failed.
   * Fix: Pipe each action's actual Zod schema through describe() → ActionMeta.inputSchema → PageAgentCore action tool registration.
   */
  inputSchema?: z.ZodType;
}

export interface ActionContext {
  agentId: string; // ID of the invoking agent
  instanceId?: string; // Widget instance ID if applicable
  timestamp: number; // Invocation timestamp
  signal?: AbortSignal; // Cancellation token for timeout handling
}

export class ActionError extends Error {
  type: 'transient' | 'permanent';
  code?: string;

  constructor(message: string, options: { type: 'transient' | 'permanent'; code?: string }) {
    super(message);
    this.name = 'ActionError';
    this.type = options.type;
    this.code = options.code;
  }
}

export interface ActionInvoker {
  invoke<TInput, TOutput>(
    actionId: string,
    input: TInput,
    context: ActionContext
  ): Promise<TOutput>;
  list?(): string[]; // Optional method to list available action IDs
  describe?(actionId: string): ActionMeta | null; // Name + description for LLM tool registration
}

export interface WidgetExecutionContext {
  // Existing properties...
  actions: ActionInvoker;
  // Other context properties
}
