# Extension Behavioral Guidelines

Rules the extension follows so its store listing matches what the code does. Violating one is a
design change: update this file and the design doc (`designLocalFolderSearch.md`) first.

## 1. Minimal permissions, no web access

The manifest requests exactly `sidePanel`, `storage` and `offscreen`.

- No `host_permissions` or `optional_host_permissions`, no `tabs`/`scripting`/`activeTab`, no
  content scripts, no `externally_connectable`. Folder Search never reads a web page, and reading
  the user's folder needs no permission (File System Access API, read-only).
- `chrome.tabs.create` is used only to open the extension's own pages, result files, and (§5) the
  Chrome Web Store listing; that needs no permission.
- Adding a permission needs a one-line justification that can go verbatim into the store's
  privacy-practices form.

## 2. No dynamic code execution

No `new Function`, `eval`, remote scripts or remotely hosted code. Everything that runs is bundled
into the extension. Consequences already handled:

- ONNX Runtime and the pdf.js worker are shipped locally (`public/ort/`, the bundled worker). The
  default CDN and `blob:` loading in transformers.js is blocked by the CSP, so it is disabled.
- Opened results are blob URLs on the extension's origin. Only inert types (PDF, text, images,
  audio/video) are opened; HTML, XML and SVG are always saved as a download (design doc §9).

## 3. Private by construction

- Files, text, thumbnails and vectors never leave the device. The only outbound traffic is the
  user-approved model download and, if the user chooses to send it, the text of the feedback form
  (§5). Nothing is sent automatically.
- No analytics, telemetry, uninstall pings or remote configuration.
- The optional Ask mode may only use a local server or an in-browser model; there is no cloud
  provider and no shared demo endpoint.
- Secrets and credential files are skipped by default (`classify.ts`), and every skipped or failed
  file is listed in the UI rather than hidden.

## 4. The listing matches the behavior

Store text, `PRIVACY.md` and the welcome screen must say what the code does: local-only processing,
read-only access to one chosen folder, a one-time model download, and WebGPU required with an
opt-in CPU fallback. It also says that an optional feedback form exists and what it sends.

## 5. Review prompt and feedback form

A one-time-per-milestone "Enjoying Folder Search?" popup asks for a star rating. It is local-only
until the user submits feedback.

### When it appears

- Only **side panel opens** count (one per side panel mount, guarded against the StrictMode double
  effect). The full-tab view and the Manage page do not count.
- The popup is shown on the **5th open**. It does not wait for an indexed folder or a search: five
  deliberate opens are enough signal.
- **"Maybe later"** (or the X) snoozes: ask again after **10 more opens**. At most **5 re-asks**
  follow the first ask (opens 5, 15, 25, 35, 45, 55), then never again.
- Clicking a star or submitting feedback sets the state to `done`: **never ask again**.

### State

One key in `chrome.storage.local` via `shared/storageAdapter.ts`:
`{ opens: number, nextAskAt: number, asks: number, status: 'pending' | 'done' }`. It holds counters
only and is never sent anywhere. The decision logic (`applyOpen`, `registerOpen`, `markReviewDone`)
lives in a pure, unit-tested module (`shared/reviewPrompt.ts`) with the storage injected. The popup
(`sidepanel/components/ReviewPrompt.tsx`) is rendered by the side panel `App.tsx`; all strings go
through `t()` in all four locales.

Showing the popup is recorded immediately and pushes `nextAskAt` back by 10 opens, so dismissing it
(X, Escape, "Maybe later", closing the panel) is already the snooze and needs no further write. Only
a star click writes `done`. A corrupt stored value restarts the count instead of throwing.

### Where a star goes

- **4 to 5 stars** open the Chrome Web Store review page in a new tab (`chrome.tabs.create`), built
  from the store ID.
- **1 to 3 stars** open the in-extension feedback page (`entrypoints/feedback/`) in a new tab.
- Either way the state becomes `done`.
- Review: sending only happy users to the store is discouraged by store policy. If that is a
  concern, send every rating to the store and offer the feedback page as a secondary link.

### Configuration, nothing hardcoded

The store ID and the form identifiers are read from the env file (WXT exposes `WXT_`/`VITE_`
variables), not from source:

- `WXT_REVIEW_PROMPT_ENABLED`: feature flag, **off for the first release** (`false` in
  `.env.example`). Only the exact value `true` enables it; unset or anything else means off, so a
  build without an env file ships without the prompt. While off the popup never shows and opens are
  not counted, so turning it on later starts every user from zero.
- `WXT_STORE_EXTENSION_ID`: the review URL is
  `https://chromewebstore.google.com/detail/<id>/reviews`. Only the ID is stored, not the slug.
  **Temporary:** until the extension is published, the config module falls back to
  `hkknnlcdijjfcloilldhnbibjkakfmpo` (the ID supplied for development; its listing slug is
  `flightpulse`). After publishing, set the real ID in the env file and delete the fallback.
  `.env*` files are git-ignored except `.env.example`, which is committed and holds the form
  values; copy it to `.env`. The store ID in it stays empty until publishing.
- `WXT_FEEDBACK_FORM_ID` and `WXT_FEEDBACK_FORM_ENTRY_*`: the Google Form id and its `entry.<n>`
  field ids.
- If a form value is missing the popup is **not shown** and does not consume an ask (the page logs
  a console warning) rather than linking to a wrong place.

### Feedback page

A static extension page (`entrypoints/feedback/`) that looks like the Share-your-feedback form:
Name (required), Email (optional, validated), Message (required), Submit.

- **Extension Used** is filled automatically from the query string. The popup opens
  `feedback.html?ext=<friendly name>`, where the friendly name is the constant `Folder Search`
  (`shared/extensionName.ts`; the manifest `extName` message is the package name, not the product name). The page reads `ext`, shows it as a read-only line, and
  submits it in the form's "Extension Used:" short-answer field. If `ext` is missing it falls back
  to the manifest name, so the field is never empty. The user does not type it.

- **Submission**: `fetch(POST, mode: 'no-cors')` to
  `https://docs.google.com/forms/d/e/<id>/formResponse`, body `application/x-www-form-urlencoded`.
  The response is opaque, so the UI cannot confirm delivery; it shows "Thanks" after the request
  resolves and an actionable error if the request itself fails (offline, blocked).
- **No reCAPTCHA.** It loads remote script, which MV3 and §2 forbid. Spam protection is a hidden
  honeypot field (a filled one gets a fake "Thanks" and nothing is sent) plus a 2 s minimum
  time-on-page check (an error asks the user to submit again); Google Forms also rate-limits.
- **No new permissions.** A cross-origin `no-cors` POST needs no `host_permissions`. The manifest
  CSP sets no `connect-src`, so `wxt.config.js` does not change; adding one later must also allow
  `https://docs.google.com` here and the model download host.
- The page states before the Submit button exactly what is sent (the typed fields and the extension
  name) and that nothing else is collected.

### Google Form requirements

- Questions: **Extension Used:** (short answer, required; auto-filled from the query string, see
  above), Enter Your Name (short, required), Enter Your Email (short, optional, email-validated),
  YOUR FEEDBACK (paragraph, required). There is no Version question, so the version is not sent.
- The form as configured: no sign-in required, not limited to one response, "Collect email
  addresses" set to **Do not collect**. Keep it accepting responses.
- Email is optional in the published form but validated when present (a malformed address makes
  Google reject the submission silently under `no-cors`), so the page validates it as an email
  when filled and may leave it empty. Name, Extension Used and Feedback are required.
- Publishing: in Google Forms choose **Publish**, then copy the responder link it shows
  (`.../forms/d/e/<id>/viewform`). **Do not shorten it** (no `forms.gle`): the full `/d/e/<id>/`
  id is required to build the `formResponse` URL.
- Published form (do not shorten the link; the full `/d/e/<id>/` id is needed for `formResponse`):
  `https://docs.google.com/forms/d/e/1FAIpQLSdvknhi5MTc7qq7tR9XIawN5-mMasOxze4w2GRxEPSgeeJdBg/formResponse`
- Field ids (read from the published form):

  | Question         | Field name        |
  | ---------------- | ----------------- |
  | Extension Used:  | `entry.776165306` |
  | Enter Your Name  | `entry.1884265043` |
  | Enter Your Email | `entry.880462966` |
  | YOUR FEEDBACK    | `entry.768003692` |

  They go in the env file, not in source. If a question is deleted and re-created in the form,
  its id changes and the env value must be updated.
