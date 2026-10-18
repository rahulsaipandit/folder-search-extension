# Instructions for Coding Assistants

## Project Overview

This is a **monorepo** with npm workspaces:

- **Page Agent** (`packages/page-agent/`) - Main entry with built-in UI Panel, published as `page-agent` on npm
- **Extension** (`packages/extension/`) - Browser extension (WXT + React)
- **Website** (`packages/website/`) - React docs and landing page. **When working on website, follow `packages/website/AGENTS.md`**

Internal packages:

- **Core** (`packages/core/`) - PageAgentCore without UI (npm: `@page-agent/core`)
- **LLMs** (`packages/llms/`) - LLM client with reflection-before-action mental model
- **Page Controller** (`packages/page-controller/`) - DOM operations and visual feedback (SimulatorMask), independent of LLM
- **UI** (`packages/ui/`) - Panel and i18n. Decoupled from PageAgent
- **Memory** (`packages/memory/`) - Hybrid Cognitive Memory Platform (npm: `@page-agent/memory`). Local-first episodic memory, T0/T1 synthesis pipeline, knowledge graph, MCP vault integration, Nemilia agent archetypes. Architecture defined in `packages/extension/docs/designCognitiveBrain.md`. Zero cross-dependency with `packages/core/`.

## Development Commands

```bash
npm start                      # Start website dev server
npm run build                  # Build all packages
npm run build:libs             # Build all libraries
npm run build:ext              # Build and zip the extension package
npm run typecheck              # Typecheck all packages
npm run test                   # Run unit tests across all workspaces
npm run lint                   # ESLint
```

## Architecture

### Monorepo Structure

Source-first monorepo: library `package.json` exports point to `src/*.ts` during development. At publish time, `scripts/pre-publish.js` promotes `publishConfig` fields to top-level (swapping to `dist/`), and `scripts/post-publish.js` restores the originals.

```
packages/
├── core/                    # npm: "@page-agent/core" ⭐ Core agent logic (headless)
├── page-agent/              # npm: "page-agent" entry class (with UI + controller + demo builds)
├── website/                 # @page-agent/website (private)
├── llms/                    # @page-agent/llms
├── extension/               # Browser extension
├── page-controller/         # @page-agent/page-controller
└── ui/                      # @page-agent/ui
```

`workspaces` in `package.json` must be in topological order.

### Module Boundaries

- **Page Agent**: Main entry with UI. Extends PageAgentCore and adds Panel. Imports from `@page-agent/core`, `@page-agent/ui`
- **Core**: PageAgentCore without UI. Imports from `@page-agent/llms`, `@page-agent/page-controller`
- **LLMs**: LLM client with MacroToolInput contract. No dependency on page-agent
- **UI**: Panel and i18n. Decoupled from PageAgent via PanelAgentAdapter interface
- **Page Controller**: DOM operations with optional visual feedback (SimulatorMask). No LLM dependency. Enable mask via `enableMask: true` config

### PageController ↔ PageAgent Communication

All communication is async and isolated:

```typescript
// PageAgent delegates DOM operations to PageController
await this.pageController.updateTree()
await this.pageController.clickElement(index)
await this.pageController.inputText(index, text)
await this.pageController.scroll({ down: true, numPages: 1 })

// PageController exposes state via async methods
const simplifiedHTML = await this.pageController.getSimplifiedHTML()
const pageInfo = await this.pageController.getPageInfo()
```

### DOM Pipeline

1. **DOM Extraction**: Live DOM → `FlatDomTree` via `page-controller/src/dom/dom_tree/`
2. **Dehydration**: DOM tree → simplified text for LLM
3. **LLM Processing**: AI returns action plans (page-agent)
4. **Indexed Operations**: PageAgent calls PageController by element index

## Key Files Reference

### Page Agent (`packages/page-agent/`)

| File               | Description                                  |
| ------------------ | -------------------------------------------- |
| `src/PageAgent.ts` | ⭐ Main class with UI, extends PageAgentCore |
| `src/demo.ts`      | IIFE demo entry (auto-init with demo API)    |

### Core (`packages/core/`)

| File                   | Description                             |
| ---------------------- | --------------------------------------- |
| `src/PageAgentCore.ts` | ⭐ Core agent class without UI          |
| `src/tools/`           | Tool definitions calling PageController |
| `src/config/`          | Configuration types and constants       |
| `src/prompts/`         | System prompt templates                 |

### LLMs (`packages/llms/`)

| File                      | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/index.ts`            | ⭐ LLM class with retry logic                                              |
| `src/types.ts`            | MacroToolInput, AgentBrain, LLMConfig                                      |
| `src/OpenAIClient.ts`     | OpenAI-compatible client — used for `openai`/`anthropic`/`local` providers |
| `src/BrowserLLMClient.ts` | WebLLM-backed client for the `browser` provider — see below                |

#### LLM provider dispatch (`browser` / WebLLM)

`LLMConfig.provider` is one of `'openai' | 'anthropic' | 'local' | 'browser'`. The `LLM` constructor (`src/index.ts`) picks the client based on it:

- `openai` / `anthropic` / `local` → `OpenAIClient` (all three speak the OpenAI-compatible REST shape; local just points `baseURL` at a local server).
- `browser` → `BrowserLLMClient`, which loads the model in-page via `@mlc-ai/web-llm`'s `CreateMLCEngine` (main thread, WebGPU/WASM). **No network request is made or expected for this provider** — `baseURL: 'browser://'` is a sentinel value only, never a real URL. Do not add code that calls `fetch()`/`this.config.baseURL` for the browser provider.
- Engines are cached and refcounted by model id in `BrowserLLMClient` (module-level `engineCache`) — loading a model is a multi-hundred-MB download/compile, and callers like `useScopedLLM` (`packages/extension/src/llm/useScopedLLM.ts`) create/dispose an `LLM` instance on every provider/model change. `dispose()` unloads the engine once the last referencing instance disposes, not on every call.
- `@mlc-ai/web-llm` is an **optional peer dependency** of `@page-agent/llms`, dynamically imported only when `provider === 'browser'` is actually used — consumers that never select it don't need it installed.

### Page Controller (`packages/page-controller/`)

| File                        | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `src/PageController.ts`     | ⭐ Main controller class with optional mask support        |
| `src/SimulatorMask.ts`      | Visual overlay blocking user interaction during automation |
| `src/actions.ts`            | Element interactions (click, input, scroll)                |
| `src/dom/dom_tree/index.js` | Core DOM extraction engine                                 |

## Extension Architecture (`packages/extension/`)

The extension is built with WXT + React. Entry point: `src/entrypoints/sidepanel/App.tsx`.

### Two independent LLM provider settings — `apiProvider` vs. `textLLMProvider`

`UnifiedSettings` (`src/shared/settings.ts`) carries **two separate provider selections** that
must not be conflated:

- `apiProvider` — the **navigation agent's** provider (multimodal: interprets page structure,
  drives clicks/inputs). Set from the main Settings page.
- `textLLMProvider` (+ `textLLMModel`/`textLLMEndpoint`) — an optional override for **text-only**
  features that don't need multimodal/navigation capability: Executive Review Prep and any future
  text-only skill. Set from the shared
  `entrypoints/ai-provider-settings/main.tsx` page. When unset (`'use-global'`), these features
  inherit `apiProvider`.

Never resolve a text-only feature's LLM config from raw `settings.apiProvider` /
`createLLMConfigFromProvider(settings)` directly — that ignores the override and reintroduces the
bug where a provider configured for one text feature silently doesn't apply to another, even though
both are "just text" features. Always go
through `getTextLLMConfig(settings)` (`llm/providers/adapter.ts`) — directly, or via the
`useScopedLLM` hook, which already wraps it and returns `LLM | null` (`null` = blocked, same
demo-provider gate as the navigation agent). See `getTextLLMConfig`'s doc comment for the full
decision table.

### Extension Source Map

```
src/
├── agent/                          # Browser automation engine
│   ├── MultiPageAgent.ts           # Main agent class (extends PageAgentCore), multi-tab support
│   ├── useAgent.ts                 # React hook — wires agent to UI (status, history, execute, stop)
│   ├── RemotePageController.ts     # Orchestrates page interaction across content/background scripts
│   ├── TabsController.ts           # Tab selection and switching
│   ├── tabTools.ts                 # LLM tool definitions for tab actions
│   └── constants.ts                # DEMO_BASE_URL, endpoint helpers
│
├── entrypoints/sidepanel/          # Main side panel UI
│   ├── App.tsx                     # ⭐ Root component — view router + chat view
│   ├── types.ts                    # View union type (chat | history | library | …)
│   └── components/
│       ├── AgentLibrary.tsx        # Skills grid (SPECIAL_SKILL_ROUTES table)
│       ├── ActiveInstancesList.tsx # Live widget instance list with stop/delete controls
│       ├── AgentDashboard.tsx      # Full-screen widget dashboard
│       ├── HistoryAndFavorites.tsx # Session history + pinned prompts
│       ├── HistoryDetail.tsx       # Single session detail with continue/retry
│       ├── MemoryBrowser.tsx       # Browse/search cognitive memory entries
│       ├── ExecutiveReviewPrep.tsx # Executive review analysis UI
│       ├── AuspiciousTimes.tsx     # Muhurta slots widget
│       ├── misc.tsx                # Logo, StatusDot, ActionPanel, EmptyState, MotionOverlay
│       ├── RobotFace.tsx           # Animated avatar (AvatarState: off|passive|active-idle|…)
│       └── AttachButton.tsx        # File attachment for chat input
│
├── entrypoints/                    # 20+ additional feature entry points (each has its own HTML)
│   ├── hub/                        # Task management hub
│   ├── calendar-assistant/         # Google Calendar auto-color-coding
│   ├── executive-assistant/        # Full-screen org editor
│   ├── financial-monitor/          # Stock/market watchlist
│   ├── news-digest/                # AI news summary
│   ├── dinner/                     # Recipe planner
│   ├── svg-viewer/, color-selector/, url-tools/,
│   │   epoch-converter/, markdown-viewer/   # Standalone dev tools
│   └── mic-permission/             # Permission grant page
│
├── lib/                            # Shared utilities
│   ├── widgetRuntime.ts            # Widget framework: defineWidget, createWidgetInstance, registerWidget
│   ├── scheduledWidgets.ts         # GenericTaskWidget + ActionOptimizationWidget definitions
│   ├── db.ts                       # Session persistence (IndexedDB via Dexie)
│   ├── eventBus.ts                 # Cross-context message bus
│   └── (web automation, storage, form-fill, metrics utils)
│
├── llm/                            # LLM provider integration
│   ├── providers/adapter.ts        # Unified adapter: OpenAI | Anthropic | local | browser LLM.
│   │                                 # Also getTextLLMConfig() — resolves the textLLMProvider override (see below)
│   ├── useScopedLLM.ts             # React hook: LLM|null scoped to a component's lifecycle, resolved via
│   │                                 # getTextLLMConfig (honors the textLLMProvider override, not just apiProvider)
│   └── voice-chat/integration.ts   # VoiceChatIntegration (STT → agent → TTS)
│
├── memory/                         # Extension-side memory bridge
│   ├── orchestrator.ts             # Coordinates recall, consolidation, and inference
│   └── inferenceAdapter.ts         # Queries @page-agent/memory from extension context
│
├── actions/impl/                    # 15 built-in agent actions (pageSummarizer, calculator, …)
├── browser-ml/                     # On-device ML: embeddings, vector search, UMAP, HDBSCAN,
│   │                                 # AND a separate off-main-thread WebLLM engine for RAG
└── accessListControl/              # Policy engine for site allow/block rules
```

### Adding a New Skill to Agent Library

1. Add entry to `SPECIAL_SKILL_ROUTES` in [AgentLibrary.tsx](packages/extension/src/entrypoints/sidepanel/components/AgentLibrary.tsx) with `panelView` or `tabUrl`
2. Add skill object to the `skills` array in the same file
3. If it opens a panel view, add the view name to the `View` union in [types.ts](packages/extension/src/entrypoints/sidepanel/types.ts) and handle it in [App.tsx](packages/extension/src/entrypoints/sidepanel/App.tsx)
4. If it opens a new tab, add the HTML entry point in `src/entrypoints/`

### Tab Access Policy Engine (`packages/extension/src/accessListControl/`)

Fail-closed policy gate deciding whether the agent may act on a given tab/host. Files:

| File               | Role                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy-engine.ts` | `PolicyEngine.evaluate()` — orchestrates the decision pipeline                                                                                                        |
| `policy-loader.ts` | `DEFAULT_DENYLIST` / `DEFAULT_ALLOWLIST` patterns + `mergePolicyConfig()`                                                                                             |
| `rules-engine.ts`  | `RulesEngine` — static allowlist/denylist pattern matching                                                                                                            |
| `matcher.ts`       | Hostname normalization + wildcard (`*.example.com`) matching                                                                                                          |
| `plugins.ts`       | Heuristic plugins: `PasswordFieldPlugin`, `SensitiveFieldPlugin`, `KeywordPlugin` (scan live DOM/text for password fields, sensitive input names, sensitive keywords) |
| `types.ts`         | `PolicyConfig`, `PolicyContext`, `Decision`, `PolicyPlugin`, etc.                                                                                                     |

**Evaluation order** (`PolicyEngine.evaluate`): 1) denylist → BLOCK, 2) allowlist match → **skips plugin heuristics entirely** and returns ALLOW (a deliberate carve-out — e.g. `*.archive.ph`/`*.archive.today` are allowlisted because archived finance/news pages incidentally contain terms like "credit card"), 3) otherwise run plugins — any plugin BLOCK wins, 4) optional user-gesture gate, 5) ALLOW.

Since allowlisting bypasses plugins, only add a host to `DEFAULT_ALLOWLIST` when the _page itself_ is trusted, not just the domain reputation.

`KeywordPlugin` requires **2+ distinct sensitive terms** in the text sample before blocking (single incidental mentions like one "tax return" reference are not enough) — see `SENSITIVE_TERM_PATTERNS` in `plugins.ts`.

### Folder Search (`src/folder-search/`) — local, read-only visual RAG

Design: `packages/extension/docs/designLocalFolderSearch.md`. User picks a folder via the File System Access API (`mode: 'read'` only), it is indexed on-device with EmbeddingGemma 2 (text/vision/audio in one 768-d space, Matryoshka-truncated to `settings.dim`), and queried through one box. Nothing is uploaded; the only network traffic is the user-approved model download.

- **Split by context.** UI/pickers/permission/IndexedDB reads live in the side panel (`entrypoints/sidepanel/components/FolderSearch/`, plus `entrypoints/folder-search/` tab and `folder-search-settings/` Manage page). Everything heavy (embedder, extractors, indexer, vector matrices) runs in the **offscreen document** via `folder-search/engine.ts` (`offscreen:folder:*` messages) and is called from the UI only through `folder-search/bridge.ts`. Never import `browser-ml/gemma-embeddings.ts`, `indexer.ts`, `searchIndex.ts`, `modelManager.ts` or `extractors/{pdf,media,text}.ts` from UI code (CSP + bundle weight). `modelCatalog.ts`, `events.ts`, `types.ts`, `settings.ts`, `db.ts` and the pure helpers are safe for the UI.
- **Handles are never sent through `chrome.runtime`.** The `FileSystemDirectoryHandle` is stored in IndexedDB (`folderSearch` DB, `idb`); the offscreen doc reads it from there. Progress goes the other way as `folder:event` broadcasts (`events.ts`).
- **Pure, tested logic:** `classify.ts` (skip rules, secrets), `chunker.ts`, `diff.ts` (incremental rescan), `keywords.ts` (BM25-style + exact-string detection), `ranking.ts` (vector matrix, per-modality z-score calibration, RRF fusion, grouping), `merge.ts`, `walker.ts`, `ask.ts`, `extractors/pure.ts`. Keep new ranking/skip behaviour in these files with tests.
- **Index validity.** `meta` stores an `IndexSignature` (model id, dtype, dim, schema). A mismatch makes `Indexer.run` throw `REINDEX_REQUIRED`; the UI offers an explicit re-index. Toggling the vision/audio encoders alone does not invalidate vectors.
- **ID conventions** (`db.ts`): chunk ids `${fileId}#${idx}`, page images `${fileId}#p${page}`, filename postings `${fileId}#name`, audio/video units `${fileId}@${startSec}`. File ids may contain `#`/`@`; always split with `lastIndexOf` (see `chunkFileOf`/`unitFileOf` in `searchIndex.ts`).
- **Ask mode** is optional and must resolve its LLM via `useScopedLLM` (text-only feature, honors `textLLMProvider`). Retrieval must keep working with no LLM configured.
- `calibrate` priors in `ranking.ts` (`PRIOR_STATS`, `MIN_CALIBRATED`) are unmeasured starting points; tune them on a labeled sample before trusting thresholds.

### Adding a Widget

Create a widget via `defineWidget()` in `src/lib/widgetRuntime.ts`, then call `registerWidget()` in App.tsx's `useEffect`.

### On-device ML (`packages/extension/src/browser-ml/`) — must run in the offscreen document

`browser-ml/embeddings.ts` (`BrowserEmbeddings`, `@huggingface/transformers`) and the vector-search/clustering modules load a Worker + WASM/WebGPU runtime. **Never call `embeddings.initialize()`/`.embed()` (or the vector-search/clustering classes) directly from the side panel, a content script, or any other extension page.** The manifest's `content_security_policy.extension_pages` (`wxt.config.js`) blocks `worker-src`/`script-src` for anything not served same-origin from the packed extension, and side panel / content-script contexts hit this immediately.

The fix already exists — route through the Chrome offscreen document instead:

| File                             | Role                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-ml/offscreen-bridge.ts` | Caller-side API: `offscreenEmbed()`, `offscreenVectorSearch()`, `offscreenBuildVectorIndex()`, `offscreenClusterUMAP()`, `offscreenClusterHDBSCAN()`. Lazily creates the offscreen document (`chrome.offscreen.createDocument`) and message-passes into it. **Call these, not the underlying classes, from side panel / content-script code.** |
| `entrypoints/offscreen/main.ts`  | Where `embeddings`, `BrowserVectorSearch`, `BrowserClustering` actually run. `onMessage` listener dispatches `offscreen:embed`, `offscreen:vector:*`, and `offscreen:cluster:*`.                                                                                                                                                            |

If you need cosine similarity or other pure-math helpers on embedding vectors outside the offscreen doc, write a small local function (`offscreenEmbed` already returns plain `number[][]`) rather than importing `embeddings.ts` just for a static method — that import alone pulls the WASM/worker pipeline into whatever bundle you're in.

## Adding New Features

### New Agent Tool

1. Implement in `packages/core/src/tools/index.ts`
2. If tool needs DOM ops, add method to PageController first
3. Tool calls `this.pageController.methodName()` for DOM interactions

### New PageController Action

1. Add implementation in `packages/page-controller/src/actions.ts`
2. Expose via async method in `PageController.ts`
3. Export from `packages/page-controller/src/index.ts`

## Testing

- **Test value**: Do not add redundant tests or directly translate implementation code into assertions. Test meaningful behavior and realistic failure modes.
- **Framework**: Vitest for unit tests; Playwright E2E in `packages/e2e/` (loads the built extension from `packages/extension/.output/dev/chrome-mv3-dev`; run `npm run test:build -w @page-agent/e2e` to rebuild and test)
- **Location**: co-located, `src/foo.test.ts` next to `src/foo.ts`
- **Coverage today**: `packages/llms` only — other packages will follow incrementally
- **Adding tests to a new package**: create `vitest.config.ts` in the package and add a `"test": "vitest run"` script. Root `npm test` and `node scripts/ci.js` pick it up through npm workspaces.
- **Live tests** (hit real external APIs, slow/costly): name them `*.live.test.ts`, exclude them from the package's `test` script, and expose them via a `test:live` script. Root `npm run test:live` runs all of them; they never run in `npm test` or CI. Template: `packages/llms`.
- **Template**: See @page-agent/llms

```bash
npm test                            # all packages with a test script
npm test -w @page-agent/llms        # single package
cd packages/llms && npx vitest      # watch mode in one package
```

## Code Standards

- Explicit typing for exported/public APIs
- ESLint relaxes some unsafe rules for rapid iteration
- Every change you make should not only implement the desired functionality but also improve the quality of the codebase
- All code and comments must be in English.
- Do not try to hide errors or risks. They are valuable feedbacks for developers and users. Make them visible and actionable.
- Traceability and predictability is more important than success rate.
