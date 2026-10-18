The Chrome extension uses **WXT** (a modern Chrome extension build tool), which generates the `manifest.json` during the build process. You cannot load the `public` folder directly - you need to build the extension first.

## How to compile and load:

First @page-agent/core and other internal packages have to be built since @page-agent/core points to ./dist/esm/ which doesn't exist yet - the internal packages need to be built first. The extension depends on these packages which are part of the monorepo and need to be compiled first. Let me check the core package configuration:
`npm run build:libs`

### Option 1: Build and load manually

**Production** - npm run build:prod builds to .output/prod/chrome-mv3
**What it does**: build:prod → wxt build --mode production (loads .env.production, sets prod flags like DEMO_BASE_URL)
If you want a **distributable zip**, follow it with npm run mac-zip:prod / win-zip:prod (also --mode production) rather than the plain zip script, so the packaged output matches the production build.

```production version
Increase version number in package.json - "version": "0.0.1",Social Filter
cd d:/Github/page-agent-rp/packages/extension && npm run build:prod
npx wxt zip --mode production

OR

Increase version number in package.json - "version": "0.0.1",
npm run build:prod
npx wxt zip --mode production
```

```bash
npm run build -w packages/core
npm run build -w packages/llms
npm run build -w packages/page-controller

The packages are set up for TypeScript project references (composite: true, outDir: dist) but you've been running Vite builds, which output to dist/esm/ — not the dist/src/ path that tsc --build produces. TypeScript's project reference system only recognises its own output, not Vite's.

The command you need is:
npx tsc --build packages/extension/tsconfig.json
This invokes the TypeScript composite build, which builds all four referenced packages (core, llms, page-controller, ui) in dependency order and places .d.ts files at the paths TypeScript expects (dist/src/...). The npm run build commands you ran earlier only produced the Vite bundle, which is a different thing.

Wait, but the ui is Vue, but the extension is React, and jsx is set to react-jsx. The tsconfig extends ./.wxt/tsconfig.json, which is likely from WXT (Web Extension Toolkit), and it's set to jsx: "react-jsx", but the components are Vue components using TSX syntax.
Now, update ui's tsconfig to jsx: "preserve" and include .tsx.

Each project reference is built with its own tsconfig, so jsx: react-jsx won't bleed into the ui build. But Vue SFCs can't be type-checked by plain tsc — you'd need vue-tsc. Let me check if ui has any .vue files and what the extension actually imports from it.

Important - There are no .vue files anywhere in ui — it's all .tsx. The Vue dependency is there but the actual source is React JSX, so tsc --build can handle it. The extension also doesn't import from @page-agent/ui at all (the grep returned nothing), so even if that reference fails it won't affect the extension's type-checking.

The tsc --build command is still the right call. It builds each referenced package using its own tsconfig (which all have noEmit: false to emit .d.ts files), placing outputs at the dist/src/... paths TypeScript expects. That's distinct from the Vite builds you ran, which output bundles to dist/esm/ and dist/lib/.

npx tsc --build packages/extension/tsconfig.json
If ui causes a problem (it shouldn't, but just in case), the fallback is to build only the three packages the extension actually uses:
npx tsc --build packages/core/tsconfig.json
npx tsc --build packages/llms/tsconfig.json
npx tsc --build packages/page-controller/tsconfig.json

cd packages/extension
npm run build:ext
```

This generates the built extension in the `.wxt/chrome-mv3` folder. Then in Chrome:

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `packages/extension/.wxt/chrome-mv3` folder

If you're loading the development build, it requires the dev server to be running. Otherwise you need to build the production version instead.

### Option 2: Use dev mode (recommended for development)

```bash
cd packages/extension
npm run dev
```

This starts a development server with hot-reloading and automatically opens Chrome with the extension loaded.

### Why it failed:

The `public` folder only contains static assets (`assets/` and `_locales/`). WXT combines these with your source code from `src/` and generates the final `manifest.json` in the `.wxt/chrome-mv3` output directory.

**To use local LLM, point to the dev extension** : D:\Github\page-agent-rp\packages\extension\.output\chrome-mv3-dev
The extension is configured to use:

**Model:** `qwen/qwen3.5-9b`
**Configuration is set in `packages/extension/.env`:**

```env
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=NA
LLM_MODEL_NAME=qwen/qwen3.5-9b
```

This is configured for a local LLM server running on port 1234 (typical for LM Studio, Ollama, or local OpenAI-compatible API endpoints). The extension will send all requests to your local LLM endpoint at `http://localhost:1234/v1`.

You can change these values to use any OpenAI-compatible API provider by updating the `.env` file with your desired base URL, API key, and model name.

**What is https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run** defined in the settings UI
This URL is the **official demo LLM API endpoint** for Page Agent.

✅ **Service:** This is Alibaba Cloud Function Compute (FC) hosted endpoint running in Shanghai region.

✅ **Purpose:**

- This is the **public free testing API** used by all Page Agent demos
- It provides proxy access to Qwen LLM models (qwen3.5-plus)
- It is what powers the demo CDN script and the extension demo mode
- Rate limited and intended for technical evaluation only
- No API key required (you use `NA` as the key)

✅ **Where it is used:**

- ✅ `packages/page-agent/src/demo.ts` - the demo CDN build
- ✅ `packages/website/` - documentation and landing page demo
- ✅ `packages/extension/` - browser extension demo mode

This endpoint is used **automatically** when you don't configure your own custom LLM endpoint. It is for evaluation purposes only and should not be used in production.

## VSCode Exclude search folders

.output,public/assets/js,public/assets/css,public/assets/img,public/assets/fonts,public/assets/webfonts,public/assets/locales

## Appendix

If you see the multiple entrypoints issue, run
git rm -f packages/extension/src/**/*.js

Remove-Item -Force "d:\Github\page-agent-rp\packages\extension\src\entrypoints\background.js", "d:\Github\page-agent-rp\packages\extension\src\entrypoints\content-gmail.js", "d:\Github\page-agent-rp\packages\extension\src\entrypoints\content-outlook.js", "d:\Github\page-agent-rp\packages\extension\src\entrypoints\content.js", "d:\Github\page-agent-rp\packages\extension\src\entrypoints\main-world.js" -ErrorAction SilentlyContinue; Write-Output "done"

Outputs:
rm 'packages/extension/src/entrypoints/content-access-settings/main.js'
...

## Spacing recommendation

A few settings work together:

editor.detectIndentation: false is the key one. When true (the default), VS Code auto-detects the indentation style per file and can flip between tabs/spaces depending on what it guesses. Setting it to false forces it to always use your configured editor.insertSpaces and editor.tabSize values, so pasted code gets re-indented consistently.

editor.insertSpaces: false — tells VS Code to insert a real tab character when you press Tab.

Put both in your workspace .vscode/settings.json:

{
"editor.insertSpaces": false,
"editor.detectIndentation": false
}
Also useful:

editor.renderWhitespace: "all" (or "boundary") — makes tabs vs spaces visually distinguishable so you spot the mismatch immediately.
ESLint no-mixed-spaces-and-tabs rule — flags mixed indentation at lint time, so CI catches it even if the editor doesn't.
If you have an .editorconfig file at the repo root, VS Code (with the EditorConfig extension) will enforce indent_style = tab per-file automatically, which also overrides the per-file detection.
The root cause in background.ts was likely a paste from somewhere that used spaces — detectIndentation: false + insertSpaces: false prevents that by normalizing to tabs on input.

Appendix -
Here's the actual sequence of what happened:

You rebuilt the extension with npm run build:dev ✓
BUT at that point packages/llms/dist/lib/page-agent-llms.js still had the old code — I hadn't run the correct Vite build for llms yet
I then ran npm run build in packages/llms — that just completed in my last message
Vite resolves @page-agent/llms via npm workspace symlink → packages/llms/package.json main field → dist/lib/page-agent-llms.js. The TypeScript path alias in tsconfig is only for the type checker, not for Vite's bundler.

So the dist/lib/ is now correct. You need to run npm run build:dev in the extension one more time now that packages/llms is actually updated.
