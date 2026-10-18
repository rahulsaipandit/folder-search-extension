# Folder Search: manual test with the real model

The Playwright suite (`packages/e2e`) uses a fake embedder, so it never exercises EmbeddingGemma,
ONNX Runtime, WebGPU/WASM in the offscreen document, or image/audio/PDF extraction. This checklist
covers that gap. Run it before trusting retrieval quality or the `calibrate` priors in `ranking.ts`.

## Setup

1. Build the real (non-fake) extension: `npm run build:dev -w @page-agent/ext`
   (output: `packages/extension/.output/dev/chrome-mv3-dev`).
2. `chrome://extensions` → Developer mode → **Load unpacked** → that folder. Reload it after every rebuild.
3. Prepare a small test folder (about 30 files, under 200 MB so a run takes minutes):
   - 5 text/Markdown files with distinct topics, 2 of them sharing a rare exact string (e.g. `INV-4471`)
   - 2 PDFs: one text PDF, one scanned/image-only PDF
   - 8 photos: a few clearly describable (beach, dog, receipt, whiteboard)
   - 1 short audio file (about 1 min, speech) and 1 short video (about 1 min)
   - 1 file that should be skipped (`.env` containing `API_KEY=...`) and 1 over-size file
4. Open DevTools on the **offscreen document**: `chrome://extensions` → the extension → *Inspect views* →
   `offscreen.html`. Keep Console and Network visible for the whole run. Also open DevTools on the side panel.
5. Click the toolbar icon. The side panel should open on **Folder Search** (it is the default view).

## Checklist

Record the result and any console error next to each item.

### First run and model download
- [ ] Welcome screen shows; **Get started** leads to "Step 1 of 3 · Download search model".
- [ ] Nothing is requested from huggingface.co before you click **Download & continue** (Network tab).
- [ ] Download progress bars move for Documents and Images; download completes without errors.
- [ ] After completion, Cache Storage → `transformers-cache` holds `onnx-community/embeddinggemma-2-ONNX` files.
- [ ] Offscreen console shows which device loaded (WebGPU or wasm). Note it, plus the "device" line on the Manage page.
- [ ] Cancel mid-download, then retry: it resumes or restarts cleanly, with no stuck "downloading" screen.

### Folder and indexing
- [ ] **Choose folder…** opens the OS picker; after choosing, the pre-scan summary counts match your folder.
- [ ] The `.env` file and the over-size file are listed as skipped, with reasons.
- [ ] **Start indexing** shows live progress; the panel stays responsive; no errors in either console.
- [ ] Pause and resume work. Cancel leaves a usable partial index.
- [ ] Record: files per minute, peak memory (Chrome Task Manager, `Shift+Esc`), whether WebGPU stayed stable.
- [ ] Indexing finishes with the expected counts; per-file errors (if any) are listed and retryable.

### Search quality (record top-3 for each; mark right/wrong)
- [ ] Exact string `INV-4471` returns both files that contain it at the top.
- [ ] A natural-language text query ("quarterly budget meeting notes") finds the right document.
- [ ] A photo query ("dog on a beach") returns the right image(s) in the Images section with thumbnails.
- [ ] A query matching text inside the **scanned PDF** finds it (page-image embedding path).
- [ ] A query for spoken content in the audio file returns a result with a timestamp.
- [ ] A nonsense query ("zxqv plorf") returns few or no results rather than a full page of weak matches
      (this is what the calibration thresholds are for; note what appears).
- [ ] Filters (Images / Documents / Audio & video) narrow results correctly.
- [ ] **Find similar** on an image returns visually related images.
- [ ] Opening a result: PDF opens at the right page, media at the right time, other types download a copy.

### Incremental updates and index validity
- [ ] Add a file, edit a file, delete a file in the folder, then reopen the panel: the quiet rescan picks up all three.
- [ ] Change the quality (q4 → q8) on the Manage page: the UI demands an explicit **Re-index**; old results are not
      served silently.
- [ ] Toggling vision/audio alone does not force a re-index.
- [ ] Restart Chrome: the folder shows the reconnect card; **Reconnect** restores access without re-indexing.
- [ ] Rename or move the folder: the "missing" state appears with a clear action.

### Privacy and safety
- [ ] During search and indexing, Network shows no request containing file names or contents. The only traffic is the
      model download.
- [ ] The permission prompt is read-only (never "edit files").
- [ ] Remove the folder on the Manage page: its index data is gone (IndexedDB `folderSearch` DB), and the model cache
      is only removed by the explicit model-remove action.

### Ask mode (only if an LLM is configured)
- [ ] With no text LLM configured, search still works and Ask is clearly unavailable.
- [ ] With one configured under *AI provider settings*, answers cite files and respect the `textLLMProvider` override.

## What to report back

- Device used (WebGPU or wasm), GPU/RAM, indexing speed, peak memory.
- Which search items above returned wrong results, with the query and what came back. That sample is what should
  tune `PRIOR_STATS` and `MIN_CALIBRATED` in `src/folder-search/ranking.ts`.
- Answers to the open questions in `designLocalFolderSearch.md` §13: q4 vs q8 quality, WebGPU in an offscreen
  document, Matryoshka size (256 vs 768), and whether `unlimitedStorage` is needed (watch for quota errors on a
  larger folder).
- Any console error from either DevTools window, verbatim.
