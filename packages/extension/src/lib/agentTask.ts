import { z } from 'zod'

import { defineWidget, registerWidget, createWidgetInstance } from './widgetRuntime'

// ──────────────────────────────────────────────────────
// ResearcherWidget
// Opens a URL in a new tab, extracts content, summarises
// with LLM, writes the summary to task-scoped memory.
// ──────────────────────────────────────────────────────
export const ResearcherWidget = defineWidget({
  id: 'org.page-agent.researcher',
  name: 'Researcher',
  version: '1.0.0',
  description: 'Navigates to a URL, extracts content, and writes a summary to task memory',
  capabilities: ['tab.create', 'tab.read', 'tab.interact', 'llm.completion', 'storage.write'],
  input: z.object({
    url: z.string(),
    goal: z.string(),
  }),
  steps: {
    openTab: async (ctx) => {
      const tab = await ctx.browser.tabs.create({
        url: ctx.input.url as string,
        active: false,
      }) as { id: number }
      // Give the page time to load before extracting
      await ctx.timer.wait(5000)
      return { tabId: tab.id }
    },

    extractContent: async (ctx) => {
      const tabId = ctx.state.tabId as number
      let content = ''
      try {
        content = await ctx.page.extract({ tabId })
      } catch {
        content = `[Could not extract content from ${ctx.input.url}]`
      }
      return { content }
    },

    summarize: async (ctx) => {
      const summary = await ctx.llm.complete(
        `You are a research assistant. Extract the most relevant information for this goal.\n\n` +
        `Goal: ${ctx.input.goal}\n\n` +
        `Page content from ${ctx.input.url}:\n${ctx.state.content}\n\n` +
        `Provide a concise summary (3-5 bullet points) of information relevant to the goal.`
      )
      return { summary }
    },

    storeAndClose: async (ctx) => {
      await ctx.taskMemory.write(`result:${ctx.input.url}`, {
        url: ctx.input.url,
        goal: ctx.input.goal,
        summary: ctx.state.summary,
      })
      // Close owned tab
      if (ctx.state.tabId) {
        try {
          await ctx.browser.tabs.remove(ctx.state.tabId as number)
        } catch {
          // Tab may already be closed
        }
      }
    },
  },
})

// ──────────────────────────────────────────────────────
// PlannerWidget
// Accepts a natural-language query, uses LLM to plan
// which URLs to research, spawns ResearcherWidgets in
// parallel, waits for all, then aggregates the results.
// ──────────────────────────────────────────────────────
export const PlannerWidget = defineWidget({
  id: 'org.page-agent.planner',
  name: 'Planner',
  version: '1.0.0',
  description: 'Plans and orchestrates parallel researcher agents, then aggregates their results',
  capabilities: ['llm.completion', 'tab.create', 'tab.read', 'storage.read', 'storage.write'],
  input: z.object({
    query: z.string(),
  }),
  steps: {
    plan: async (ctx) => {
      const raw = await ctx.llm.complete(
        `You are a research planner. Given a user query, decide which URLs to visit and what to look for.\n` +
        `Return ONLY a valid JSON array. Each element must have "url" (full URL with https://) and "goal" (what to extract).\n` +
        `Use 3-6 sources. Prefer well-known, reliable sites appropriate for the query.\n\n` +
        `User query: ${ctx.input.query}\n\n` +
        `JSON array:`
      )
      let plan: Array<{ url: string; goal: string }> = []
      try {
        const match = raw.match(/\[[\s\S]*?\]/)
        plan = JSON.parse(match ? match[0] : raw)
      } catch {
        // Fallback: one search-engine lookup
        plan = [{ url: 'https://news.google.com', goal: ctx.input.query as string }]
      }
      return { plan }
    },

    spawnResearchers: async (ctx) => {
      const plan = ctx.state.plan as Array<{ url: string; goal: string }>
      const childIds = await ctx.spawn(
        plan.map(p => ({
          role: 'researcher',
          widgetId: 'org.page-agent.researcher',
          input: { url: p.url, goal: p.goal },
        }))
      )
      return { childIds }
    },

    waitForResearchers: async (ctx) => {
      const childIds = ctx.state.childIds as string[]
      // ctx.collect suspends until all children complete; re-entrant on resume
      const results = await ctx.collect(childIds)
      return { collectedResults: results }
    },

    aggregate: async (ctx) => {
      const plan = ctx.state.plan as Array<{ url: string; goal: string }>
      const summaries: string[] = []
      for (const p of plan) {
        const entry = await ctx.taskMemory.read(`result:${p.url}`) as { summary: string } | null
        if (entry?.summary) {
          summaries.push(`### ${p.url}\n${entry.summary}`)
        }
      }

      if (summaries.length === 0) {
        return { aggregatedResult: 'No results were collected from the research agents.' }
      }

      const aggregated = await ctx.llm.complete(
        `You are a research aggregator. Below are summaries from multiple sources.\n` +
        `Combine them into a single clear, concise answer. Remove duplicates. Cite sources inline.\n\n` +
        `Original query: ${ctx.input.query}\n\n` +
        summaries.join('\n\n')
      )
      return { aggregatedResult: aggregated }
    },
  },
})

// ──────────────────────────────────────────────────────
// Registration + entry point
// ──────────────────────────────────────────────────────

let registered = false

export function registerAgentWidgets(): void {
  if (registered) return
  registerWidget(ResearcherWidget)
  registerWidget(PlannerWidget)
  registered = true
}

/**
 * Entry point: submit a natural-language query and get back the planner's instanceId.
 * The planner will orchestrate researcher sub-agents automatically.
 *
 * @returns instanceId of the root planner agent (use as taskId for getTaskTree)
 */
export async function createAgentTask(query: string): Promise<string> {
  registerAgentWidgets()
  const instance = await createWidgetInstance(
    PlannerWidget,
    { query },
    { role: 'planner' }
  )
  return instance.instanceId
}
