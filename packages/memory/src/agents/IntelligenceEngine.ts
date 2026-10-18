import type { IIntelligenceEngine } from '../interfaces/IIntelligenceEngine'
import type { IActionRegistry } from '../interfaces/IActionRegistry'
import type { ActionMeta, WorkflowStreamEvent } from '../types'
import type { WorkflowDefinition } from './types'
import type { WorkflowResult } from './WorkflowExecutor'
import { WorkflowExecutor } from './WorkflowExecutor'

/**
 * IntelligenceEngine - wraps WorkflowExecutor to implement IIntelligenceEngine (v2.1).
 *
 * Provides:
 *  - Blocking workflow execution (execute)
 *  - Streaming workflow execution (stream) - live tokens for UI rendering
 *  - Direct skill invocation (executeSkill)
 *  - Skill registry introspection (listSkills)
 */
export class IntelligenceEngine implements IIntelligenceEngine {
	private readonly executor: WorkflowExecutor
	private readonly actionRegistry: IActionRegistry

	constructor(executor: WorkflowExecutor, actionRegistry: IActionRegistry) {
		this.executor = executor
		this.actionRegistry = actionRegistry
	}

	async execute(workflow: WorkflowDefinition): Promise<WorkflowResult> {
		return this.executor.execute(workflow)
	}

	async *stream(workflow: WorkflowDefinition): AsyncIterable<WorkflowStreamEvent> {
		yield* this.executor.stream(workflow)
	}

	async executeSkill(id: string, args: unknown): Promise<unknown> {
		return this.actionRegistry.invoke(id, args, {})
	}

	listSkills(): ActionMeta[] {
		return this.actionRegistry.list()
	}
}
