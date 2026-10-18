# Vendored UMAP WASM

`index.js` and `umap_wasm_core.js` are copied unmodified (only the chunk import path changed) from the
published `embedding-atlas@0.24.0` npm package (`dist/umap.js`, `dist/chunk-BpolmZoN.js`), which
bundles Apple's `@embedding-atlas/umap-wasm`. License: MIT, https://github.com/apple/embedding-atlas.
The WASM binary is inlined as a data URI. Types live in `index.d.ts`.

To update: `npm pack embedding-atlas`, then repeat the copy above. These files are un-ignored in
`packages/extension/.gitignore` because the blanket `src/**/*.js` rule would otherwise drop them.
