import { ActionDefinition, ActionContext, ActionError, ActionInvoker, ActionMeta } from './types';
import { globalActionRegistry } from './actionRegistry';

export class ActionExecutionEngine implements ActionInvoker {
  list(): string[] {
    return globalActionRegistry.list();
  }

  describe(actionId: string): ActionMeta | null {
    const action = globalActionRegistry.get(actionId);
    if (!action) return null;
    /**RP_DONE: Zod input schema - returned so the LLM macro tool receives correct parameter definitions.
     * Action tools were registered with z.any() schema → LLM received no parameter spec → called action with {} → real schema validation failed.
     * Fix: Pipe each action's actual Zod schema through describe() → ActionMeta.inputSchema → PageAgentCore action tool registration.
     */
    return { name: action.name, description: action.description, inputSchema: action.inputSchema };
  }

  /**
   * Deterministic-first routing for natural language queries.
   *
   * Tries exact action-ID match first, then trigger-keyword scan.
   * Returns null if no deterministic match is found - the caller should
   * then fall back to LLM-based action selection.
   */
  resolveByQuery(query: string): ActionDefinition | null {
    return globalActionRegistry.resolve(query);
  }

  async invoke<TInput, TOutput>(
    actionId: string,
    input: TInput,
    context: ActionContext
  ): Promise<TOutput> {
    // Use resolve() so that trigger-keyword matches work even when the caller
    // passes a natural language string instead of an exact action ID.
    const action = globalActionRegistry.resolve<TInput, TOutput>(actionId);
    if (!action) {
      throw new ActionError(`Action "${actionId}" not found - no exact ID match and no trigger matched`, { type: 'permanent', code: 'ACTION_NOT_FOUND' });
    }

    // Validate input
    try {
      action.inputSchema.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new ActionError(`Invalid input for action ${actionId}${detail}`, { type: 'permanent', code: 'INVALID_INPUT' });
    }

    // Per-action timeout override; fall back to LLM-assisted vs deterministic defaults
    const timeoutMs = action.timeoutMs ?? (action.fallbackToLLM ? 30_000 : 5_000);

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    context.signal?.addEventListener('abort', onParentAbort);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await action.execute(input, { ...context, signal: controller.signal });

      // Validate output
      try {
        return action.outputSchema.parse(result);
      } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        throw new ActionError(`Invalid output from action ${actionId}${detail}`, { type: 'permanent', code: 'INVALID_OUTPUT' });
      }
    } catch (error) {
      if (error instanceof ActionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ActionError(`Action execution failed: ${message}`, { type: 'transient' });
    } finally {
      clearTimeout(timeoutId);
      context.signal?.removeEventListener('abort', onParentAbort);
    }
  }
}

// Global instance
export const globalActionExecutionEngine = new ActionExecutionEngine();
