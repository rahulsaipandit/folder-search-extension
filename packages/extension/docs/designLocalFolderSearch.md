# Local Folder Search (Visual RAG over a User-Selected Folder)

Status: **Implemented (all three phases), not yet validated in a real browser.** Date: 2026-10-18.

Implementation notes (deviations from the proposal below):

- Storage uses `idb` (already a dependency, like `lib/db.ts`), not Dexie. The `files`/`chunks`/`imageVectors`/`keywords`/`meta` stores follow §3.4; added `mediaUnits` for audio/video and `byHash` for duplicates.
- Vector search is brute force over contiguous `Float32Array`s (`ranking.ts` `VectorMatrix`); no benchmark has been run, so the 50k-vector ceiling in §3.4 is still an estimate.
- Calibration (§6.2) z-scores each query against the folder's own score distribution, shrunk toward unmeasured priors for tiny indexes. Priors and the 2.5σ display threshold need tuning on labeled data (§13).
- Keyword scoring is BM25 without length normalization (chunk lengths are bounded by the chunker).
- Strings are English literals in the components (the existing i18n catalog only carries the interface-language keys); moving them behind `t()` is outstanding work (§4A.4).
- `unlimitedStorage` (§8, §13.5) is **not** added to the manifest; that is a Web Store posture decision.
- The EmbeddingGemma 2 calls in `browser-ml/gemma-embeddings.ts` follow the ONNX model card but have only been compile- and bundle-checked, never executed.

## 1. Goal

After install, the user picks a folder on their computer. The extension indexes it **fully
on-device** and lets them ask natural-language queries. Results are shown in two visually
separate sections:

- **Media** — images (and later video thumbnails) as a gallery grid.
- **Documents** — PDF, Word, text/markdown/code, spreadsheets, etc. as a ranked list with snippets.

The query decides which section leads (e.g. "photos of the beach trip" → Media; "Q3 budget
contract" → Documents); both are always reachable.

Non-goals (v1): cloud sync, writing/modifying user files, separate OCR engine (page images cover
scans), network-mounted drives. Audio/video search is **feasible** (the model and the reference
space support it) but deferred to phase 2 to keep the first download small.

## 1.1 Prior art: DigUp (github.com/ARahim3/DigUp)

DigUp is an MIT-licensed **desktop** app (Swift/SwiftUI on macOS, Tauri on Windows/Linux) doing
the same job: semantic search over a user-picked folder, using **EmbeddingGemma 2 (8-bit) through
llama.cpp** (Metal / Vulkan / CPU), one shared 768-d space for text, images, audio and video. It
validates the model choice. It is not a browser design, so only the ideas transfer (fetched
2026-10-18). The browser-runtime reference is the Hugging Face space in §3.2, not DigUp:

| DigUp practice | Adopted here as |
| --- | --- |
| Explicit folder selection, read-only, never uploads | Same (§2, §3.1) |
| Skips keys/certs/password files, hidden dirs, caches, cloud-only placeholders | Default skip list (§5, §9) |
| Vectors + **keyword index**; exact strings (invoice numbers, error codes) get a score boost | Hybrid keyword fusion **moved into MVP** (§6) |
| PDFs indexed per page, **scans included** (pages treated as images) | Same idea, using pdf.js page renders + text layer (§5); pdf.js also gives in-app page viewing with highlights |
| First 30 pages of long PDFs indexed immediately, remainder later | Progressive indexing: first N pages first, rest in background (§5) |
| Index records the model version that produced its vectors | `meta` store; mismatch ⇒ re-index prompt (§3.4) |
| Code indexed separately, off by default | Code files excluded from the main index; opt-in separate index (phase 2) |
| Results open at page/moment/line | Result stores page / offset; PDFs open with `#page=N` |
| Embedding in a helper process that exits when done; search side loads on demand | Offscreen doc lifecycle: unload encoders when idle, keep only the text path warm for queries |
| Total model download ~865 MB (all encoders, 8-bit) | We download only what's needed: ~283 MB for docs+images at q4 (§3.2) |

What does **not** transfer: native PDFium/FFmpeg/SQLite and GPU backends (we have pdf.js,
WebCodecs/`<video>`, IndexedDB and WebGPU), global shortcuts, opening files in native apps,
and background file watching (File System Access has no watcher, so we rescan).

## 2. Principles

1. **Local-first / private.** File bytes, text, embeddings never leave the machine. The only
   network traffic is the one-time model download (user-approved).
2. **Explicit consent, in order:** (a) approve model download → (b) pick folder → (c) indexing starts.
   No file is read before step (b).
3. **Read-only.** We never request `readwrite` on the directory handle.
4. **Visible & predictable.** Progress, skipped files and errors are listed, not swallowed
   (per AGENTS.md "Do not try to hide errors").
5. Follow the existing constraints in `docs/designGuidelines.md`: no new standing host
   permissions, no `eval`/remote code.

## 3. Key technical decisions

### 3.1 Folder access: File System Access API (`showDirectoryPicker`)

- Called from an **extension page with a user gesture** (the side panel, or a full-tab page for
  large folders). It cannot be called from the offscreen document or service worker.
- `mode: 'read'`; persist the returned `FileSystemDirectoryHandle` in IndexedDB (handles are
  structured-cloneable). On later sessions call `handle.queryPermission({mode:'read'})`; if it
  returns `prompt`, show a "Reconnect folder" button that calls `requestPermission` from a click.
- Handles are shared across contexts of the same extension origin, so the **offscreen document
  can read the handle from IndexedDB directly** — do not try to send handles through
  `chrome.runtime.sendMessage` (JSON-serialized, will fail).
- No new manifest permission is needed for the API itself.
- Fallback for browsers lacking the API (Firefox/Safari): `<input type=file webkitdirectory>`
  one-shot import, no persistent handle, re-pick to refresh. Out of scope for v1 UI but keep the
  `FolderSource` interface abstract so it can slot in.

### 3.2 Model — one multimodal model (EmbeddingGemma 2)

Per the model card (`unsloth/embeddinggemma-2-GGUF`, fetched 2026-10-18), **EmbeddingGemma 2
is multimodal**: it embeds text (incl. code), images, video and audio into **one shared space**.
(An earlier revision of this doc wrongly assumed EmbeddingGemma was text-only, as v1 was, and
planned a separate CLIP model. That is dropped.)

Card facts relevant to us: 740M params total (270M text backbone + 170M vision encoder +
300M audio encoder, **encoders can be loaded selectively**); 768-d vectors with Matryoshka
truncation to 512/256/128 (re-normalize after truncating); 8,192-token context shared across
modalities; 100+ languages; Apache 2.0. GGUF sizes: UD-Q4_K_XL 176 MB, Q5 210 MB, Q6 249 MB,
Q8_0 310 MB, F16/BF16 558 MB. Text prefixes: queries `task: search result | query: {query}`,
documents `title: {title} | text: {content}` (`title: none` if absent); prefixes apply to text only.

Consequences:

- **One index space, one query embedding.** A text query is embedded once and compared against
  both document-chunk vectors and image vectors. Media/Documents sections are still separate
  views, but scores are now comparable (still sanity-check calibration, §6).
- **Selective loading** maps directly onto the consent screen: "Documents (text encoder)",
  "Images (+ vision encoder)"; audio/video encoders are not downloaded in v1.
- **Default dimension 256** (Matryoshka) to cut storage/search cost 3x; card says quality stays
  close to full. Make it a setting and record it in `meta`.
- Keep `Xenova/multilingual-e5-small` (already in `browser-ml/embeddings.ts`) as a fallback for
  devices that can't run the model.

**Runtime: resolved — transformers.js + WebGPU + ONNX.** The reference space
(`webml-community/embeddinggemma-2-webgpu`, "Embed Anything": *"Search images, video, audio, and
text with Embedding Gemma 2 running locally in your browser"*) loads
`onnx-community/embeddinggemma-2-ONNX` (Apache 2.0) with `@huggingface/transformers` on WebGPU,
the same stack as `browser-ml/embeddings.ts`. (Earlier revisions of this doc called the runtime
"unverified" and floated GGUF/llama.cpp WASM; both are dropped. GGUF stays irrelevant for the
browser.) From the ONNX model card:

- **Text:** `pipeline('feature-extraction', model, { device: 'webgpu', dtype: 'q4' })`, called with
  `{ pooling: 'mean', normalize: true }` → normalized vectors, dot product = cosine.
- **Image / audio / video:** `AutoProcessor` + `AutoModel`; processor takes `(text, images, audio,
  videos)` with `null` for absent modalities, e.g. `embed(null, image)`. Helpers: `load_image`,
  `load_audio(url, 16000)` (mono 16 kHz), `load_video(url, { fps: 1 })`. No prefix for non-text.
- **dtype is selectable per component** (`model`, `vision_encoder`, `audio_encoder`).
- **Keep each batch under ~2,700 tokens** (a WebGPU dispatch limit); long video may need
  `num_frames: 16` or the wasm device.

Per-component download sizes (q4 unless noted; from the repo's `onnx/` listing):

| Component | q4 | q4f16 | q8 (`_quantized`) |
| --- | --- | --- | --- |
| Text model | 174 MB | 157 MB | 314 MB |
| Vision encoder | 109 MB | 98 MB | 195 MB |
| Audio encoder | 189 MB | 170 MB | 340 MB |

Card quality vs fp32 (worst-case cosine): q8 0.9997, q4/q4f16 0.975 (text 0.988). The card
recommends **q4 for browsers**, q8/fp16 when quality matters more. Defaults here:

- **Documents + images: text q4 + vision q4 ≈ 283 MB** one-time download (consent screen shows this).
- Audio encoder is an optional add-on (phase 2, see §12), same consent pattern, **always q8**
  (+340 MB; the card says audio suffers most from quantization, so it is not tied to the q4/q8
  choice). Video needs only the vision encoder; a video's soundtrack additionally needs the audio encoder.
- Offer "High quality (q8, ~509 MB)" as an option. Record dtype in `meta` (index invalid if changed).
- **WebGPU is required** (decided 2026-10-18, see §14.5). q4/q8 do not run on the WASM backend, so
  there is no silent CPU path. Only if WebGPU is missing or fails to initialize do we ask the user,
  with explicit sizes, to approve an **fp16 CPU fallback** (text 543 MB + vision 336 MB, audio stays
  q8). Without that approval nothing is downloaded for the CPU path.

### 3.3 Where code runs

AGENTS.md is explicit: ML must run in the **offscreen document**. Same here.

```
Side panel / Folder page (UI, user gestures)         Offscreen document (heavy work)
┌──────────────────────────────────────┐             ┌─────────────────────────────────────┐
│ ConsentModelDownload                 │  messages   │ folder-indexer (walk handle, read)  │
│ FolderPicker (showDirectoryPicker)   │ ──────────▶ │ extractors (pdf/docx/txt/...)       │
│ SearchBar + ResultsView              │ ◀────────── │ chunker                             │
│ IndexStatus                          │  progress   │ EmbeddingGemma 2 embedder (text + vision)        │
└──────────────────────────────────────┘             │ vector index (+ persistence)        │
        │ IndexedDB: dir handle, settings            └─────────────────────────────────────┘
        └──────────── shared (same origin) ────────────────────┘
```

- New bridge functions in `browser-ml/offscreen-bridge.ts`, following the existing pattern:
  `offscreenFolderIndexStart/Status/Cancel`, `offscreenFolderSearch`, `offscreenModelStatus/Download`.
- New handlers in `entrypoints/offscreen/main.ts` under an `offscreen:folder:*` namespace.
- Image embedding needs `createImageBitmap` / `RawImage`; both work in an offscreen document
  (it is a normal DOM page). Heavy decoding stays off the side panel main thread.
- The offscreen doc can be closed by Chrome when idle; the indexer must be **resumable**
  (checkpoint after each batch — see §5).

### 3.4 Storage

Reuse `browser-ml/storage.ts` / `vector-search.ts` where they fit; otherwise add a dedicated
IndexedDB database `folderSearch` (Dexie, matching `lib/db.ts`):

| Store | Key | Contents |
| --- | --- | --- |
| `folders` | folderId | name, handle, createdAt, lastIndexedAt, status |
| `files` | folderId + relPath | size, mtime, kind (`image`\|`document`\|`other`), mime, contentHash?, indexState, error? |
| `chunks` | fileId + chunkIdx | text snippet, page/offset, embedding (Float32, normalized) — documents |
| `imageVectors` | fileId | image embedding, width, height, thumbnail Blob (~256px JPEG/WebP) |
| `keywords` | term → postings | inverted index over chunk text + filenames for exact-match boost |
| `meta` | key | model ids + dims + dtype (index is invalid if these change → re-embed) |

Thumbnails are stored so the gallery renders instantly without re-reading/decoding originals and
without holding file handles open. Full-size images are read lazily on click (lightbox).

Vector search: brute-force cosine over normalized `Float32Array` is fine up to ~50k vectors
(dims 384–768) on-device, ideally with WebGPU/WASM SIMD dot products. Beyond that use the
existing `BrowserVectorSearch` index. Decide with a benchmark, not upfront.

## 4. User flow

### 4.1 First run

1. Entry: new skill **"Folder Search"** in Agent Library (see AGENTS.md "Adding a New Skill":
   `SPECIAL_SKILL_ROUTES` + `skills` array in `AgentLibrary.tsx`; add `'folder-search'` to the
   `View` union in `types.ts`; handle in `App.tsx`). Opens a panel view; a "full tab" page
   (`entrypoints/folder-search/`) is offered for big libraries.
2. **Step 1 – Model consent screen** (nothing downloaded yet):
   - What will be downloaded, size per model, from where (huggingface.co), that it is cached
     locally and one-time, that files never leave the device.
   - Checkboxes: Documents model / Images model. Buttons: **Download & continue** / Cancel.
   - Progress bar with per-file progress, pause-less cancel, and retry on failure (errors shown).
   - WebGPU unavailable (no adapter) or failing to initialize → the model download is blocked and
     the screen explains why; a separate, explicit **"Allow CPU fallback (fp16, ~N GB, much slower)"**
     action is offered (§14.5). Nothing is downloaded until the user approves it.
3. **Step 2 – Folder pick:** "Choose folder" button → `showDirectoryPicker({mode:'read', id:'folder-search'})`.
   Show a summary pre-scan: file counts by kind, total size, estimated time. Confirm → **Start indexing**.
4. **Step 3 – Indexing** runs in background; user can search immediately against what is
   indexed so far (banner: "Indexed 1,240 / 8,900 files").

### 4.2 Returning

- Open view → if permission is `granted`, show search. If `prompt`, show **Reconnect folder**.
- Incremental refresh on open and via a "Rescan" button: compare `(size, lastModified)` per
  file; re-index changed, drop deleted. No filesystem watching in v1 (the API has none).

### 4.3 Search

(Screen-level UI for 4.1-4.3 is specified in section 4A.)

- One search box, debounced. Optional filters: type chips (Images / Documents / All), subfolder.
- Result layout:

```
┌ Search: "beach sunset with dog" ───────────────┐
│ ▸ Media (24)                         [See all] │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐  masonry/grid │
│  │img ││img ││img ││img ││img │  thumbnails   │
│  └────┘└────┘└────┘└────┘└────┘               │
│ ▸ Documents (6)                      [See all] │
│  📄 trip-plan.pdf — p.3  …sunset cruise…  0.71 │
│  📝 notes.md           …dog friendly…     0.64 │
└────────────────────────────────────────────────┘
```

- **Section ordering** by top score per section after per-model calibration (see §6.2); a section
  with no results above threshold is collapsed, not shown empty.
- Media: virtualized responsive grid (like the reference space), hover shows filename/path,
  click opens lightbox with prev/next, "Reveal path" (copy path) and "Open file" (create an
  object URL from the file; extension cannot launch OS apps).
- Documents: filename, relative path, snippet with highlighted match, page number for PDFs,
  score. Click → open in new tab via object URL (PDF/text render natively) or download for
  Word etc.
- "Ask" mode (phase 3): feed top-k chunks to the existing LLM via `useScopedLLM` /
  `getTextLLMConfig(settings)` (text-only feature → must honor `textLLMProvider`) to produce a
  cited answer. Retrieval must work without any LLM configured.

## 4A. UI & experience walkthrough

UI conventions: match the existing side panel — shadcn `Button`/`Input`/`Switch`/`Tooltip`,
lucide icons, 12px (`text-xs`) body text, `h-8` controls, `next-themes` light/dark, i18n via
`useI18n`. Status dots reuse `StatusDot` from `sidepanel/components/misc.tsx`. The panel is
narrow (~400px), so layouts are single-column; the full-tab page reuses the same components in a
wider grid.

### 4A.1 Surfaces

| Surface | Purpose | Entry point |
| --- | --- | --- |
| **Folder Search view** (side panel) | Setup stepper, search, results | Agent Library card "Folder Search" → `panelView: 'folder-search'` |
| **Folder Search tab** (`entrypoints/folder-search/`) | Same app, wide gallery, big libraries | "Open in tab" icon in the view header |
| **Folder Search settings** (`folder-search-settings.html`) | Models, folder, excludes, storage, remove | "Manage" row in `ConfigPanel.tsx`; gear icon in the view header |
| **ConfigPanel row** | Status summary + link-out only (see 4A.6) | Settings |
| **Lightbox / PDF viewer** | Preview an image or PDF page with highlight | Click a result |

### 4A.2 The journey, screen by screen

**Screen 0 — Discover.** The user opens the Agent Library and sees a "Folder Search" card
("Search your photos and documents by meaning. Private — runs on your device."). Clicking it
opens the Folder Search view. Nothing is downloaded or read yet.

**Screen 1 — Welcome & privacy (first run only).**

```
┌ Folder Search ──────────────────────────┐
│  Find files by describing them          │
│  "beach photo with dog"                 │
│  "Q3 invoice from Acme"                 │
│                                         │
│  ✓ Runs entirely on your device         │
│  ✓ Files are never uploaded or changed  │
│  ✓ You choose the folder                │
│                                         │
│            [ Get started ]              │
└─────────────────────────────────────────┘
```

A stepper header `1 Model · 2 Folder · 3 Index` appears from here on.

**Screen 2 — Consent to download the model (step 1).** Explicit; nothing starts until clicked.

```
┌ Step 1 of 3 · Download search model ────┐
│ To understand images and text, a model  │
│ must be saved on this computer once.    │
│                                         │
│ ☑ Documents (text)          174 MB      │
│ ☑ Images (vision)           109 MB      │
│ ☐ Audio & video (later)     189 MB  ⓘ   │
│                                         │
│ Total: 283 MB · from huggingface.co     │
│ Quality: (•) Fast (q4) ( ) High (q8)    │
│                                         │
│ ⚠ WebGPU is required but unavailable.   │  only if WebGPU is missing/fails:
│   [ Allow CPU fallback (fp16, 0.9 GB) ] │  Download is disabled until approved
│                                         │
│   [ Cancel ]   [ Download & continue ]  │
└─────────────────────────────────────────┘
```

- Unchecking both components disables the button. High quality updates the sizes live (≈509 MB).
- Warn when `navigator.storage.estimate()` shows too little free quota.

**Screen 3 — Downloading.** Per-component progress bars with bytes, then "Warming up on GPU…".
Cancel keeps completed parts (resumable via the browser cache). A failure shows the error text
verbatim with **Retry** — no silent fallback.

```
│ Downloading models…                     │
│ Text    ████████████░░░  82%  143/174MB │
│ Vision  ███░░░░░░░░░░░░  21%   23/109MB │
│                          [ Cancel ]     │
```

**Screen 4 — Choose a folder (step 2).** One card, one button; the OS picker opens only on click.

```
┌ Step 2 of 3 · Choose a folder ──────────┐
│   Pick the folder you want to search    │
│   Subfolders are included.              │
│          [ Choose folder… ]             │
│  Tip: avoid your whole home or drive.   │
└─────────────────────────────────────────┘
```

After picking, a **pre-scan summary** (fast walk, file contents are not read yet):

```
│ Photos                                  │
│ 🖼 Images     3,412   ·  4.1 GB         │
│ 📄 Documents  1,208   ·  1.3 GB         │
│ ⏭ Skipped       96   (hidden, too large,│
│                       unsupported)  View│
│ Est. time: ~25 min on this device       │
│ ▸ Exclude folders…                      │
│  [ Choose different ]  [ Start indexing]│
```

Broad-folder guard: if the folder looks like a home directory or drive root (or has >100k
files), show an amber warning with "Choose different" as the primary action.

**Screen 5 — Indexing (step 3), usable immediately.** The search box is already visible;
progress sits in a collapsible banner.

```
┌ 🔍 Search your files…            ⚙  ⤢  ┐
│ ● Indexing 1,240 / 4,620 · ~18 min      │
│   Images 900/3,412 · Docs 340/1,208     │
│   [ Pause ]  [ Details ▾ ]              │
│ Results may be incomplete until done.   │
```

Details lists the current file, skipped/error files with reasons (copyable), and storage used.
Closing the panel does not stop indexing (it runs in the offscreen document); reopening shows
live status.

**Screen 6 — Searching.** Before typing: example query chips built from the user's own folder
names/file types, plus filter chips `All · Images · Documents`. While typing (debounced), skeleton
cards, then two sections:

```
┌ 🔍 beach sunset with dog         [All ▾] ┐
│ Media · 24                       See all │
│ ┌────┐┌────┐┌────┐                      │
│ │    ││    ││    │  3-col thumbnails     │
│ └────┘└────┘└────┘  (hover: name, score) │
│ Documents · 6                    See all │
│ 📄 trip-plan.pdf · p.3        0.71       │
│    …sunset cruise with Biscuit the dog…  │
│    ▭ page thumbnail                      │
│ 📝 notes.md                   0.64       │
│    …dog friendly beaches…                │
└──────────────────────────────────────────┘
```

- Section order follows the strongest calibrated hit; a section with nothing relevant collapses
  to one line ("No documents matched").
- The media grid is virtualized; "See all" expands the section to the full panel (or tab).
- A query that looks like an exact string (ID, error code) shows keyword matches first with the
  matched term highlighted.
- **Zero results:** "Nothing matched. Try fewer words, or describe what's in it." plus indexing
  status if still running.

**Screen 7 — Open a result.**

- *Image:* lightbox with prev/next, zoom, filename + relative path, **Copy path**, **Open
  original**, and **Find similar** (image-to-image search from that image's own vector).
- *PDF:* in-app pdf.js viewer at the matched page with the text highlighted, or **Open in new
  tab** → browser PDF viewer at `#page=N`.
- *Other documents:* text preview with the highlighted snippet; Word and other formats offer
  **Download/Open**.
- Keyboard: `/` focuses search, arrows move through results, `Enter` opens, `Esc` closes.

**Screen 8 — Returning later.**

- Permission still granted → straight to search, with a quiet "Checking for changes…" rescan chip.
- Permission needs re-granting (common after a browser restart) → inline card: "Reconnect
  *Photos* to keep searching" + **Reconnect** (one click, calls `requestPermission`). Search over
  the existing index still works from stored thumbnails/snippets; only opening originals needs it.
- Folder moved/renamed/deleted → "We can't find this folder" with **Choose again** (the index is
  kept until the user confirms the replacement).

**Screen 9 — Manage (settings page).** Sections: *Models* (status, size on disk, remove, switch
q4/q8, add audio/video), *Folder* (name, last scan, **Rescan now**, change folder, exclude
patterns, size caps, skipped-files list), *Storage* (index + thumbnails size), *Danger zone*
(**Remove folder & index**, **Remove models**) with a confirm dialog that states exactly what is
deleted. Original files are never touched, and the dialog says so.

### 4A.3 States every screen must handle

| State | UI |
| --- | --- |
| No WebGPU / WebGPU init fails | Consent screen blocks download and offers the approval-gated fp16 CPU fallback (§14.5); once approved, banner shows "CPU mode (slow)" |
| Model download failed / offline | Error text + Retry; search disabled with the reason |
| Indexing paused (user, or browser suspended the offscreen doc) | Banner "Paused · Resume" |
| Partial index | Results marked "Partial index" until done |
| File unreadable / parser failed | Listed under Details › Errors; never blocks the run |
| Quota exceeded | Actionable message linking to Manage › Storage |
| Index/model mismatch | "Re-index required (model updated)" with one button |
| No File System Access API | Explains the limitation; offers one-shot import if built |

### 4A.4 Accessibility, i18n, theming

- Every control is keyboard reachable; focus returns to the trigger when the lightbox closes.
- Images get `alt` = filename; scores are never the only signal (no color-only meaning).
- Progress uses `role="progressbar"`; live-region updates are throttled.
- All strings go through `t()`; example queries and file names are user data and are not translated.
- Light/dark via existing tokens; thumbnails sit on a neutral surface so transparency is visible.

### 4A.5 Component map

```
FolderSearch.tsx          stepper + state machine: welcome → consent → download → pick → scan → search
├─ ModelConsent.tsx / ModelProgress.tsx
├─ FolderPicker.tsx / PreScanSummary.tsx
├─ IndexBanner.tsx / IndexDetails.tsx
├─ SearchBar.tsx (+ FilterChips, ExampleQueries)
├─ SearchResults.tsx
│   ├─ MediaSection.tsx → MediaGrid.tsx (virtualized) → Lightbox.tsx
│   └─ DocumentSection.tsx → DocumentCard.tsx → PdfViewer.tsx
└─ ReconnectCard.tsx
```

State lives in one `useFolderSearch()` hook (setup phase, index status, query, results) that
talks to the offscreen document through the bridge in §3.3. The setup phase is persisted so
closing and reopening the panel resumes at the right screen.

### 4A.6 ConfigPanel.tsx integration

`ConfigPanel.tsx` is the navigation agent's settings page (LLM provider, theme, language, voice).
Folder Search adds **one row only**, the same way it already links out to
`browser-llm-settings.html`, `content-access-settings.html` and `vault-settings.html`:

```
Folder Search
│ 📁 Folder Search          ● Ready · 4,620 files │   or "Not set up" / amber "Reconnect"
│ Models 283 MB (q4) · last scan 10 min ago        │
│                                   [ Manage ]     │  → folder-search-settings.html
```

- Placed next to "Edit Content Access Policy", same row style (`Button variant="outline" size="sm"`).
- Reads status only (from the `folderSearch` store); it must **not** be wired into
  `handleSave` / `UnifiedSettings`, which saves everything at once.
- Model download, folder picking and removal never happen inside ConfigPanel: too large for the
  panel, and the folder picker needs a user gesture on the page that owns the handle.
- Any optional "Ask" mode LLM resolves via `getTextLLMConfig(settings)`; no new provider
  selector is added here.

## 5. Indexing pipeline

```
walk(handle) → classify → [skip rules] → extract → chunk → embed(batch) → write → checkpoint
```

1. **Walk:** async-iterate `handle.values()` recursively. Skip: hidden dirs (`.git`,
   `node_modules`, `.*`), symlink loops (track visited), OS junk (`Thumbs.db`, `.DS_Store`), and
   files above a size cap (default 100 MB docs / 50 MB images; configurable). Skipped files are
   recorded with a reason and listed in the UI.
2. **Classify** by extension + `File.type`:
   - *Media:* jpg, jpeg, png, webp, gif, bmp, avif (heic best-effort, may be unsupported → logged).
   - *Documents:* pdf, docx, txt, md, csv, json, html, rtf, plus common source/code text.
   - *Other:* listed in file inventory only, not embedded.
3. **Extract (documents)**, all in the offscreen doc, bundled (no remote code):
   - txt/md/csv/json/html: `file.text()`; HTML via existing `parseHtmlToMarkdown`.
   - PDF (the web is *stronger* than native here): `pdfjs-dist` runs entirely in the offscreen doc
     and gives, per page, (a) the text layer with positions, (b) a canvas render of the page, and
     (c) outline/links/annotations. Embed **both** the text chunks and the rendered page image
     (vision encoder), so scans, charts, slides and tables are findable without OCR. Pages are
     kept as small thumbnails for result cards, and results open in Chrome's built-in PDF viewer
     via object URL + `#page=N`, or in a pdf.js lightbox with the matching text highlighted.
     Index the first ~30 pages first, the rest (cap, e.g. 5,000) in the background.
   - DOCX: unzip + parse `word/document.xml` (e.g. `mammoth` or `fflate` + minimal parser).
   - Legacy `.doc`, `.xls`, etc.: unsupported in v1, listed as such.
4. **Chunk:** ~200–300 tokens with ~15% overlap, split on paragraph/heading boundaries; store
   page/offset. Prepend filename + folder path to the embedded text so name-only matches work.
5. **Embed:** batches (existing `batchSize` logic), WebGPU preferred. Images: decode →
   resize for the model → vision encoder; generate thumbnail from the same decoded bitmap.
6. **Write & checkpoint:** commit per batch; `files.indexState` ∈ `pending|indexed|skipped|error`.
   On restart, resume from `pending`. Cancel is cooperative between batches.
7. **Concurrency:** one file-reading loop feeding one embedding queue; images and documents
   interleave but never run two models on the GPU simultaneously. Yield to keep the UI live and
   respect `navigator.deviceMemory`.

## 6. Search & ranking

1. Embed the query once (text prefix `task: search result | query: ...`).
2. Cosine top-k against the chunk index and the image index (k≈50 each).
3. Documents: group chunks by file, file score = max chunk score (+ small boost for filename
   hit and multiple matching chunks); show best snippet.
4. **Hybrid (MVP, from DigUp):** BM25-style keyword score fused with vector score (reciprocal rank
   fusion) so exact strings (names, IDs, error codes) match. Needs a keyword index store (§3.4).
5. **6.2 Calibration:** text→text and text→image cosine scores usually sit in different ranges even
   in a shared space. Apply a per-modality threshold/normalization (e.g. z-score against the
   index's score distribution) before deciding section order and which results to drop. Tune on a
   small labeled sample.

## 7. Code layout (proposed)

```
packages/extension/src/
├── folder-search/
│   ├── types.ts                 # FolderRecord, FileRecord, SearchResult, FileKind
│   ├── fileAccess.ts            # showDirectoryPicker, handle persistence, permission helpers
│   ├── db.ts                    # Dexie schema
│   ├── classify.ts              # extension → kind, skip rules
│   ├── extractors/{text,pdf,docx}.ts
│   ├── chunker.ts
│   ├── indexer.ts               # pipeline (runs in offscreen)
│   ├── search.ts                # query embedding, top-k, grouping, fusion
│   ├── modelManager.ts          # status/download/remove for the two models
│   └── *.test.ts                # classify, chunker, grouping/ranking
├── browser-ml/
│   ├── gemma-embeddings.ts      # NEW – EmbeddingGemma 2 text+image (offscreen only; same warning
│   │                            #   header as embeddings.ts)
│   └── offscreen-bridge.ts      # + folder-search bridge functions
├── entrypoints/offscreen/main.ts        # + offscreen:folder:* handlers
└── entrypoints/sidepanel/components/FolderSearch/
    ├── FolderSearch.tsx         # step router: consent → pick → index → search
    ├── ModelConsent.tsx
    ├── FolderPicker.tsx
    ├── IndexStatus.tsx          # progress, skipped/error list, rescan
    ├── SearchResults.tsx        # Media + Documents sections
    ├── MediaGrid.tsx            # virtualized, lightbox
    └── DocumentList.tsx
```

Tests (per AGENTS.md "test value" rule): classifier/skip rules, chunker boundaries and overlap,
incremental-diff logic (changed/deleted/unchanged), and ranking/grouping. No tests that merely
restate implementation. Model inference stays out of unit tests; add a `*.live.test.ts` only if
needed.

## 8. Manifest & policy impact

- **No new permissions required**: File System Access works from extension pages; `offscreen`
  and `storage` already exist. Optionally add `unlimitedStorage` — thumbnails + vectors for a
  large library can exceed default quotas; justify it in the listing.
- **CSP:** model weights fetched from huggingface.co by transformers.js are `fetch` calls
  (connect), not script/worker loads, so `script-src`/`worker-src 'self'` is unaffected. WASM
  runtime and any pdf.js worker must be **bundled locally** (same-origin) — do not load from a CDN.
  Verify whether `connect-src`/host access to `huggingface.co` needs declaring; check against the
  existing LLM-download path rather than assuming.
- **Web Store listing:** privacy policy must state that selected-folder contents are processed
  locally and never uploaded. Matches `designGuidelines.md` ("listing matches actual behavior").
- The tab-access policy engine (`accessListControl/`) governs web tabs; it does not apply to
  local folders, but the folder feature must not expose file content to the web-automation
  agent unless the user explicitly invokes "Ask" mode.

## 9. Privacy & security

- Local processing only; no analytics events containing file names, paths or content.
- Folder handle is read-only; no write APIs imported in the feature code.
- "Remove folder & index" in settings deletes handle, vectors, thumbnails, and offers to remove
  the models from cache. Clear status of how much disk the index uses.
- Sensitive-file hygiene: default skip list for obvious secrets (`.env`, `*.pem`, `id_rsa*`,
  `*.kdbx`, browser profile dirs); user-editable exclude patterns. Warn when the chosen folder is
  very broad (home dir, drive root).
- Extractors parse untrusted files: run only in the offscreen doc, cap sizes/pages/time per file,
  and treat a parser exception as a per-file error, never a crash of the whole run.

## 10. Performance targets (to validate)

| Item | Target |
| --- | --- |
| Query latency (≤20k vectors) | < 300 ms after models are warm |
| Cold start (models cached) | < 5 s to first query |
| Image indexing (WebGPU) | ≥ 5–10 img/s; CPU fallback acceptable but slow, with ETA shown |
| Doc indexing | ≥ 20 chunks/s on WebGPU |
| Memory | Bounded batches; no full-library arrays in memory besides vectors |

Numbers are goals, not measurements — benchmark on a mid-range laptop before promising ETAs in UI.

## 11. Edge cases

- Permission revoked / folder moved or renamed → "Reconnect or choose a new folder"; keep the old
  index until the user confirms replacement.
- User picks a new folder → either replace or add (multi-folder is a v2 schema extension; the
  `folderId` key already allows it).
- File changes mid-index → compare mtime at write; mark `pending` again.
- Model/version change → `meta` mismatch triggers a clear "Re-index required" prompt, not silent
  stale results.
- Very large libraries (100k+ files) → paginate walk, show estimated time, allow
  "index images only / documents only", allow pause/cancel.
- Low storage / quota errors → surfaced with actionable message.
- Duplicate images (same hash) → index once, show all paths (phase 2).
- Browser without WebGPU or File System Access → clear unsupported message with fallback path.

## 12. Phasing

1. **MVP:** consent flow, folder pick + persistence, text/MD/PDF extraction, doc embeddings,
   image embeddings with thumbnails, two-section results, hybrid keyword fusion, PDF page images (scan support), resume + rescan,
   remove-folder.
2. **Quality:** DOCX, score calibration, filters, duplicate detection,
   lightbox polish, exclude-pattern UI.
   Also **audio/video** search: add the audio encoder (q8, +340 MB), 30 s audio windows, and video
   as **one segment per minute (≤16 frames) through the `videos` modality**, plus a separate
   soundtrack vector per 30 s window; results carry timestamps (§14.5).
3. **Answers:** cited "Ask" mode via text LLM, multi-folder, image captions as text.

## 13. Open questions

1. Default dtype: q4 (283 MB, 0.975 worst-case cosine) vs q8 (509 MB). Run a small retrieval
   comparison on real folders before fixing the default.
2. WebGPU availability/limits across user machines: confirm the ~2,700-token batch limit and
   memory use in an **offscreen document** (the space runs in a normal page, and offscreen
   documents may behave differently); wasm fallback speed.
3. Matryoshka size (256 default vs 768) — measure recall loss on images vs text.
4. Panel-only vs. also a full-tab page? (Recommend both, sharing components.)
5. Is `unlimitedStorage` acceptable for the Web Store review posture?
6. "Open file" beyond object URLs (native messaging)? Recommend no for v1.

## 14. Runtime lessons and review against an independent implementation

Source: tpiros.dev, "EmbeddingGemma 2 in the browser" (fetched 2026-10-18), a browser app using the
same ONNX export and transformers.js 4.3.1. It is a second data point, not a spec; its numbers come
from a ~20-file test set.

### 14.1 Fixes already made

- **ONNX Runtime must be local (CSP).** transformers.js defaults `wasmPaths` to jsdelivr and
  re-wraps the loader as a `blob:` URL; `script-src 'self'` blocks both, giving "no available
  backend … Failed to fetch dynamically imported module: blob:…". Now `copyOrtAssets`
  (`wxt.config.js`) copies `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` to `public/ort/`,
  `gemma-embeddings.ts` points `wasmPaths` there and sets `useWasmCache = false`. The article
  reached the same conclusion (bundles the wasm locally).
- **Batches stay under ~2,600 tokens** (limit ~2,700). Text batches are planned from real token
  counts with padding counted as `items × longest` (`folder-search/batching.ts`); images use
  `max_soft_tokens = 280` and batches of 4. The article uses the same budget and padding rule.
  Token costs it reports: text ≈ 1/subword, image ≤ 280, video frame 140, audio 25/s (our 30 s
  window ≈ 750).
- **Nested lists for the processor.** `processor(null, [[a], [b]])` yields two vectors,
  `processor(null, [a, b])` one blended vector, silently. `embedImages` wraps each image.

### 14.2 Where we agree

Selective encoder loading via `config.vision_config/audio_config = null`; `AutoModel` +
`AutoProcessor` rather than the pipeline; `sentence_embedding` output; query/document prefixes only
on text; re-normalize after Matryoshka truncation; 256 dims as the default; brute-force dot product
(no ANN index; its 100k-vector estimate is unmeasured, like ours); best-segment scoring per
file with the winning timestamp kept.

### 14.3 Gaps and decisions

| Finding | Our state | Recommendation |
| --- | --- | --- |
| **WASM/CPU cannot run q4/q8.** The article hit a missing `GatherBlockQuantized` kernel in ONNX Runtime WASM 1.31.0-dev for every quantized text and vision variant; it fell back to **fp16** (about 1.2 GB) and measured 403 s vs 26 s on WebGPU for a small set. | We offer a "slower CPU path" and the consent screen said so. That was wrong: with q4/q8 the load will fail. The consent warning now says so; images go one per call on WASM. | **Decided (§14.5):** require WebGPU; offer an approval-gated fp16 fallback only if WebGPU does not work. |
| **Audio is the most quantization-sensitive** (model card); the article keeps audio at q8 and the rest at q4. | Audio uses the same dtype as the rest (q4 by default). | **Decided (§14.5):** audio encoder pinned to q8 (+151 MB over q4). |
| **Full 768-d vectors stored, truncated at search time.** | We truncate at index time (stored `dim`, default 256; ~3× less storage). Changing `dim` forces a re-index. | Keep ours for storage cost; accept the re-index. Revisit if users want to tune dimensions. |
| **Video** is segmented per minute (≤16 frames) and sent through the `videos` modality; soundtracks get their own vector. | We embed ~1 frame/s as independent images (up to 600 per file) and ignore the soundtrack. Slower to index, more vectors, and speech in videos is not searchable. | **Decided (§14.5):** segment per minute (≤16 frames) via the `videos` modality, plus soundtrack vectors. |
| **Audio chunks** of ≤100 s. | 30 s windows (finer timestamps, ~3× more vectors). | Keep; it matches "open at the moment" better. |
| **Inference in a Web Worker** (workers lack `AudioContext`/`<video>`, so the page decodes media). | Inference runs on the offscreen document's main thread (no UI to block), and media decoding runs in the same page. | Fine for now. Pause/cancel are cooperative between awaits, so a very long single model call delays them. |
| **Image queries weight colour and texture heavily.** | Not handled. | Mention in help text; no code change. |
| **No similarity threshold or calibration** is given; results are just ranked. | We drop hits below 2.5 σ over each modality's own score distribution. | Priors and the cutoff remain untuned (§6.2); the article offers no evidence either way. |

### 14.5 Decisions taken (2026-10-18)

1. **WebGPU required; fp16 CPU fallback only with approval.**
   - Probe `navigator.gpu.requestAdapter()` before any download. No adapter, or a WebGPU error while
     loading, blocks the normal download and shows why.
   - The user may then explicitly approve the fallback: text + vision as fp16 (543 + 336 MB), audio
     q8 (340 MB), run on the WASM backend. The approval is stored (`cpuFallbackApproved`) and can be
     revoked in Manage. Nothing for the CPU path is downloaded before approval.
   - dtype `fp16` is part of the index signature, so switching between WebGPU (q4/q8) and CPU
     (fp16) requires a re-index, as any dtype change does.
   - CPU mode embeds one image per call (batches ran out of WASM memory) and is expected to be
     more than 10× slower (the article measured 26 s vs 403 s).
2. **Audio encoder is always q8**, independent of the q4/q8 choice. Consent sizes and status checks
   use the per-component dtype.
3. **Video** goes through the `videos` modality, not independent frames:
   - one segment per 60 s, up to 16 frames evenly spaced inside it (16 × 140 tokens = 2,240, under
     the batch budget), one segment per model call; each segment is one vector with its start time;
   - the soundtrack is embedded separately as 30 s audio windows (needs the audio encoder, and is
     skipped with a note for files over 200 MB or without an audio track);
   - a file is scored by its best segment or soundtrack window, and the timestamp is kept;
   - at most 120 segments (2 h) are indexed per file, with a note.
   - nesting rules, confirmed in the transformers.js 4.3.1 processor source: a flat list of
     **images** is one sample (wrap each image: `[[img]]`), while a flat list of **audio clips or
     videos** is one sample per item. Audio and video are embedded one item per call.

### 14.4 Still unverified here

Nothing in this repo has executed the EmbeddingGemma calls in a real browser. In particular:

- the `max_soft_tokens` property on the image processor;
- the `RawVideo` path (`processor(null, null, null, [video])`) and the ~140 tokens/frame figure that
  keeps a 16-frame segment under the batch budget;
- decoding a video's soundtrack with `AudioContext.decodeAudioData` on the video file;
- the `probeWebGPU()` adapter check and WebGPU behaviour inside an offscreen document;
- the fp16 CPU path end to end (file names `*_fp16.onnx`, memory use, the one-image-per-call rule).

The nesting rules for audio and video were checked against the library source, not by running them.
