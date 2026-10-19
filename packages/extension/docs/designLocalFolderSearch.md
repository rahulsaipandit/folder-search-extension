# Local Folder Search (Visual RAG over a User-Selected Folder)

Status: **Implemented (all three phases), not yet validated in a real browser.** Date: 2026-10-18.

Implementation notes (deviations from the proposal below):

- Storage uses `idb` (already a dependency, like `lib/db.ts`), not Dexie. The `files`/`chunks`/`imageVectors`/`keywords`/`meta` stores follow §3.4; added `mediaUnits` for audio/video and `byHash` for duplicates.
- Vector search is brute force over contiguous `Float32Array`s (`ranking.ts` `VectorMatrix`); no benchmark has been run, so the 50k-vector ceiling in §3.4 is still an estimate.
- Calibration (§6.2) z-scores each query against the folder's own score distribution, shrunk toward unmeasured priors for tiny indexes. Priors and the 2.5σ display threshold need tuning on labeled data (§13).
- Keyword scoring is BM25 without length normalization (chunk lengths are bounded by the chunker).
- Most UI strings are still English literals; the i18n infrastructure and a language picker are live, and moving the rest behind `t()` is outstanding work (§4A.4, §14.7).
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

1. Entry: the side panel **is** Folder Search (§14.6): clicking the toolbar icon opens it directly,
   with no agent chat, library or view router. A "full tab" page (`entrypoints/folder-search/`)
   is offered for big libraries.
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
| **Folder Search view** (side panel) | Setup stepper, search, results | The extension's side panel (its only view) |
| **Folder Search tab** (`entrypoints/folder-search/`) | Same app, wide gallery, big libraries | "Open in tab" icon in the view header |
| **Folder Search settings** (`folder-search-settings.html`) | Models, folder, excludes, storage, remove | Gear icon in the view header |
| **Lightbox / PDF viewer** | Preview an image or PDF page with highlight | Click a result |

### 4A.2 The journey, screen by screen

**Screen 0 — Open.** The user clicks the toolbar icon and lands on Folder Search (the welcome
screen on first run). Nothing is downloaded or read yet.

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
- Strings are meant to go through `t()` (§14.7); example queries and file names are user data and are not translated.
- Light/dark via existing tokens; thumbnails sit on a neutral surface so transparency is visible.

### 4A.5 Component map

```
FolderSearch.tsx          stepper + state machine: welcome → consent → download → pick → scan → search
├─ ModelConsent.tsx / ModelProgress.tsx
├─ FolderPicker.tsx / PreScanSummary.tsx
├─ IndexBanner.tsx / IndexDetails.tsx
├─ SearchBar.tsx (+ FilterChips, ExampleQueries)   (+ menu, mic, camera, paste/drop: §4B.2)
├─ Browse.tsx → FileTable / glass media wall (CSS fallback): §4B.1, §4B.3
├─ SearchResults.tsx
│   ├─ MediaSection.tsx → MediaGrid.tsx (virtualized) → Lightbox.tsx
│   └─ DocumentSection.tsx → DocumentCard.tsx → PdfViewer.tsx
└─ ReconnectCard.tsx
```

State lives in one `useFolderSearch()` hook (setup phase, index status, query, results) that
talks to the offscreen document through the bridge in §3.3. The setup phase is persisted so
closing and reopening the panel resumes at the right screen.

### 4A.6 Settings entry (superseded)

An earlier revision added a status row to `ConfigPanel.tsx`. With no agent chat there is no
ConfigPanel, so settings are reached only through the gear in the Folder Search header (Manage
page). Model download, folder picking and removal always happen on pages that own the handle,
never inside a small panel. An optional "Ask" mode resolves its LLM via `getTextLLMConfig(settings)`;
its provider is chosen on the existing AI-provider settings page.

## 4B. Browse view, search bar and the glass media wall

Added 2026-10-18. This section records the browse view (what the panel shows before you type), the
search bar, and the WebGL "glass" wall of images, videos and audio with its CSS fallback.

### 4B.1 Browse view (empty search box)

With no query, no "find similar" and no media query, the panel lists indexed files instead of an
empty box (`Browse.tsx`, pure logic in `browse.ts`). The chips choose what is listed:

| Chip | Shows |
| --- | --- |
| All | the media wall (images, videos, audio), then a details table of documents |
| Images | the media wall, images only |
| Documents | details table |
| Audio & video | the media wall, audio and video only |

- **Details table** (like Explorer's Details view): Name (with folder underneath), Modified, Type, Size.
  Click a header to sort; click again to reverse. Names sort naturally (`img2` before `img10`).
  Click a row to open the file. It lists indexed files only (never skipped or unsupported ones).
- **Media wall**: newest first, justified rows (§4B.3). Byte-identical duplicate images are left out
  because they carry no vectors or thumbnails; they still appear in search results.
- Typing, Enter, a media query or "find similar" replaces the browse view with ranked results.

### 4B.2 Search bar

One pill-shaped bar modelled on the EmbeddingGemma 2 WebGPU demo:

| Control | Behaviour |
| --- | --- |
| `+` | Menu: **Add a folder**, or **Search with an image or sound…** (file picker) |
| Text box | Search as you type (300 ms pause); **Enter** searches immediately |
| Mic | Record up to 30 s; click again to stop and search by what was said or played |
| Camera | Webcam dialog; the photo becomes the query |
| Paste / drop | An image or audio file pasted into, or dropped on, the bar becomes the query |

- Image and audio queries are embedded by the vision/audio encoder in the offscreen document
  (`offscreen:folder:search-media`) and scored against every stored modality in the shared space
  (`SearchIndex.searchByVector`). Images are downscaled to 768 px JPEG in the panel first, and both
  kinds travel as base64 because runtime messages are JSON. The camera and mic are disabled unless
  the matching encoder was enabled and indexed.
- **Camera/microphone permission.** Side panels usually cannot show Chrome's prompt, so a blocked
  request opens `media-permission.html?kind=audio|video`, a normal tab that asks. The grant is stored
  for the extension origin, so the panel's own request then succeeds. Nothing is recorded there.
- **Relevance filter.** Each modality's results are cut at a clear gap in the real scores
  (`clearGapCutoff`, `ranking.ts`) before the z-score gate, because the gate's priors are unmeasured
  and on small indexes let every item through. Scores and cut-offs are logged to the offscreen console
  for tuning.
- Not supported (unlike the demo): video or text files as the query, and recordings over 30 s (the
  audio encoder embeds one 30 s window per query).

### 4B.3 The glass media wall

**What the user sees.** Images, videos and audio drawn as thick rounded glass tiles of the same height
in each row. Videos play inside their tile; audio shows an animated waveform card. The edges bend the picture
(refraction with slight colour fringing) and a soft reflection and rim light sit on the surface. As
the pointer moves over the wall the whole scene turns a few degrees toward it (the demo's "orbit"), so
the glass keeps catching light; a hovered tile brightens and shows its name. It is modelled on the
demo's behaviour and look; the shaders are our own (see "Provenance").

**Applies to any folder.** Nothing is specific to a data set. Whatever the indexer stores is what the wall
draws: for an image its 256 px JPEG `thumbnail` plus original `width`/`height` (`imageVectors`), for a
video the poster frame of its first segment (`mediaUnits`) plus `FileRecord.width/height/duration`, for
audio `FileRecord.duration` and `waveform` (§4B.6).
A newly chosen folder, a rescan, or files added later appear with the same effect, because the wall
is built from the index at render time and holds no precomputed assets. It reads IndexedDB from the
panel; the offscreen document, the network and the model are not involved.

**How it is achieved.** One WebGL2 canvas draws every visible tile in a single instanced call.

1. **Layout (`glass/layout.ts`, pure, unit-tested).** Justified rows, as in the demo: every row has one
   height, a tile's width is that height times its aspect ratio, and rows are balanced (items are split
   into rows of similar total width) so each fills the full width. So photos and videos in a row are the
   same height. The row count is chosen so rows land near a target height (140 px in the side panel,
   200 px on the full-tab page). A row that would grow beyond 1.5× the target (a few items in a wide
   window) is capped and left-aligned instead. Tile aspect equals the item's aspect, so pictures are
   shown undistorted; audio tiles are 4:3 (there is no picture to take a shape from).
2. **Scrolling.** The tall wrapper gets the full layout height (so native scrolling, scrollbars and
   find-in-page behave). The canvas is `position: sticky; top: 0` inside it, sized to the viewport, and
   draws the slice of the layout that is on screen (scroll offset = how far the wrapper's top is above
   the viewport).
3. **Interaction layer.** An invisible `<button>` per tile sits at the tile's rectangle, above the
   canvas. The browser does the hit-testing, keyboard focus, `aria-label` (file name) and click; the
   canvas only paints. Hovering a button brightens that tile and shows its name; the pointer position over the wall drives
   the orbit.
4. **Textures.** Pictures live in one `TEXTURE_2D_ARRAY` of fixed 320×320 layers used as a pool. A tile
   gets a layer when it is within about one screen of the viewport and gives it back when it leaves
   (least recently visible first). Each picture is decoded with `createImageBitmap` straight to
   320×320 (a stretch that the matching tile aspect undoes) and uploaded with `texSubImage3D`.
   GPU memory is bounded by the pool (128 layers ≈ 52 MB), not by the number of items. Which tile owns
   which layer, the least-recently-drawn eviction, and the tokens that discard a load finishing after its
   layer was re-assigned are the pure `glass/layerPool.ts`; the renderer only uploads. The layer is
   larger than the stored 256 px thumbnails so that playing video stays sharp.
5. **Vertex shader.** Places each tile's quad in pixel space with a slight spherical bulge, rotates the
   whole scene about the viewport centre by the orbit (at most 0.05 rad,
   about 3°, pitch and yaw), and projects it with perspective (focal length 1200 px).
6. **Fragment shader.**
   - a signed-distance rounded rectangle gives the silhouette and anti-aliased edge;
   - a bevel profile (a steep rounded falloff near the edge) is differentiated numerically into a
     surface normal, so the rim bends light and the middle stays flat;
   - the view ray is refracted three times with slightly different indices of refraction (red, green,
     blue) and the thumbnail is sampled at three offsets, which produces the colour fringing;
   - a Schlick-Fresnel mix adds reflection of a procedural "studio" environment (a vertical gradient
     plus two soft boxes, computed analytically in the shader: no HDR file is loaded);
   - a thin rim light and a small hover brightening finish the look. The refraction and reflection use
     the orbit-rotated view direction, which is why the highlights slide as the pointer moves.
7. **Animation.** Each tile eases a `hover` value (a slight brighten, no movement of its own), and the
   orbit eases toward the pointer (about 90 ms). Moving off the wall eases it back to rest. The motion
   people see is therefore page-level: the whole scene turns about the viewport centre, so tiles near the
   edges move more than tiles near the middle. The render loop runs only while something is changing
   (hover easing, scrolling, a texture arriving, a playing video or audio tile) and then stops, so an
   idle panel with nothing playing uses no GPU.
8. **Live tiles (`glass/WallMedia.ts`).** See "Video, audio and the viewer" below.

**Performance budget.**

| Concern | Decision |
| --- | --- |
| Fill rate | one pass, ~5 texture reads per pixel; resolution capped at devicePixelRatio 2 |
| Playing video | at most 8 videos play at once (4 on touch devices, as in the demo); each decoded frame is drawn once into a 320×320 scratch canvas and uploaded to the tile's layer |
| Draw calls | 1 per frame for all visible tiles |
| GPU memory | texture pool (128 layers ≈ 52 MB); a few small buffers |
| Idle cost | none: no animation frame requested when nothing changes |
| DOM | one transparent button per tile (no images); wall capped at 1,000 tiles with "Show more" |
| Contention | indexing also uses the GPU (in the offscreen document); the context asks for `powerPreference: 'low-power'` so a laptop keeps the wall on the integrated GPU; a busy GPU can still make it drop frames |

These are design limits, not measurements (§4B.7).

**Fallback: the CSS wall.** The previous implementation (CSS columns, pointer tilt and a highlight via
inline transforms; video shows its poster and audio a plain card, both with the same kind and duration
labels) is kept and is used when any of these is true: WebGL2 is unavailable or the shader
fails to compile, the context is lost and does not restore, or the user has asked for reduced motion
(`prefers-reduced-motion`). The switch is automatic; both walls share the same lightbox, thumbnails and
hover label, so behaviour is identical apart from the look and from playback: the CSS wall does not
play videos in the grid (clicking still opens the viewer).

**Accessibility.** Tiles are real buttons in reading order with the file name as the label and a visible
focus ring (a brighter rim on the glass tile, plus a DOM outline on the button). Video and audio tiles
label themselves with their kind and length (`aria-label` "name, video, 0:12"). Reduced motion selects
the CSS wall with its transitions off, so nothing autoplays for those users. Opening an image uses the
lightbox; opening a video or audio file uses the media viewer. Both are modal: Tab stays inside them
(`focusTrap.ts`: Tab on the last control wraps to the first, Shift+Tab on the first to the last, stray
focus comes back in), and both return focus to the tile on close.

**Video, audio and the viewer** (how the demo does it, read from its bundle):

- **Labels.** Video and audio tiles carry two HTML elements in the button layer: a pill at the top left
  with a play or pause glyph and the kind ("Video" / "Audio"), and the duration at the top right. The
  glyph is a pause when that video is playing and a play triangle otherwise. They are HTML, not drawn in
  WebGL, so they stay crisp; they do not turn with the orbit (a few pixels of drift at the edges).
- **Video plays on the wall.** Videos near the viewport (nearest first, up to 8) autoplay muted and
  looping. A hidden `<video>` is created per tile from the original file (read from the folder handle,
  object URL); `requestVideoFrameCallback` copies each new frame into the tile's texture layer. Videos
  that leave the viewport are released (paused, `src` removed, URL revoked). Everything pauses while the
  tab is hidden or a viewer is open.
- **Audio cards.** A dark gradient with a centre line and one bar per stored peak (96 peaks resampled to
  the card width), a gradient fill, and a gentle pulse rolling along the bars, redrawn every 50 ms for the
  audio tiles near the viewport. Until peaks are known a placeholder pattern is drawn.
- **Viewer (`MediaViewer.tsx`).** Clicking a video or audio tile opens a viewer that plays with sound:
  play/pause, a seek bar, the time (`0:03 / 0:12`) and mute, plus Open original and Close (Escape).
  Audio shows the same waveform with the play position and a cursor. Space toggles playback.
- **Access to the original.** Playing needs the folder handle's permission. After a browser restart it may
  have lapsed: the tile then keeps its poster, one warning is logged for that file, and the existing
  "Reconnect" card restores access. Nothing is retried on every scroll.
- **Not covered:** a file the browser cannot decode (the tile keeps its poster and is not retried), and
  files without a length in their header (some recorded WebM): the duration label stays blank.

**Privacy and security.** No network access, no remote textures or HDR, no new permissions. Thumbnails
never leave the page: they go from IndexedDB blobs to GPU textures.

**Provenance.** The look follows the EmbeddingGemma 2 WebGPU demo (a WebGL2 scene with rounded-rect
signed-distance cards, a bevel-derived normal, per-channel refraction, Fresnel reflection of an
environment map and a rim light). The demo's source is a minified bundle with no stated license, so
nothing was copied: the techniques are standard, and the shaders here are written from scratch. We use
a procedural environment instead of its 1.7 MB `studio.hdr`.

**How it compares with the demo's source** (read from its published bundle):

| | Demo | Here |
| --- | --- | --- |
| Motion on hover | `setOrbit`: the whole scene turns up to ±0.05 rad toward the pointer, eased; disabled for reduced motion | Same (global orbit, eased; reduced motion uses the CSS wall) |
| Per-card hover | `card.hover = 1`: slight brightening plus label and relevance score | Slight brightening plus name label; relevance shown in search results |
| Structure | WebGL2 instanced draw, DOM button layer for labels and focus, CSS fallback on context loss | Same pattern |
| Environment | `studio.hdr` (RGBE) sampled in the shader | Procedural studio computed in the shader |
| Thumbnails | One large texture array, images sized for it, preloaded for the nearest cards | Fixed pool of layers re-used as tiles enter and leave the viewport |
| Layout | Justified rows (rows balanced to one width, alternate rows offset by half a tile), on a pannable, zoomable canvas that wraps sideways | Justified rows in a normal scrolling page (sticky canvas); no offset, no wrap |
| Video | A hidden `<video>` per card near the view, frames copied into the texture with `requestVideoFrameCallback`, at most 8 (4 on touch) | Same |
| Audio | Waveform card, pulse redrawn every 50 ms for nearby cards | Same look and timing; peaks stored in the index (96 bars) |
| Playback with sound | Focused card opens a viewer with play, seek, time and mute | `MediaViewer` with the same controls |

**Alternatives considered.** Port the demo verbatim (licence unknown, minified, ties us to its data
model); CSS 3D only (cannot refract, so no glass look; kept as the fallback); three.js (a large
dependency for one instanced quad).

### 4B.4 Files

```
folder-search/browse.ts                          pure: which files, sorting, name/ext helpers (+ test)
entrypoints/sidepanel/components/FolderSearch/
├─ Browse.tsx                  BrowseView, FileTable, MediaWall (lightbox/viewer state, glass or CSS wall)
├─ MediaViewer.tsx             video/audio player with play, seek, time, mute
├─ SearchBar.tsx               bar, + menu, mic, camera dialog, paste/drop
├─ mediaQuery.ts               image downscale, base64, permission helpers
└─ glass/
   ├─ layout.ts                pure justified-rows layout (+ test)
   ├─ shaders.ts               GLSL ES 3.00 sources
   ├─ GlassRenderer.ts         WebGL2: program, instanced quad, texture pool, animation loop, uploadToTile
   ├─ WallMedia.ts             plays nearby videos into tiles, animates audio tiles, backfills metadata
   ├─ layerPool.ts             pure: texture-layer ownership, eviction and stale-load tokens (+ test)
   ├─ drawWaveform.ts          the audio card drawing (wall tile and viewer)
   └─ GlassWall.tsx            sticky canvas + button layer + labels; reports "unsupported" to use the CSS wall
folder-search/waveform.ts                        pure: peaks from samples, duration text (+ test; also used by the indexer)
folder-search/mediaMeta.ts                       panel-side waveform/duration read for files indexed earlier (+ test)
entrypoints/sidepanel/components/FolderSearch/focusTrap.ts   Tab trap for the lightbox and the viewer (+ test)
entrypoints/media-permission/  tab that requests camera/mic access
```

### 4B.5 Edge cases

- Zero or one item: the layout handles it; a lone tile is capped at 1.5× the target row height and left-aligned.
- Panel resized or zoom changed: the wrapper's `ResizeObserver` recomputes the rows, layout and canvas size.
  The renderer is told the new rectangles for the *same* tiles (`setLayout`), so loaded pictures, hover and
  playing videos survive dragging the panel edge. Only a different set of files (`setTiles`) resets the
  texture pool and restarts the previews.
- Very tall layouts: only the viewport slice is drawn; canvas height never exceeds the viewport, so it
  stays under GPU texture-size limits.
- Thumbnail missing (e.g. vision encoder was off): the tile is drawn as a neutral glass tile (grey
  through the glass) and stays clickable; it is not retried.
- The orbit moves outer tiles by up to about 30 px, which the canvas edge would clip,
  so the canvas is `GLASS_PAD` (32 px) wider than the layout on each side and shifted left by the same
  amount.
- **The file list refreshes many times during a rescan** (each progress event hands the UI a new array
  with the same files). The wall is keyed on the list's *content* (id, mtime, size), not the array's
  identity, and it keeps its last good layout while image sizes reload. Keyed on identity, it unmounted
  and rebuilt the GL context on every refresh, so textures never finished loading (grey tiles) and the
  wall flickered. A regression check refreshes a 3-image list every 30 ms and expects one GL context.
- The panel scrolls inside a `div` (`App.tsx`: `h-screen overflow-y-auto`), not the window, so the wall
  finds its nearest scrolling ancestor for the sticky canvas, the scroll offset and the viewport height.
  The offset is read from the canvas's own position inside the wrapper, so it stays correct
  wherever the sticky canvas currently sits.
- Context lost: the loop stops; on restore the pool is cleared and thumbnails are re-uploaded; if the
  context is not restored the CSS wall takes over.
- Rapid scroll: a layer is requested only for tiles near the viewport; stale decodes are discarded when
  the tile has left, so fast scrolling cannot fill the pool with off-screen images. Videos and audio
  animation follow the same "near the viewport" set, so a fast scroll starts and stops them quickly.
- A video that scrolls away keeps its last frame in the tile (the layer is not cleared) until the layer is
  re-used.
- Folder access lapsed, file moved, or an undecodable file: the tile keeps its poster; one console warning
  per file; no retry loop.

### 4B.6 Index fields for media cards

Additive, optional fields on `FileRecord` (no schema bump: records without them still load):

| Field | Set for | By |
| --- | --- | --- |
| `duration` (seconds) | audio, video | indexer (`decodeAudioWindows` / `videoSegments`) |
| `width`, `height` | video | indexer (`videoSegments` return value) |
| `waveform` (96 peaks, 0..1) | audio | indexer (`waveformPeaks` over the decoded windows) |

Files indexed before these existed have none of them. The wall fills them in the first time the file is
shown: a playing video reports its length and size from `loadedmetadata`, and an audio file is decoded
once at 12 kHz in the panel (one at a time) for its peaks and length. The values are shown at once and
saved with `patchFileMeta` (which drops undefined fields, so a partial result never blanks a stored value),
which only writes if the stored record is still the same file version
(`mtime`), so it cannot overwrite what the indexer just wrote. Videos indexed earlier take their tile
shape from the poster frame until their size is learned.

### 4B.7 Status and what is unverified

- Unit-tested: the layout (`layout.test.ts`), the texture-layer pool (`layerPool.test.ts`: free layers first,
  eviction order, never evicting a near tile, stale loads, retry rules), the media manager
  (`WallMedia.test.ts`, run under happy-dom with a fake renderer and fake files: the video limit and
  releasing, one metadata report per file, a released video's error not blocking the file, no retry loop for
  an unreadable file, pausing, audio animation and waveform backfill), waveform peaks and durations
  (`waveform.test.ts`), the file-selection/sorting and content key (`browse.test.ts`), the metadata
  patch filter (`mediaMeta.test.ts`) and the Tab trap (`focusTrap.test.ts`). Two of the `WallMedia` tests
  were confirmed to fail when their fix is removed.
- Not unit-testable here: the GL calls and the React components (no WebGL in node or happy-dom); these are
  covered by the manual headless-Chromium checks below.
- The shaders and renderer were checked by rendering a synthetic scene (24 and 300 gradient tiles) in
  headless Chromium with software GL (SwiftShader): the shaders compile and link, the glass look renders
  (bevel refraction, edge fringing, reflection, rim), a hovered tile lifts and tilts and is not clipped,
  scrolling through 300 tiles re-uses the texture pool correctly, and with WebGL disabled `create()`
  returns null with a logged reason so the CSS wall is used.
- The real React components (`BrowseView` → `GlassWall` → `GlassRenderer`) were also run in headless
  Chromium against a stand-in for the IndexedDB layer: textures load, the scene moves with the pointer
  (about 15,000 px differ between idle and a corner) and returns to rest when the pointer leaves, and a
  list refreshed every 30 ms keeps one GL context.
- Video and audio were run the same way with generated media (a real WebM recorded in the page, a WAV)
  read through the same code path as a real file: videos play into their tiles and the label shows a pause
  glyph; audio tiles animate; for files with no stored metadata the duration (`0:02`, `0:04`) and a 96-bar
  waveform are learned and saved; clicking a video or audio tile opens the viewer, which plays with sound
  and a moving time, pauses on the button, closes on Escape, and the wall's previews resume; the wall
  pauses its own previews while the viewer is open; the full-tab layout puts one row of equal-height
  tiles across the width; five rapid resizes create no new video element or GL context and both videos keep
  playing; Tab never leaves the open viewer; the Images, Audio & video and Documents chips show the right items; and with
  WebGL disabled the CSS wall renders video and audio cards.
- Not verified: a real GPU, the packed side panel itself (its real scroll container and CSS), thumbnails
  from a real index, H.264/AAC files (the test browser only had WebM), eight videos playing at once, the
  lapsed-permission path with a real folder handle, and behaviour while the model is indexing.
  The WebGL code has no automated test (no GL in unit tests); the headless render was a manual check.
- Frame time, GPU memory and the effect of concurrent indexing are **unmeasured**. Measure on a mid-range
  laptop with ~500 images before relying on the numbers above, and tune the pool size, the tile cap and
  the DPR cap from that.

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
- The tab-access policy engine (`accessListControl/`) is a **supported module** (§14.7). It decides
  whether a web page or host may be read; it does not apply to local folders. Folder Search does not
  call it today, because the extension reads no web pages. File content must never reach any
  web-facing component, and the only consumer of file excerpts is the user-invoked "Ask" mode.

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
- Results are opened through blob URLs, which belong to the extension's origin. Only inert types
  (PDF, text, images, audio/video) are opened in a tab; **HTML, XML and SVG are always saved as a
  download**, never rendered, so a hostile file in the folder cannot run script as the extension.

## 10. Performance targets (to validate)

| Item | Target |
| --- | --- |
| Query latency (≤20k vectors) | < 300 ms after models are warm |
| Cold start (models cached) | < 5 s to first query |
| Image indexing (WebGPU) | ≥ 5–10 img/s; CPU fallback acceptable but slow, with ETA shown |
| Doc indexing | ≥ 20 chunks/s on WebGPU |
| Memory | Bounded batches; no full-library arrays in memory besides vectors |
| Glass media wall | 60 fps while hovering/scrolling ~500 items with up to 8 videos playing on a mid-range laptop GPU; no GPU use when idle and nothing playing; texture memory ≤ ~52 MB (§4B.3) |

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

### 14.6 Product decisions (2026-10-18)

1. **Folder Search is the whole product.** There is no agent chat: the side panel renders Folder
   Search only. The Agent Library card, `ConfigPanel` row and `View` entry were removed.
2. **Welcome screen** keeps the promise, the three privacy points and the example chips. Its button
   reads "Set up (one-time N MB download)" and leads to model consent *before* any folder is
   picked. "Try a sample folder" is deferred (needs shipped sample data and an untested path).
3. **Demo Mode alert** is not restored: it warned about the agent chat's shared demo endpoint,
   which no longer applies.
4. **Offscreen bridge:** the call-audio, speech-to-text and decision APIs are gone, and the
   offscreen document is created with `WORKERS` only. The cold-start retry stays. The leftover
   `offscreen:audio:analyse` stub was removed from the offscreen router.
5. **Dead code removed.** The agent engine, widgets, history, tours, skills, memory, the legacy
   offscreen ML (e5 embeddings, vector search, UMAP/HDBSCAN, Pyodide), the hub, the content-access
   settings page, the content script, analytics, the demo LLM endpoint and the cloud LLM providers are
   gone, along with the tab, scripting, activeTab, alarms and host permissions they needed. The
   manifest now requests exactly `sidePanel`, `storage` and `offscreen`; the offscreen document
   uses the `WORKERS` reason only. Kept on purpose: `accessListControl` and `i18n` (§14.7).
6. **Ask mode is private-only.** It sends file excerpts to its LLM, so the only providers are a local
   OpenAI-compatible server or an in-browser WebLLM model. Cloud providers and any shared demo
   endpoint would contradict the "nothing leaves your device" promise and were removed. Previously
   saved cloud/demo settings are ignored on load, so Ask shows "choose a provider".

### 14.7 Kept, supported modules

Both are intentionally retained and maintained alongside Folder Search.

**`accessListControl/` (tab access policy engine).** A pure, fail-closed policy for "may the
extension read this web page or host?". Order: denylist → BLOCK; allowlist → ALLOW and skips page
heuristics (a deliberate carve-out, e.g. archive mirrors); otherwise any heuristic plugin
(`PasswordFieldPlugin`, `SensitiveFieldPlugin`, `KeywordPlugin`, which needs 2+ distinct terms) →
BLOCK; optional user-gesture gate; else ALLOW. It uses no Chrome APIs and needs no permission.
- Status: supported and unit-tested (`policy-engine.test.ts`), **not wired into the runtime**, since
  Folder Search reads no web pages. Any future feature that touches a web tab or host must call
  `PolicyEngine.evaluate()` first and treat BLOCK as final.
- Only add a host to `DEFAULT_ALLOWLIST` when the *page* is trusted, because allowlisting bypasses
  the heuristics.

**`i18n/` (interface language).** `I18nProvider` wraps the side panel, the full-tab page and the
Manage page. Languages: en-US (reference), de-DE, zh-CN, zh-HK. The language follows the browser
until the user picks one in **Manage → Interface language**; it is then stored as
`UnifiedSettings.uiLanguage`.
- Rules: new UI strings go through `t()` and must be added to **all four** locales (`locales.test.ts`
  fails if keys or `{{placeholders}}` differ). User data (file names, queries, snippets) is never
  translated.
- Status: the infrastructure and the language picker are live; only the picker's own strings are
  translated so far. Moving the remaining Folder Search strings behind `t()` is outstanding work.

### 14.4 Still unverified here

Nothing in this repo has executed the EmbeddingGemma calls in a real browser. In particular:

- the `max_soft_tokens` property on the image processor;
- the `RawVideo` path (`processor(null, null, null, [video])`) and the ~140 tokens/frame figure that
  keeps a 16-frame segment under the batch budget;
- decoding a video's soundtrack with `AudioContext.decodeAudioData` on the video file;
- the `probeWebGPU()` adapter check and WebGPU behaviour inside an offscreen document;
- the fp16 CPU path end to end (file names `*_fp16.onnx`, memory use, the one-image-per-call rule).

The nesting rules for audio and video were checked against the library source, not by running them.
- the glass media wall (including video playing into tiles) on a real GPU, in the side panel, and alongside indexing (§4B.7); the
  query-by-image and query-by-audio paths (§4B.2); and the camera/microphone permission flow
  (`media-permission.html`).

## References
https://tpiros.dev/blog/embeddinggemma-2-in-the-browser/

Running it in a browser tab
The ONNX export lives at onnx-community/embeddinggemma-2-ONNX, and Transformers.js 4.3.1 knows the embedding_gemma2 architecture out of the box.
We already do this, and the code even cites that article. Here is how each point from the post shows up in our code.

**What we already do, in [gemma-embeddings.ts](packages/extension/src/browser-ml/gemma-embeddings.ts):**
- **Model:** It loads the ONNX export `onnx-community/embeddinggemma-2-ONNX` (`GEMMA_MODEL_ID`).
- **Transformers.js version:** The lockfile resolves `@huggingface/transformers` to 4.3.1 (installed in `node_modules`), the version the post uses. `package.json` says `^4.2.0`, so a fresh install picks up the same release. You could raise the floor to `^4.3.1` to pin it.
- **No pipeline:** It uses `AutoConfig`, `AutoProcessor` and `AutoModel` directly, not `feature-extraction`, so a skipped encoder is never downloaded.
- **Encoder skipping:** Lines 165–166 set `config.vision_config = null` and `config.audio_config = null` when those encoders aren't selected. That is the same trick, and it is how the consent screen's checkboxes become real download savings.
- **Per-component dtype:** The `dtype: { model, vision_encoder, audio_encoder }` object is built at lines 176–181, and audio is always q8, as in the post.

**Gotchas from the post that the code also handles:**
- **Flat versus nested image lists:** It wraps each image in its own list (`.map(img => [img])`), so a batch doesn't blend into one vector.
- **WASM memory:** It embeds one image per call on WASM, citing the same post.
- **Re-normalizing:** Truncated vectors are re-normalized in `truncateAndNormalize`.
- **Token limit per batch:** Image batch size is limited (`IMAGE_BATCH`, `IMAGE_SOFT_TOKENS`) to stay under the WebGPU dispatch limit. I didn't check the exact numbers.
- **Local runtime files:** ONNX Runtime files are served from `public/ort/`, not jsDelivr.
- **Audio decoding:** `AudioContext` use is in [media.ts](packages/extension/src/folder-search/extractors/media.ts), which runs only in the offscreen document.

**Two checks I haven't done:**
- **The WASM fallback problem:** The post says q4 and q8 failed on WASM with a missing `GatherBlockQuantized` kernel, and that it fell back to fp16, roughly doubling the download to about 1.2 GB. My search for `componentDtype` returned nothing, so I haven't confirmed how our code picks dtype on the WASM path. If it keeps q4 or q8 there, users without WebGPU could hit a load failure. That would be a real bug. The consent screen's "slower WASM path" warning also wouldn't mention the larger download. I can check `componentDtype` and test the WASM path next.
- **Batch limits:** I haven't compared our token-limit numbers with the ~2,700 figure. The code comments suggest it is handled, but I haven't verified it.


https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/
Embed Text and Code with Task Prompts
EmbeddingGemma 2 is trained with short task instructions to steer representations for specific tasks. Set prompt_name in encode() to add it for you:
| Use for         | prompt_name          | Prefix it adds                         |
| --------------- | -------------------- | -------------------------------------- |
| Search queries  | `SearchQuery`        | `task: search result \\| query:`       |
| Questions       | `QuestionAnswering`  | `task: question answering \\| query:`  |
| Claims to check | `FactChecking`       | `task: fact checking \\| query:`       |
| Code queries    | `CodeRetrieval`      | `task: code retrieval \\| query:`      |
| Documents       | `Document`           | `title: none \\| text:`                |
| Classification  | `Classification`     | `task: classification \\| query:`      |
| Clustering      | `Clustering`         | `task: clustering \\| query:`          |
| Similarity      | `SentenceSimilarity` | `task: sentence similarity \\| query:` |

Each example below is the full string the model would see. The prefixes come from your table and the ONNX model card. The ideas for applying them in Folder Search are my suggestions. None are tested, and I haven't measured whether they beat plain `SearchQuery`.

**Asymmetric tasks (query side).** Only the query gets the prefix. Documents still use `title: … | text: …`.

| Prefix | Example input | When it makes sense here |
| --- | --- | --- |
| `SearchQuery` | `task: search result \| query: beach sunset with dog` | The default for the search box. Already in use. |
| `QuestionAnswering` | `task: question answering \| query: When does the Acme contract expire?` | Ask mode, or when the box text is clearly a question. The answer sits inside a passage, so this fits better than keyword-style search. |
| `FactChecking` | `task: fact checking \| query: The Q3 budget was approved in September` | Finding the passage that confirms or contradicts a statement. A possible "verify this claim against my files" feature. It isn't part of search today. |
| `CodeRetrieval` | `task: code retrieval \| query: function that parses ISO dates` | Only if code files are indexed, which the plan defers to opt-in. Use it on code queries only. |

**Symmetric tasks.** Per the card, every input gets the same prefix, so there is no query/document split.

| Prefix | Example input | When it makes sense here |
| --- | --- | --- |
| `SentenceSimilarity` | `task: sentence similarity \| query: Invoice from Acme, March` | Comparing two pieces of text for sameness, such as finding near-duplicate documents or "more like this document". |
| `Clustering` | `task: clustering \| query: <chunk text>` | Grouping files by topic, for example auto-folders or a topic map in Browse. Both sides get the same prefix. |
| `Classification` | `task: classification \| query: <text>` | Assigning a file to a label such as "invoice", "receipt" or "contract", for example to feed a filter chip. |

**Prefixes apply to text only.** Images, audio and video never get one.
- **Find similar for images:** It compares one image's vector to other images with no text involved, so no prefix is involved either.
- **Text query to images:** The query still uses `SearchQuery`.
- **Documents for clustering or classification:** If you do either on documents, embed them with the symmetric prefix as separate vectors. Don't reuse the search-index vectors, because the prefix changes the vector.

**Practical points:**
- **Prefixes can't be mixed.** A vector built with one prefix isn't comparable to one built with another. Don't switch the prefix on an existing index. Changing how documents are embedded would need a re-index. The index signature currently records model, dtype, dimension and schema version. If document prefixes ever change, bump the schema version.
- **Only query-side prefixes are cheap to add.** Using `QuestionAnswering` for question-style queries, or `CodeRetrieval` for code, only changes the query vector, so no re-index is needed.
- **The question-vs-search switch needs a rule.** The prefix has to be chosen before embedding. Ask mode knows it's a question. For the plain search box I would not guess automatically without testing, because a wrong guess lowers recall.
- **Not worth it for now:** Folder search is an asymmetric retrieval task, so `SearchQuery` plus `Document` is the right pair. `QuestionAnswering` for Ask mode is the only extra I'd test first. The symmetric ones only matter if you build deduplication, topic grouping or auto-labels.

We don't use sentence-transformers. The extension uses **transformers.js**, the `@huggingface/transformers` npm package, version `^4.2.0` ([package.json:40](packages/extension/package.json#L40)).

**What each library is:**
- **sentence-transformers** is the Python library you linked. It runs on PyTorch in a Python process and has the `encode(prompt_name=…)` helper. It can't run inside a Chrome extension.
- **transformers.js** is the JavaScript port of Hugging Face Transformers. It runs ONNX models in the browser through ONNX Runtime Web, on WebGPU or WASM. It's what the reference space uses.

**How we use it** ([gemma-embeddings.ts](packages/extension/src/browser-ml/gemma-embeddings.ts)):
- **Model:** It loads `onnx-community/embeddinggemma-2-ONNX`.
- **Loading:** It loads the config, tokenizer, processor and model with `AutoConfig`, `AutoTokenizer`, `AutoProcessor` and `AutoModel`. The processor is loaded only when the image or audio encoders are wanted.
- **Text:** It tokenizes the prefixed strings and runs the model.
- **Media:** Images, audio and video go through `processor(...)`.
- **Truncation:** Vectors are shortened and normalized by our own `truncateAndNormalize`, not by the library.

Because there is no `encode()` helper, the task prefixes, truncation and normalization are hand-written in our code. That matches what I said about prefixes in my last answer.

**Other libraries in the stack:**
- **Local ONNX runtime:** ONNX Runtime files are served from the extension's own `public/ort/` folder, because the extension's security policy blocks the library's default CDN loading.
- **PDFs:** pdf.js (`pdfjs-dist ^5.7`).

https://www.mindstudio.ai/blog/run-embeddinggemma-2-locally 

**The extension already uses 256.** [settings.ts:5](packages/extension/src/folder-search/settings.ts#L5) sets `DEFAULT_DIM = 256`, and nothing in the folder-search code overrides it. I'd keep 256.

**How it works now:**
- **Truncation:** The model produces 768 numbers per item. `truncateAndNormalize` in [ranking.ts:102](packages/extension/src/folder-search/ranking.ts#L102) keeps the first 256 and rescales them to unit length. The rescale matters for dot-product search, and the article doesn't cover it.
- **Settings:** The dimension is a setting (128, 256, 512 or 768). It is stored in the index signature, so changing it makes the app ask for a re-index.

**What the article supports:**
- **768 to 256:** Storage drops about 3×. In its image test, all six matches stayed identical after truncating to 256.
- **256 to 128:** Google's table shows quality dropping off, especially for image, video and audio.
- **What it doesn't give:** It only tested that one reduction on a small set. It reports no 512 results, no speed figures and no exact quality-loss numbers. So it supports 256 as a sensible default but doesn't prove it.

**Why I'd stay at 256:**
- **Storage:** A 20,000-item index is about 20 MB of vectors at 256 and about 61 MB at 768. That is raw vector size only, before IndexedDB overhead.
- **Search cost:** The search loop scans every stored vector, and its work scales directly with the dimension. At 256 it does a third of the work of 768. I haven't measured the speed.
- **Video indexing:** Video indexing stores the most vectors, so it benefits most from the smaller size.
- **Why not 128:** The article specifically warns against 128 for images, video and audio.
