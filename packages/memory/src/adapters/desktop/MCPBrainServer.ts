import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import type { IBrainEngine } from '../../interfaces/IBrainEngine'

/**
 * MCPBrainServer - exposes IBrainEngine as MCP tools.
 *
 * External agents (Claude Code, OpenClaw, any MCP-compatible client) can invoke:
 *   - search        → brain.search()
 *   - think         → brain.think()
 *   - store         → brain.store()
 *   - synthesize    → brain.synthesize()
 *   - get_context_pack → brain.getContextPack()
 *   - run_retention_policies → brain.runRetentionPolicies()
 *
 * Transport: stdio (default) or configurable via MCPBrainServerConfig.
 *
 * Usage:
 *   const brain = await DesktopBrainEngine.create({ llm: { t1: {...} } })
 *   const server = new MCPBrainServer(brain)
 *   await server.start()   // blocks until process exits
 */
export class MCPBrainServer {
	private readonly mcp: McpServer
	private readonly brain: IBrainEngine
	private readonly config: MCPBrainServerConfig

	constructor(brain: IBrainEngine, config: MCPBrainServerConfig = {}) {
		this.brain = brain
		this.config = config
		this.mcp = new McpServer({
			name: config.name ?? 'page-agent-brain',
			version: config.version ?? '2.1.0',
		})

		this.registerTools()
	}

	async start(): Promise<void> {
		const transport = new StdioServerTransport()
		await this.mcp.connect(transport)
		console.error('[MCPBrainServer] Listening on stdio')
	}

	// ── Tool registration ─────────────────────────────────────────────────────

	private registerTools(): void {
		this.registerSearchTool()
		this.registerThinkTool()
		this.registerStoreTool()
		this.registerSynthesizeTool()
		this.registerGetContextPackTool()
		this.registerRunRetentionPoliciesTool()
	}

	private registerSearchTool(): void {
		this.mcp.registerTool(
			'search',
			{
				description: 'Hybrid semantic + keyword search across the memory store. Returns ranked entries with scores.',
				inputSchema: {
					query: z.string().describe('Search query'),
					topK: z
						.number()
						.int()
						.min(1)
						.max(50)
						.optional()
						.default(10)
						.describe('Max results to return'),
					type: z
						.enum(['episodic', 'semantic', 'insight', 'procedure', 'goal', 'entity', 'working', 'artifact', 'prospective'])
						.optional()
						.describe('Filter by memory type'),
				},
			},
			async ({ query, topK, type }) => {
				try {
					const filter = type ? { type } : undefined
					const results = await this.brain.search(query, { topK, filter })
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(
									{
										total: results.total,
										hasMore: results.hasMore,
										items: results.items.map((r) => ({
											id: r.entry.id,
											type: r.entry.type,
											title: r.entry.title,
											content: r.entry.content.slice(0, 300),
											score: r.score,
											createdAt: r.entry.createdAt,
											tags: r.entry.tags,
										})),
									},
									null,
									2
								),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}

	private registerThinkTool(): void {
		this.mcp.registerTool(
			'think',
			{
				description: 'Answer a natural-language question by searching memory context and synthesizing a direct answer with LLM. Returns answer, confidence, and source entry IDs.',
				inputSchema: {
					query: z.string().describe('Question to answer'),
				},
			},
			async ({ query }) => {
				try {
					const result = await this.brain.think(query)
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(result, null, 2),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}

	private registerStoreTool(): void {
		this.mcp.registerTool(
			'store',
			{
				description: 'Store a new memory entry. Returns the assigned ID. Write succeeds immediately; pipeline enrichment (embedding, entities, salience) is async.',
				inputSchema: {
					type: z
						.enum(['episodic', 'semantic', 'insight', 'procedure', 'goal', 'entity', 'working', 'artifact', 'prospective'])
						.describe('Memory type'),
					content: z.string().min(1).describe('Main content of the memory'),
					title: z.string().optional().describe('Short title / headline'),
					importance: z
						.number()
						.int()
						.min(1)
						.max(5)
						.optional()
						.describe('Static importance score 1-5'),
					tags: z.array(z.string()).optional().describe('Tags for filtering'),
					sessionId: z.string().optional().describe('Session ID to scope the memory'),
				},
			},
			async ({ type, content, title, importance, tags, sessionId }) => {
				try {
					const id = await this.brain.store({
						type,
						content,
						title,
						importance,
						tags,
						sessionId,
					})
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({ id, type, title }, null, 2),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}

	private registerSynthesizeTool(): void {
		this.mcp.registerTool(
			'synthesize',
			{ description: 'Trigger the synthesis pipeline over all active memory entries. Compiles changed entries into vault knowledge artifacts. Returns count of artifacts produced.' },
			async () => {
				try {
					const count = await this.brain.synthesize()
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({ artifactsProduced: count }, null, 2),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}

	private registerGetContextPackTool(): void {
		this.mcp.registerTool(
			'get_context_pack',
			{
				description: 'Assemble a token-budgeted context pack for injection into an agent prompt. Returns working memory + semantic search + vault artifacts within the budget.',
				inputSchema: {
					prompt: z.string().describe('The agent prompt or topic to assemble context for'),
					budgetTokens: z
						.number()
						.int()
						.min(256)
						.max(32768)
						.optional()
						.default(4096)
						.describe('Token budget for context assembly (default 4096)'),
				},
			},
			async ({ prompt, budgetTokens }) => {
				try {
					const pack = await this.brain.getContextPack(prompt, budgetTokens)
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(
									{
										totalTokens: pack.totalTokens,
										artifactCount: pack.artifacts.length,
										artifacts: pack.artifacts.map((a) => ({
											slug: a.slug,
											title: a.title,
											content: a.content.slice(0, 500),
											updatedAt: a.updatedAt,
										})),
									},
									null,
									2
								),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}

	private registerRunRetentionPoliciesTool(): void {
		this.mcp.registerTool(
			'run_retention_policies',
			{ description: 'Run retention policies over all active entries: compact_raw (age>30d, salience<0.3), demote_episode (salience<0.15), tombstone_episode (age>90d, salience<0.15). Also prunes weak graph edges.' },
			async () => {
				try {
					const result = await this.brain.runRetentionPolicies()
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(result, null, 2),
							},
						],
					}
				} catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
						isError: true,
					}
				}
			}
		)
	}
}

export interface MCPBrainServerConfig {
	name?: string
	version?: string
}
