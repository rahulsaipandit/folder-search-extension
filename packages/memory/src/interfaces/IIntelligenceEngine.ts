import type { ActionMeta, WorkflowStreamEvent } from '../types'

/**
 * IIntelligenceEngine - agent personas, workflow execution, skill management (v2.1).
 * Web/mobile only. Desktop uses external agents (Claude Code, OpenClaw) via MCP.
 *
 * Section 2.4 and 6.1.1 of designCognitiveBrain.md
 */
export interface IIntelligenceEngine {
	/**
	 * Execute a workflow definition and return the final result (blocking).
	 * For interactive use, prefer stream() for live token output.
	 */
	execute(workflow: import('../agents/types').WorkflowDefinition): Promise<import('../agents/WorkflowExecutor').WorkflowResult>

	/**
	 * Stream a workflow execution. Each agent emits tokens as WorkflowStreamEvents.
	 * Users see SCOUT findings arrive before WEAVE begins synthesis.
	 */
	stream(workflow: import('../agents/types').WorkflowDefinition): AsyncIterable<WorkflowStreamEvent>

	/** Execute a single skill by ID. */
	executeSkill(id: string, args: unknown): Promise<unknown>

	/** List available skills. */
	listSkills(): ActionMeta[]
}
