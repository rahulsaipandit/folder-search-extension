# @page-agent/memory

**Hybrid Cognitive Memory Platform** — local-first episodic memory, synthesis engine, knowledge graph, and vault integration for Page Agent.

> Architecture reference: `packages/extension/docs/designCognitiveBrain.md`

---

## Architecture

```
Local episodic memory (IndexedDB/SQLite)
    ↓  T0 extraction + T1 synthesis
Canonical Markdown Artifacts
    ↓  MCP
Central Vault (Tolaria / Obsidian / any MCP-compatible vault)
```

Three independently operable tiers:

| Tier | Platform | Role |
|------|----------|------|
| **Working Cognition** | Web / Mobile | Capture events, lightweight synthesis, read vault |
| **Deep Cognition** | Desktop (Phase 3) | Full synthesis, graph reasoning, source ingestion |
| **Canonical Memory** | Central Vault (MCP) | Synthesized markdown artifacts, shared across all tiers |

---

## Quick Start (Web / Extension)

```typescript
import { createWebMemoryService } from '@page-agent/memory'

const memory = await createWebMemoryService({
  dbName: 'my-app-memory',
  llm: {
    t1: { baseURL: 'http://localhost:11434/v1', model: 'llama3.2:3b' }
  },
  vaultUrl: 'http://localhost:3001/sse',  // optional MCP vault
})

// Store an episodic event
const id = await memory.create({
  type: 'episodic',
  content: 'Discussed architecture decisions for the new API design',
  outcome: 'resolved',
  tags: ['architecture', 'api'],
})

// Search memories
const results = await memory.search('API architecture decisions', { topK: 5 })

// Trigger synthesis (compiles episodic → vault artifacts)
const count = await memory.consolidate()

memory.on('synthesis.completed', ({ count }) => {
  console.log(`${count} vault artifacts produced`)
})
```

---

## Package Structure

```
src/
├── interfaces/          # IMemoryService, IMemoryStore, IMemoryIndex, IVaultProvider
├── core/
│   ├── MemoryService.ts          # Cognitive orchestration hub
│   ├── pipeline/                 # Async enrichment pipeline
│   │   └── processors/
│   │       ├── T0EntityExtractor.ts   # Zero-cost entity extraction
│   │       ├── T0SalienceProcessor.ts # Salience scoring + retention policy
│   │       └── T1SummarizationProcessor.ts # LLM summarization
│   ├── synthesis/
│   │   └── SynthesisEngine.ts    # Two-phase compile pipeline
│   ├── graph/
│   │   └── InProcessGraph.ts     # In-memory knowledge graph (Phase 1)
│   └── working/
│       └── WorkingMemory.ts      # Token-budgeted session context
├── adapters/
│   ├── web/                      # IndexedDBStore + OramaIndex
│   ├── mobile/                   # Stubs (Phase 1 mobile)
│   └── desktop/                  # Stubs (Phase 3)
├── vault/
│   └── MCPVaultClient.ts         # Generic MCP vault adapter
├── agents/
│   ├── archetypes/definitions.ts # 8 Nemilia agent archetypes
│   └── WorkflowExecutor.ts       # DAG workflow executor
├── jobs/
│   └── JobQueue.ts               # In-memory background job queue
├── factory.ts                    # createWebMemoryService()
└── index.ts                      # All exports
```

---

## Subpath Exports

```typescript
import { MemoryService }     from '@page-agent/memory'            // core
import { IndexedDBStore }    from '@page-agent/memory/adapters/web'
import { MCPVaultClient }    from '@page-agent/memory/vault'
import { WorkflowExecutor }  from '@page-agent/memory/agents'
import type { IMemoryService } from '@page-agent/memory/interfaces'
```

---

## LLM Tiers

| Tier | Model | Usage | Mobile |
|------|-------|-------|--------|
| T0 | None (regex/heuristics) | Entity extraction, salience | Always |
| T1 | Small local (Ollama/MLC) | Summarization, synthesis | Default |
| T2 | Full model | Deep synthesis (Phase 3) | Desktop |
| T3 | No LLM | Graceful fallback | Always |

Configure T1 via `llm.t1` in options. The system degrades gracefully if unavailable.

---

## 8 Nemilia Agent Archetypes

| Agent | Role | Temperature |
|-------|------|-------------|
| SCOUT | Research & Discovery | 0.25 |
| LENS | Analysis & Insights | 0.35 |
| QUILL | Content & Communication | 0.65 |
| FORGE | Critical Review & QA | 0.30 |
| WEAVE | Synthesis & Summary | 0.65 |
| NEXUS | Web Search & Live Data | 0.20 |
| VISION | Visual & Chart Generation | 0.40 |
| TOOLS | MCP Tool Execution | 0.10 |

```typescript
import { WorkflowExecutor, type WorkflowDefinition } from '@page-agent/memory/agents'

const executor = new WorkflowExecutor({ memory, vault, llm })

const workflow: WorkflowDefinition = {
  id: 'research',
  name: 'Research Workflow',
  agentIds: ['SCOUT', 'LENS', 'WEAVE'],
  prompt: 'Analyze the architecture decisions for {{project}}',
  dag: true,
  dagStages: { SCOUT: 1, LENS: 2, WEAVE: 3 },
  feedbackLoops: {},
  conditions: {},
  hitlOverrides: {},
  validate: true,
  memory: true,
  orchestrator: { planTemp: 0.2, synthTemp: 0.5, valThreshold: 6 },
}

const result = await executor.execute(workflow)
console.log(result.finalOutput)
```

---

## Implementation Phases

- ✅ **Phase 1** — Foundational Cognition (this package)
  - Interfaces, episodic memory, web adapters, T0/T1 pipeline, working memory, vault client, agents, job queue
- 🔲 **Phase 2** — Synthesis Engine (SHA-256 incremental, provenance, DAG workflows)
- 🔲 **Phase 3** — Desktop runtime (PGLite, pgvector, Neo4j, Minions queue)
- 🔲 **Phase 4** — Hierarchical Cognition (7 forgetting policies, adaptive retrieval)
- 🔲 **Phase 5** — Autonomous Cognition

---

## Key Design Principles

1. **Mobile is a full cognitive node** — never a thin client
2. **Vault is the only sync point** — raw episodic memory stays local
3. **Writes never block** — enrichment is always async
4. **Graceful degradation** — T2 → T1 → T0 → T3 based on available compute
5. **Human-readable synthesis** — markdown artifacts with YAML frontmatter + citations
