import type { LLM } from '@page-agent/llms'

import type { IMemoryService } from '../interfaces/IMemoryService'
import type { IActionRegistry, ActionContext } from '../interfaces/IActionRegistry'
import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type { IWorkflowPersistence } from '../interfaces/IWorkflowPersistence'
import type {
	ContextPack,
	MemorySearchPage,
	MemoryEntry,
	WorkflowStreamEvent,
	ActionDocEdit,
	ActionOptimizationInput,
	ActionOptimizationResult,
} from '../types'
import { AGENT_DEFINITIONS } from './archetypes/definitions'
import type {
	AgentExecutionContext,
	AgentId,
	AgentLLMConfig,
	AgentMemoryContext,
	AgentOutput,
	ParsedToolCall,
	WorkflowDefinition,
} from './types'

// Re-export so callers don't need to import from types directly
export type { ActionOptimizationInput, ActionOptimizationResult }

/**
 * DAG Workflow Executor - Nemilia pattern (from design doc Section 5.1.1).
 *
 * Execution model:
 *   1. Build DAG groups from dagStages
 *   2. Run stages sequentially; agents within a stage run in parallel
 *   3. Each agent receives: task + priorSummary + memCtx + vaultCtx + searchCtx
 *   4. Extract MEMORY[key]: value tokens from outputs
 *   5. If validate: score output 0-10, retry if below valThreshold
 *   6. Final WEAVE agent synthesizes all prior outputs
 *
 * v2.1 additions:
 *   - IActionRegistry: skill invocation replaces raw TOOL_CALL regex dispatch
 *   - IWorkflowPersistence: agent memory is persisted across sessions
 *   - stream(): AsyncGenerator yields WorkflowStreamEvents for live UI rendering
 *   - Skill summary injected into agent system prompts
 */

export interface WorkflowResult {
	workflowId: string
	outputs: AgentOutput[]
	finalOutput: string
	agentMemory: Record<string, string>
	toolCalls: ParsedToolCall[]
	executionMs: number
}

export class WorkflowExecutor {
	private llm: LLM | null = null
	private readonly memory: IMemoryService
	private readonly vault: IVaultProvider | null
	private readonly actionRegistry: IActionRegistry | null
	private readonly persistence: IWorkflowPersistence | null

	constructor(config: {
		memory: IMemoryService
		vault?: IVaultProvider
		llm?: AgentLLMConfig
		actionRegistry?: IActionRegistry
		persistence?: IWorkflowPersistence
	}) {
		this.memory = config.memory
		this.vault = config.vault ?? null
		this.actionRegistry = config.actionRegistry ?? null
		this.persistence = config.persistence ?? null
		this.initLLM(config.llm)
	}

	private async initLLM(config?: AgentLLMConfig): Promise<void> {
		if (!config) return
		try {
			const { LLM } = await import('@page-agent/llms')
			this.llm = new LLM({
				baseURL: config.baseURL,
				model: config.model,
				apiKey: config.apiKey ?? '',
				temperature: 0.5,
				maxRetries: 2,
			})
		} catch {
			console.warn('[Memory/WorkflowExecutor] LLM unavailable - agent execution disabled')
		}
	}

	async execute(workflow: WorkflowDefinition): Promise<WorkflowResult> {
		const startedAt = Date.now()

		// Build memory context
		const memCtx = await this.buildMemoryContext(workflow.prompt)

		// Resolve prompt template
		const task = workflow.prompt

		// Build DAG stages: Map<stageNumber, agentIds[]>
		const stages = buildDagStages(workflow)

		const allOutputs: AgentOutput[] = []
		const allToolCalls: ParsedToolCall[] = []

		// Load persisted agent memory for this workflow session
		const sessionId = workflow.id
		const agentMemory: Record<string, string> = this.persistence
			? await this.persistence.loadAgentMemory(sessionId)
			: {}

		// Execute stages sequentially
		for (const [, agentIds] of stages) {
			const stageContext: AgentExecutionContext = {
				task,
				priorSummary: summarizeOutputs(allOutputs),
				memCtx,
				searchCtx: '',
				agentMemory,
			}

			// Run agents in this stage in parallel
			const stageOutputs = await Promise.all(
				agentIds.map((agentId) =>
					this.runAgent(agentId, stageContext, workflow)
				)
			)

			for (const output of stageOutputs) {
				allOutputs.push(output)

				// Merge memory tokens
				for (const [k, v] of Object.entries(output.memoryTokens)) {
					agentMemory[k] = v
				}

				// Collect tool calls for resolution
				allToolCalls.push(...output.toolCalls)
			}

			// Resolve TOOL_CALL blocks if TOOLS agent ran this stage
			await this.resolveToolCalls(allToolCalls, stageContext)
		}

		// Persist agent memory if workflow.memory is true
		if (workflow.memory) {
			for (const [key, value] of Object.entries(agentMemory)) {
				await this.memory.create({
					type: 'working',
					content: `MEMORY[${key}]: ${value}`,
					title: key,
					metadata: { workflowId: workflow.id, memoryKey: key },
				})
			}
			// Persist to IWorkflowPersistence
			if (this.persistence) {
				await this.persistence.saveAgentMemory(sessionId, agentMemory)
			}
		}

		// Final output: last WEAVE output or last agent output
		const weaveOutput = [...allOutputs].reverse().find((o) => o.agentId === 'WEAVE')
		const finalOutput = weaveOutput?.content ?? allOutputs[allOutputs.length - 1]?.content ?? ''

		const result: WorkflowResult = {
			workflowId: workflow.id,
			outputs: allOutputs,
			finalOutput,
			agentMemory,
			toolCalls: allToolCalls,
			executionMs: Date.now() - startedAt,
		}

		// Save completed workflow result
		if (this.persistence) {
			await this.persistence.saveWorkflowResult({
				workflowId: workflow.id,
				finalOutput,
				agentMemory,
				executionMs: result.executionMs,
				completedAt: new Date().toISOString(),
				sessionId,
			}).catch(() => {})
		}

		return result
	}

	/**
	 * Stream a workflow execution as AsyncGenerator of WorkflowStreamEvents.
	 * Each agent emits agent.started → agent.token* → agent.completed.
	 * Callers can render live token output while SCOUT is still searching.
	 */
	async *stream(workflow: WorkflowDefinition): AsyncGenerator<WorkflowStreamEvent> {
		const startedAt = Date.now()

		const memCtx = await this.buildMemoryContext(workflow.prompt)
		const task = workflow.prompt
		const stages = buildDagStages(workflow)

		const allOutputs: AgentOutput[] = []
		const allToolCalls: ParsedToolCall[] = []
		const sessionId = workflow.id
		const agentMemory: Record<string, string> = this.persistence
			? await this.persistence.loadAgentMemory(sessionId)
			: {}

		let stageNumber = 0

		try {
			for (const [, agentIds] of stages) {
				const stageContext: AgentExecutionContext = {
					task,
					priorSummary: summarizeOutputs(allOutputs),
					memCtx,
					searchCtx: '',
					agentMemory,
				}

				// In streaming mode, run stage agents sequentially so UI sees ordered events
				for (const agentId of agentIds) {
					yield { type: 'agent.started', agentId, stageNumber }

					const output = await this.runAgentWithTokens(agentId, stageContext, workflow,
						async function*(token) {
							yield { type: 'agent.token' as const, agentId, token }
						}
					)

					// Emit any skill/tool calls made during this agent's run
					for (const tc of output.toolCalls) {
						yield {
							type: 'agent.tool_call',
							agentId,
							toolCall: { actionId: tc.tool, args: tc.args },
						}
					}

					allOutputs.push(output)
					for (const [k, v] of Object.entries(output.memoryTokens)) {
						agentMemory[k] = v
					}
					allToolCalls.push(...output.toolCalls)

					yield { type: 'agent.completed', agentId, output }
				}

				// Resolve tool calls accumulated this stage
				await this.resolveToolCalls(allToolCalls, stageContext)
				stageNumber++
			}

			// Persist memory
			if (workflow.memory) {
				for (const [key, value] of Object.entries(agentMemory)) {
					await this.memory.create({
						type: 'working',
						content: `MEMORY[${key}]: ${value}`,
						title: key,
						metadata: { workflowId: workflow.id, memoryKey: key },
					})
				}
				if (this.persistence) {
					await this.persistence.saveAgentMemory(sessionId, agentMemory).catch(() => {})
				}
			}

			const weaveOutput = [...allOutputs].reverse().find((o) => o.agentId === 'WEAVE')
			const finalOutput = weaveOutput?.content ?? allOutputs[allOutputs.length - 1]?.content ?? ''
			const executionMs = Date.now() - startedAt

			const result: WorkflowResult = {
				workflowId: workflow.id,
				outputs: allOutputs,
				finalOutput,
				agentMemory,
				toolCalls: allToolCalls,
				executionMs,
			}

			if (this.persistence) {
				await this.persistence.saveWorkflowResult({
					workflowId: workflow.id,
					finalOutput,
					agentMemory,
					executionMs,
					completedAt: new Date().toISOString(),
					sessionId,
				}).catch(() => {})
			}

			yield { type: 'workflow.completed', result }
		} catch (err) {
			yield { type: 'workflow.error', error: String(err) }
		}
	}

	// ── Agent execution ──────────────────────────────────────────────────────

	private async runAgent(
		agentId: AgentId,
		ctx: AgentExecutionContext,
		workflow: WorkflowDefinition
	): Promise<AgentOutput> {
		// Use runAgentWithTokens without yielding tokens
		return this.runAgentWithTokens(agentId, ctx, workflow)
	}

	private async runAgentWithTokens(
		agentId: AgentId,
		ctx: AgentExecutionContext,
		workflow: WorkflowDefinition,
		_onToken?: (token: string) => AsyncGenerator<WorkflowStreamEvent>
	): Promise<AgentOutput> {
		const definition = AGENT_DEFINITIONS[agentId]

		if (!this.llm) {
			// T3 fallback - return structured placeholder
			return {
				agentId,
				content: `[${agentId}] T3 fallback: LLM not configured. Task: ${ctx.task.slice(0, 100)}`,
				memoryTokens: {},
				toolCalls: [],
			}
		}

		// Inject skill summary if registry is available
		const skillSummary = this.actionRegistry?.buildActionSummary() ?? ''
		const systemPrompt = skillSummary
			? `${definition.systemPrompt}\n\n${skillSummary}`
			: definition.systemPrompt

		const userMessage = buildAgentUserMessage(ctx, agentId)

		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
				{
					respond: {
						description: 'Your response as this agent',
						inputSchema: {
							parse: (v: unknown) => v as { content: string },
						} as never,
						execute: async (args: { content: string }) => args,
					},
				},
				abort.signal,
				{ toolChoiceName: 'respond' }
			)

			const content = (result.toolResult as { content: string })?.content ?? ''
			const memoryTokens = extractMemoryTokens(content)

			// Skill-aware tool call resolution
			const toolCalls = await this.extractAndExecuteSkillCalls(content, ctx)

			let output: AgentOutput = { agentId, content, memoryTokens, toolCalls }

			// Validation
			if (workflow.validate) {
				const score = await this.validateOutput(output, ctx)
				output.score = score

				if (score < workflow.orchestrator.valThreshold) {
					// Retry once with feedback
					output = await this.retryWithFeedback(output, ctx, workflow)
				}
			}

			return output
		} catch (err) {
			return {
				agentId,
				content: '',
				memoryTokens: {},
				toolCalls: [],
				error: String(err),
			}
		}
	}

	/**
	 * Extract SKILL_CALL and legacy TOOL_CALL blocks from agent output,
	 * execute them via IActionRegistry, and return parsed calls.
	 */
	private async extractAndExecuteSkillCalls(
		content: string,
		ctx: AgentExecutionContext
	): Promise<ParsedToolCall[]> {
		const calls: ParsedToolCall[] = []

		// Legacy TOOL_CALL format (kept for backward compatibility)
		for (const match of content.matchAll(TOOL_CALL_RE)) {
			try {
				const parsed = JSON.parse(match[1]!)
				const call: ParsedToolCall = {
					tool: parsed.tool ?? '',
					server: parsed.server ?? 'vault',
					args: parsed.args ?? {},
				}
				calls.push(call)

				// If skill registry available and skill ID matches, invoke it
				if (this.actionRegistry && parsed.skill_id) {
					try {
						const skillCtx: ActionContext = {
							sessionId: ctx.agentMemory.sessionId,
							metadata: { agentMemory: ctx.agentMemory },
						}
						const result = await this.actionRegistry.invoke(parsed.skill_id, parsed.args ?? {}, skillCtx)
						ctx.agentMemory[`skill_result_${parsed.skill_id}`] = JSON.stringify(result)
					} catch (err) {
						console.warn(`[WorkflowExecutor] Skill "${parsed.skill_id}" failed:`, err)
					}
				}
			} catch {
				// Malformed tool call block - skip
			}
		}

		return calls
	}

	private async validateOutput(
		output: AgentOutput,
		ctx: AgentExecutionContext
	): Promise<number> {
		if (!this.llm) return 7

		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[
					{
						role: 'user',
						content: `Rate this agent output 0-10 for quality, completeness, and accuracy.\nTask: ${ctx.task.slice(0, 200)}\nOutput: ${output.content.slice(0, 500)}\nReturn JSON: { "score": <number 0-10> }`,
					},
				],
				{
					score: {
						description: 'Quality score 0-10',
						inputSchema: {
							parse: (v: unknown) => v as { score: number },
						} as never,
						execute: async (args: { score: number }) => args,
					},
				},
				abort.signal
			)
			return (result.toolResult as { score: number })?.score ?? 7
		} catch {
			return 7
		}
	}

	private async retryWithFeedback(
		output: AgentOutput,
		ctx: AgentExecutionContext,
		workflow: WorkflowDefinition
	): Promise<AgentOutput> {
		if (!this.llm) return output

		const definition = AGENT_DEFINITIONS[output.agentId]
		const retryMessage = `${buildAgentUserMessage(ctx, output.agentId)}\n\nPrevious output scored ${output.score}/10. Issues: low quality or incomplete. Please improve.`

		try {
			const abort = new AbortController()
			const result = await this.llm.invoke(
				[
					{ role: 'system', content: definition.systemPrompt },
					{ role: 'user', content: retryMessage },
				],
				{
					respond: {
						description: 'Improved response',
						inputSchema: {
							parse: (v: unknown) => v as { content: string },
						} as never,
						execute: async (args: { content: string }) => args,
					},
				},
				abort.signal
			)

			const content = (result.toolResult as { content: string })?.content ?? output.content
			return {
				agentId: output.agentId,
				content,
				memoryTokens: extractMemoryTokens(content),
				toolCalls: await this.extractAndExecuteSkillCalls(content, ctx),
				score: workflow.orchestrator.valThreshold + 1, // Optimistic after retry
			}
		} catch {
			return output
		}
	}

	// ── MCP Tool resolution ──────────────────────────────────────────────────

	private async resolveToolCalls(
		toolCalls: ParsedToolCall[],
		ctx: AgentExecutionContext
	): Promise<void> {
		if (!this.vault) return

		for (const call of toolCalls) {
			if (call.server !== 'vault') continue

			try {
				let result: unknown
				switch (call.tool) {
					case 'query_wiki':
						result = await this.vault.queryWiki(call.args.question as string)
						break
					case 'search_pages':
						result = await this.vault.searchPages(call.args.query as string)
						break
					case 'read_page':
						result = await this.vault.readPage(call.args.slug as string)
						break
					case 'get_context_pack':
						result = await this.vault.getContextPack(call.args.prompt as string)
						break
					default:
						continue
				}

				// Store result in agent memory
				ctx.agentMemory[`tool_result_${call.tool}`] = JSON.stringify(result)
			} catch (err) {
				console.warn(`[WorkflowExecutor] Tool call "${call.tool}" failed:`, err)
			}
		}
	}

	// ── Skill optimization (SkillOpt integration) ────────────────────────────

	/**
	 * Optimize a skill's instructionDoc based on scored failure trajectories.
	 *
	 * Runs a two-stage FORGE→TRAIN workflow:
	 *   Stage 0 (FORGE): Critique all failure trajectories, identify failure patterns
	 *   Stage 1 (TRAIN): Propose minimal ActionDocEdit[] to improve the instructionDoc
	 *
	 * Returns proposed edits only — no writes happen here. The caller is responsible
	 * for validation (EditValidator, Phase 3) and acceptance (saveSkillTrainingRecord).
	 *
	 * See: packages/extension/docs/SkillOptDesign.md
	 */
	async optimizeSkill(input: ActionOptimizationInput): Promise<ActionOptimizationResult> {
		const { actionId, currentInstructionDoc, trajectories } = input

		if (trajectories.length === 0) {
			return { actionId, edits: [], rawOutput: '' }
		}

		// Build the trajectory context FORGE will receive
		const trajectoryContext = trajectories
			.map((t, i) => {
				const outcomeLabel = t.score <= 3 ? 'failure' : t.score <= 6 ? 'marginal' : 'weak'
				const summary = t.sessionSummary ?? `Task: ${t.actionId}. Outcome: ${outcomeLabel}.`
				return `--- Trajectory ${i + 1} (session: ${t.sessionId}, score: ${t.score}/10) ---\n${summary}`
			})
			.join('\n\n')

		const currentDoc = currentInstructionDoc
			? `CURRENT instructionDoc:\n${currentInstructionDoc}`
			: 'No instructionDoc exists yet — propose an initial one if the trajectories reveal a clear gap.'

		const prompt = [
			`Skill ID: ${actionId}`,
			currentDoc,
			`\nFAILURE TRAJECTORIES (${trajectories.length} total):`,
			trajectoryContext,
		].join('\n')

		// Two-stage FORGE→TRAIN DAG. FORGE critiques all trajectories together;
		// TRAIN then reads FORGE's output via priorSummary and proposes edits.
		const workflow: WorkflowDefinition = {
			id: `skill-opt-${actionId.replace(/[^a-z0-9]/gi, '-')}`,
			name: `Optimize skill: ${actionId}`,
			agentIds: ['FORGE', 'TRAIN'],
			prompt,
			dag: true,
			dagStages: { FORGE: 0, TRAIN: 1 },
			feedbackLoops: {},
			conditions: {},
			hitlOverrides: {},
			validate: false,
			memory: false,
			orchestrator: { planTemp: 0.3, synthTemp: 0.2, valThreshold: 7 },
		}

		const result = await this.execute(workflow)

		const forgeOutput = result.outputs.find((o) => o.agentId === 'FORGE')
		const trainOutput = result.outputs.find((o) => o.agentId === 'TRAIN')

		const edits = parseSkillDocEdits(trainOutput?.content ?? '')

		return {
			actionId,
			edits,
			forgeScore: forgeOutput?.score,
			rawOutput: result.finalOutput,
		}
	}

	// ── Memory context ───────────────────────────────────────────────────────

	private async buildMemoryContext(prompt: string): Promise<AgentMemoryContext> {
		const [workingMemory, localRecall] = await Promise.all([
			this.memory.getWorkingMemory(),
			this.memory.search(prompt, { topK: 5 }),
		])

		let vaultContext: ContextPack = { artifacts: [], totalTokens: 0 }
		if (this.vault) {
			try {
				vaultContext = await this.vault.getContextPack(prompt, 2048)
			} catch {
				// Vault unavailable - continue with local context
			}
		}

		return {
			workingMemory,
			vaultContext,
			localRecall,
			memoryStore: {
				create: this.memory.create.bind(this.memory),
				addRelation: this.memory.addRelation.bind(this.memory),
				checkProspectiveMemory: this.memory.checkProspectiveMemory.bind(this.memory),
			},
			vaultProvider: this.vault
				? {
						readPage: this.vault.readPage.bind(this.vault),
						searchPages: this.vault.searchPages.bind(this.vault),
						queryWiki: this.vault.queryWiki.bind(this.vault),
					}
				: {
						readPage: async () => null,
						searchPages: async () => [],
						queryWiki: async () => ({ answer: '', sources: [], confidence: 0 }),
					},
			actions: this.actionRegistry ?? undefined,
			persistence: this.persistence ?? undefined,
		}
	}
}

// ── DAG helpers ───────────────────────────────────────────────────────────────

function buildDagStages(
	workflow: WorkflowDefinition
): Map<number, AgentId[]> {
	const stages = new Map<number, AgentId[]>()

	if (!workflow.dag || Object.keys(workflow.dagStages).length === 0) {
		// Linear: each agent in its own stage
		workflow.agentIds.forEach((id, i) => {
			stages.set(i, [id])
		})
		return stages
	}

	for (const agentId of workflow.agentIds) {
		const stage = workflow.dagStages[agentId] ?? 0
		if (!stages.has(stage)) stages.set(stage, [])
		stages.get(stage)!.push(agentId)
	}

	return new Map([...stages.entries()].sort((a, b) => a[0] - b[0]))
}

// ── Token extraction ──────────────────────────────────────────────────────────

const MEMORY_TOKEN_RE = /MEMORY\[([^\]]+)\]:\s*(.+)/g
const TOOL_CALL_RE = /TOOL_CALL:\s*(\{[^}]+\})/g

function extractMemoryTokens(content: string): Record<string, string> {
	const tokens: Record<string, string> = {}
	for (const match of content.matchAll(MEMORY_TOKEN_RE)) {
		tokens[match[1]!] = match[2]!.trim()
	}
	return tokens
}

// ── Message builders ──────────────────────────────────────────────────────────

function buildAgentUserMessage(ctx: AgentExecutionContext, agentId: AgentId): string {
	const parts: string[] = []

	parts.push(`TASK: ${ctx.task}`)

	if (ctx.priorSummary) {
		parts.push(`\nPRIOR CONTEXT:\n${ctx.priorSummary}`)
	}

	if (ctx.memCtx.workingMemory.length > 0) {
		const memLines = ctx.memCtx.workingMemory
			.slice(0, 5)
			.map((e) => `- ${e.title ?? e.content.slice(0, 80)}`)
			.join('\n')
		parts.push(`\nWORKING MEMORY:\n${memLines}`)
	}

	if (ctx.memCtx.localRecall.items.length > 0) {
		const recallLines = ctx.memCtx.localRecall.items
			.slice(0, 3)
			.map((r) => `- [${r.score.toFixed(2)}] ${r.entry.title ?? r.entry.content.slice(0, 80)}`)
			.join('\n')
		parts.push(`\nRELEVANT MEMORIES:\n${recallLines}`)
	}

	if (ctx.memCtx.vaultContext.artifacts.length > 0) {
		const vaultLines = ctx.memCtx.vaultContext.artifacts
			.slice(0, 2)
			.map((a) => `- [[${a.slug}]]: ${a.content.slice(0, 120)}`)
			.join('\n')
		parts.push(`\nVAULT KNOWLEDGE:\n${vaultLines}`)
	}

	if (Object.keys(ctx.agentMemory).length > 0) {
		const memLines = Object.entries(ctx.agentMemory)
			.slice(0, 5)
			.map(([k, v]) => `MEMORY[${k}]: ${v}`)
			.join('\n')
		parts.push(`\nSHARED MEMORY:\n${memLines}`)
	}

	return parts.join('\n')
}

function summarizeOutputs(outputs: AgentOutput[]): string {
	if (outputs.length === 0) return ''
	return outputs
		.filter((o) => !o.error && o.content)
		.map((o) => `[${o.agentId}]: ${o.content.slice(0, 200)}`)
		.join('\n\n')
}

// ── SkillOpt helpers ──────────────────────────────────────────────────────────

/**
 * Extract a ActionDocEdit[] from TRAIN's raw output.
 * TRAIN is instructed to wrap its JSON in a ```json block; we also accept bare arrays
 * as a fallback in case the model omits the fence.
 * Returns empty array when TRAIN outputs NO_EDIT or when JSON is malformed.
 */
function parseSkillDocEdits(content: string): ActionDocEdit[] {
	if (content.includes('NO_EDIT')) return []

	// Try fenced ```json block first, then bare JSON array
	const fencedMatch = content.match(/```json\s*([\s\S]+?)\s*```/)
	const bareMatch = content.match(/(\[[\s\S]+\])/)
	const raw = fencedMatch?.[1] ?? bareMatch?.[1]
	if (!raw) return []

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(isSkillDocEdit)
	} catch {
		return []
	}
}

/** Type guard: validates that a parsed JSON value is a well-formed ActionDocEdit. */
function isSkillDocEdit(v: unknown): v is ActionDocEdit {
	if (typeof v !== 'object' || v === null) return false
	const e = v as Record<string, unknown>
	return (
		typeof e.type === 'string' &&
		['replace', 'append', 'delete'].includes(e.type) &&
		typeof e.target === 'string' &&
		['instructionDoc', 'triggers', 'description'].includes(e.target) &&
		typeof e.before === 'string' &&
		typeof e.after === 'string' &&
		typeof e.rationale === 'string'
	)
}
