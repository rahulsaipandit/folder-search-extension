# Folder Search (browser extension)

Search your own files by describing them. You pick a folder; the extension indexes it **on your
device** with EmbeddingGemma 2 and answers natural-language queries, showing Media and Documents as
separate sections. Nothing is uploaded; the only network traffic is the one-time, user-approved
model download. See [docs/designLocalFolderSearch.md](docs/designLocalFolderSearch.md).

Built with [WXT](https://wxt.dev) and React. WXT generates `manifest.json` at build time, so the
`public/` folder cannot be loaded directly.

## Build and load

From the repository root:

```bash
npm install
npm run dev -w @page-agent/ext        # dev build with reload (wxt)
npm run build:dev -w @page-agent/ext  # → packages/extension/.output/dev/chrome-mv3-dev
npm run build:prod -w @page-agent/ext # → packages/extension/.output/prod/chrome-mv3
npm run zip -w @page-agent/ext        # distributable zip (use --mode production via build:prod first)
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the
`chrome-mv3*` output folder. Click the toolbar icon to open the side panel.

Requirements: a Chromium browser with the File System Access API, and WebGPU for the default (fast)
models. Without WebGPU the extension asks before downloading a larger fp16 CPU fallback.

## Test

```bash
npm test -w @page-agent/ext                 # unit tests (Vitest)
npm run test:build -w @page-agent/e2e       # Playwright E2E against a fake-embedder build
```

`docs/manualTestFolderSearch.md` lists what automated tests cannot cover (real model, WebGPU,
PDF rendering, the folder picker).

## Layout

See `AGENTS.md` > "Extension Architecture" for the source map and the rules the code follows
(permissions, offscreen-only ML, private-only Ask mode).
