# Setup Guide

Complete guide for building, running, and deploying the Page Agent monorepo locally and in production.

---

## Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Development](#development)
  - [Website](#website)
  - [Browser Extension](#browser-extension)
  - [Demo Mode](#demo-mode)
- [Building](#building)
  - [All Packages](#all-packages)
  - [Libraries Only](#libraries-only)
  - [Website](#website-1)
  - [Extension](#extension)
- [Memory Platform (`@page-agent/memory`)](#memory-platform-page-agentmemory)
  - [Web / Extension — `createWebBrainEngine`](#web--extension--createwebbhrainengine)
  - [Desktop — `MCPBrainServer`](#desktop--mcpbrainserver)
  - [Postgres Job Queue](#postgres-job-queue)
  - [Vault Providers](#vault-providers)
  - [Built-in Skills](#built-in-skills)
  - [Autonomous Agents](#autonomous-agents)
- [Type Checking & Linting](#type-checking--linting)
- [Deployment](#deployment)
  - [GitHub Pages (current default)](#github-pages-current-default)
  - [Vercel](#vercel)
- [Monorepo Structure](#monorepo-structure)

---

## Prerequisites

| Tool | Required version |
|---|---|
| Node.js | `^22.13.0` or `>=24` |
| npm | `^11.6.3` |
| TypeScript | `^6.0.2` (installed as dev dependency) |

Install the correct Node version using [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 22
nvm use 22
```

For Postgres-backed desktop features, PostgreSQL 14+ is recommended but optional — the system falls back to an in-memory queue when Postgres is not available.

---

## Installation

```bash
git clone https://github.com/rahulsaipandit/rahulpandit.git
cd rahulpandit
npm install
```

The `postinstall` hook in the extension package runs `wxt prepare` automatically to generate the WXT type definitions.

---

## Environment Variables

Create a `.env` file in the **repository root** (the website's Vite config reads it from `../../.env` relative to `packages/website/`):

```bash
# ── LLM (required for agent features) ────────────────────────────────────────
LLM_API_KEY=sk-...                  # Your OpenAI-compatible API key
LLM_BASE_URL=https://api.openai.com/v1   # Or any OpenAI-compatible base URL
LLM_MODEL_NAME=gpt-4o-mini         # Model to use for T1/T2 inference

# ── Vault (optional — skip to use local IndexedDB only) ──────────────────────
VAULT_URL=http://localhost:3001/sse # MCP vault server URL
VAULT_API_KEY=                      # Vault API key (if required)

# ── Web Search skill (optional) ───────────────────────────────────────────────
# Pass via SkillContext.metadata at runtime — not an env var directly.
# See "Built-in Skills → webSearch" below for details.

# ── Postgres (optional — desktop job queue) ───────────────────────────────────
DATABASE_URL=postgres://user:pass@localhost:5432/page_agent
```

> **Note:** All `LLM_*` variables are injected into the website bundle at build time via Vite. They are **public** in the browser bundle — use a proxy or edge function for sensitive keys in production.

---

## Development

### Website

```bash
npm run dev --workspace=@page-agent/website
```

Starts the Vite dev server at `http://localhost:5173`. The site is a React SPA using wouter for routing with base path `/page-agent`.

**Adding a new page:**

1. Create `packages/website/src/pages/MyPage.tsx`
2. Add the route in `packages/website/src/router.tsx`
3. Add the path to `SPA_ROUTES` in `packages/website/vite.config.js` (required for GitHub Pages and static hosting)

### Browser Extension

```bash
npm run dev:ext
# or
npm run dev -w @page-agent/ext
```

Starts WXT in watch mode and opens a browser with the extension hot-loaded. Chrome profile is stored at `packages/extension/.wxt/chrome-data/`.

**Required browser permissions** (declared in `wxt.config.js`):
- `tabs`, `tabGroups`, `sidePanel`, `storage`
- `host_permissions: ['<all_urls>']`

### Demo Mode

```bash
npm run dev:demo
```

Runs the `page-agent` IIFE demo build with a local file server on port `5174`. Useful for testing the agent without the full extension.

---

## Building

### All Packages

```bash
npm run build
```

Runs `scripts/build.js` which builds all packages in topological order.

### Libraries Only

```bash
npm run build:libs
```

Builds all library packages (`core`, `llms`, `page-controller`, `ui`, `memory`, `page-agent`) without the website or extension.

### Website

```bash
npm run build:website
# or
npm run build:website --workspace=@page-agent/website
```

This runs two steps in sequence:
1. `build:corpus` — generates the embedded search corpus (`scripts/embed.mjs`)
2. `vite build` — produces a production build in `packages/website/dist/`

Output is a static SPA in `packages/website/dist/`.

### Extension

```bash
npm run build:ext
```

Produces a production build and a zip archive:
- Build output: `packages/extension/.output/`
- Zip file: `page-agent-ext-{version}-chrome.zip`

To load the unpacked extension in Chrome, point to `packages/extension/.output/chrome-mv3/`.

---

## Memory Platform (`@page-agent/memory`)

The Hybrid Cognitive Memory Platform (v2.1) is implemented in `packages/memory/`. It provides:

- Local-first episodic memory (IndexedDB on web, SQLite on mobile, Postgres on desktop)
- T0/T1/T2 tiered LLM synthesis pipeline
- Knowledge graph with 3-pass building and community detection
- 20 built-in skills across 8 categories
- Autonomous agents (gap detection, conflict detection, risk analysis)

### Web / Extension — `createWebBrainEngine`

The primary entry point for browser and extension consumers:

```typescript
import { createWebBrainEngine } from '@page-agent/memory'

const brain = await createWebBrainEngine({
  dbName: 'my-app-memory',       // IndexedDB database name (default: "page-agent-memory")
  llm: {
    t1: {
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: process.env.LLM_API_KEY,
    },
    t2: {                         // optional: higher-quality model for synthesis
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      apiKey: process.env.LLM_API_KEY,
    },
  },
  vaultUrl: 'http://localhost:3001/sse',  // optional MCP vault server
  vaultApiKey: 'my-api-key',
  sessionId: 'user-session-123',
  tokenBudget: 4096,             // working memory token limit
  synthesisThreshold: 10,        // entries before auto-synthesis triggers
})

// Store a memory entry
await brain.store({
  type: 'episodic',
  content: 'Discussed architecture decisions for the new auth system.',
  tags: ['architecture', 'auth'],
})

// Semantic search
const results = await brain.search('authentication design', { topK: 5 })

// Ask the brain a question (T1/T2 synthesis answer)
const answer = await brain.think('What authentication approaches have I considered?')

// Assemble a context pack for an agent prompt
const ctx = await brain.getContextPack('auth system design', 4096)

// Run maintenance (retention policies, graph rewire, etc.)
await brain.runRetentionPolicies()
```

**Using the full Intelligence layer** (streaming DAG workflows):

```typescript
import { createWebBrainEngine, WorkflowExecutor, IntelligenceEngine, createDefaultSkillRegistry } from '@page-agent/memory'
import { HybridWorkflowPersistence } from '@page-agent/memory'

const brain = await createWebBrainEngine({ llm: { t1: { ... } } })
const skills = createDefaultSkillRegistry()
const persistence = new HybridWorkflowPersistence()

const executor = new WorkflowExecutor({ memory: brain, skillRegistry: skills, persistence })
const intelligence = new IntelligenceEngine(executor, skills)

// Streaming execution — each agent emits tokens as they generate
for await (const event of intelligence.stream({
  id: 'research-001',
  name: 'Research Workflow',
  agentIds: ['SCOUT', 'LENS', 'WEAVE'],
  prompt: 'Summarise the current state of WebAssembly for production use.',
  dag: true,
  dagStages: { SCOUT: 1, LENS: 2, WEAVE: 3 },
  feedbackLoops: {},
  conditions: {},
  hitlOverrides: {},
  validate: true,
  memory: true,
  orchestrator: { planTemp: 0.3, synthTemp: 0.6, valThreshold: 7 },
})) {
  if (event.type === 'agent.token') process.stdout.write(event.token ?? '')
  if (event.type === 'workflow.completed') console.log('\nDone:', event.result)
}
```

### Desktop — `MCPBrainServer`

Exposes the brain as an MCP server for external agents (Claude Code, OpenClaw, Hermes, Cursor):

```typescript
import { createWebBrainEngine } from '@page-agent/memory'
import { MCPBrainServer } from '@page-agent/memory/adapters/desktop'

const brain = await createWebBrainEngine({ llm: { t1: { ... } } })
const server = new MCPBrainServer(brain, {
  name: 'my-brain',      // MCP server name (default: "page-agent-brain")
  version: '2.1.0',
})

await server.start()     // Listens on stdio — connect via MCP client
```

**Claude Code MCP config** (`.claude/mcp.json` or `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "page-agent-brain": {
      "command": "node",
      "args": ["path/to/brain-server.js"]
    }
  }
}
```

**Exposed MCP tools:** `search`, `think`, `store`, `synthesize`, `get_context_pack`, `run_retention_policies`

### Postgres Job Queue

For desktop deployments requiring durable background job processing:

```typescript
import { PostgresJobQueue } from '@page-agent/memory/adapters/desktop'

const queue = new PostgresJobQueue({
  connectionString: 'postgres://user:pass@localhost:5432/page_agent',
  tableName: 'page_agent_jobs',   // default
  pollIntervalMs: 2000,           // default
  maxParallel: 4,                 // default
  budgetMs: 30_000,               // max ms per job
})

await queue.initialize()  // Creates the jobs table if it doesn't exist
queue.start()             // Begins polling for pending jobs
```

The queue falls back to an in-memory implementation if `pg` is not installed or the connection fails. Create the database before initializing:

```bash
createdb page_agent
```

### Vault Providers

**MCP Vault** (works with any MCP-compatible vault server, e.g. Tolaria):

```typescript
import { MCPVaultClient } from '@page-agent/memory/vault'

const vault = new MCPVaultClient({
  serverUrl: 'http://localhost:3001/sse',   // SSE endpoint
  apiKey: 'optional-auth-token',
  providerName: 'tolaria',
})
```

**Obsidian Vault** (local filesystem, Node.js only):

```typescript
import { ObsidianVaultProvider } from '@page-agent/memory/vault'

const vault = new ObsidianVaultProvider({
  vaultDir: '/Users/you/Documents/MyVault',   // absolute path to vault
  subfolder: 'page-agent',                    // default — agent pages live here
  brain,                                      // optional, used for queryWiki
})
```

Agent-managed pages are written to `{vaultDir}/page-agent/` and do not touch the rest of your vault.

### Built-in Skills

The default skill registry ships with 21 skills across 8 categories:

| Category | Skills |
|---|---|
| `compute` | `calculate`, `urlEncode`, `urlDecode` |
| `time` | `currentTime`, `epochTime` |
| `page` | `pageMarkdown`, `htmlSanitize`, `pageSummarizer` |
| `media` | `svgProcessor`, `colorLookup` |
| `text` | `textRephraser` |
| `browser` | `click`, `fill`, `scroll`, `navigate`, `extractText` |
| `vault` | `readPage`, `queryWiki`, `searchPages`, `executiveSummary` |
| `search` | `webSearch` |

```typescript
import { createDefaultSkillRegistry } from '@page-agent/memory/skills'

const skills = createDefaultSkillRegistry()

// Deterministic — zero LLM cost
const result = await skills.invoke('org.page-agent.compute.calculate', { expression: '2**10' }, {})
// → { result: 1024 }

// Web search — requires API key passed via context metadata
const search = await skills.invoke(
  'org.page-agent.search.web',
  { query: 'TypeScript 6 release notes', topK: 5 },
  {
    metadata: {
      searchApiKey: process.env.BRAVE_API_KEY,
      searchProvider: 'brave',  // 'brave' | 'tavily' | 'serper'
    },
  }
)

// Executive summary of the last 7 days
const summary = await skills.invoke(
  'org.page-agent.vault.executive-summary',
  { timeWindowDays: 7, maxSentences: 8 },
  { brainEngine: brain }
)
```

**Discover custom skills from the filesystem** (Node.js / desktop):

```typescript
const count = await skills.loadFromDirectory('./my-skills')
console.log(`Loaded ${count} custom skills`)
```

Each skill is a `SKILL.md` file with YAML frontmatter (name, description, version, allowed-tools) and a body describing what the skill does and how `$ARGUMENTS` are passed.

### Autonomous Agents

```typescript
import { AutonomousAgent, KnowledgeGapDetector, ConflictDetector, RiskAnalyzer } from '@page-agent/memory'
import { ImpactAnalyzer, CommunityDetector } from '@page-agent/memory'

// Run a full autonomous maintenance cycle
const agent = new AutonomousAgent({
  brain,
  vault,                              // optional
  scanLimit: 200,                     // entries per cycle
  synthesisUrgencyThreshold: 'medium',
  autoResolveConflicts: false,        // set true to auto-annotate conflicts
})

const report = await agent.runCycle()
console.log('Gaps found:', report.gapsDetected.length)
console.log('Conflicts:', report.conflictsDetected.length)
console.log('Synthesis jobs triggered:', report.synthesisTriggered)

// Risk analysis (requires InProcessGraph)
const { graph } = brain   // access via internal if needed — or pass directly
// const riskAnalyzer = new RiskAnalyzer(brain, graph, impactAnalyzer)
```

### 9-Phase Maintenance Cycle

```typescript
import { MaintenanceCycle } from '@page-agent/memory'

const cycle = new MaintenanceCycle({
  store, index, graph, pipeline, synthesisEngine,
  vault,
  quality: 'T1',   // 'T2' on desktop for higher-quality synthesis
})

// Run all 9 phases with a 30-second budget
const result = await cycle.run(30_000)
result.phases.forEach(p =>
  console.log(`${p.name}: ${p.durationMs}ms, processed=${p.processed}${p.skipped ? ' [skipped]' : ''}`)
)

// Run specific phases only
await cycle.runPhases(['retention_policies', 'vault_sync'])
```

---

## Type Checking & Linting

```bash
# Typecheck all packages (except extension)
npm run typecheck

# Typecheck extension separately
npx tsc --noEmit -p packages/extension/tsconfig.json

# Lint
npm run lint
```

---

## Deployment

### GitHub Pages (current default)

The website is configured for GitHub Pages with base path `/rahulpandit/`:

```bash
npm run build:website
# Output: packages/website/dist/
```

Push `packages/website/dist/` to the `gh-pages` branch, or configure GitHub Actions to do so on push to `main`.

The `SPA_ROUTES` array in `packages/website/vite.config.js` must include every client-side route that needs a direct-URL entry point — the build step generates an `index.html` copy for each.

### Vercel

While the project currently deploys to GitHub Pages, it can be deployed to Vercel as a static site.

**Step 1 — Import the repository in Vercel**

Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository.

**Step 2 — Configure the build**

In the Vercel project settings, set:

| Setting | Value |
|---|---|
| Framework Preset | **Vite** |
| Root Directory | `packages/website` |
| Build Command | `npm run build:website` |
| Output Directory | `dist` |
| Install Command | `cd ../.. && npm install` |

**Step 3 — Environment variables**

Add the following in **Project → Settings → Environment Variables**:

| Variable | Example value | Notes |
|---|---|---|
| `LLM_API_KEY` | `sk-...` | Required for agent features |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Or any OpenAI-compatible endpoint |
| `LLM_MODEL_NAME` | `gpt-4o-mini` | Model for T1 inference |
| `VAULT_URL` | `https://your-vault.example.com/sse` | Optional MCP vault |
| `VAULT_API_KEY` | — | Optional vault auth |

> **Security note:** `LLM_API_KEY` is embedded in the browser bundle at build time. For production use, put it behind a Vercel Edge Function proxy rather than exposing it directly.

**Step 4 — SPA routing**

Add a `vercel.json` file at `packages/website/vercel.json` to handle client-side routing:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Step 5 — Deploy**

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from the website package directory
cd packages/website
vercel --prod
```

Or push to the connected branch — Vercel will deploy automatically via its GitHub integration.

---

## Monorepo Structure

```
packages/
├── core/            @page-agent/core      — headless agent logic
├── page-agent/      page-agent            — agent + UI entry point (npm package)
├── website/         @page-agent/website   — docs and landing page (React + Vite)
├── extension/       @page-agent/ext       — browser extension (WXT + React)
├── llms/            @page-agent/llms      — LLM client with tiered inference
├── page-controller/ @page-agent/page-controller  — DOM operations
├── ui/              @page-agent/ui        — Panel and i18n
├── memory/          @page-agent/memory    — Hybrid Cognitive Memory Platform
└── mcp/             @page-agent/mcp       — MCP server utilities

scripts/
├── build.js         — orchestrated full build
├── build-libs.js    — library-only build
├── sync-version.js  — sync version across all packages
├── pre-publish.js   — promote publishConfig before npm publish
└── post-publish.js  — restore dev config after publish
```

Packages are listed in `workspaces` in topological order — `memory` depends on `llms`, the extension depends on `memory`, etc. The `build:libs` script respects this order.
