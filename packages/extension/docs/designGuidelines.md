# Extension Behavioral Guidelines

Rules the extension follows so its store listing matches what the code does. Violating one is a
design change: update this file and the design doc (`designLocalFolderSearch.md`) first.

## 1. Minimal permissions, no web access

The manifest requests exactly `sidePanel`, `storage` and `offscreen`.

- No `host_permissions` or `optional_host_permissions`, no `tabs`/`scripting`/`activeTab`, no
  content scripts, no `externally_connectable`. Folder Search never reads a web page, and reading
  the user's folder needs no permission (File System Access API, read-only).
- `chrome.tabs.create` is used only to open the extension's own pages and result files; that needs
  no permission.
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
  user-approved model download.
- No analytics, telemetry, uninstall pings or remote configuration.
- The optional Ask mode may only use a local server or an in-browser model; there is no cloud
  provider and no shared demo endpoint.
- Secrets and credential files are skipped by default (`classify.ts`), and every skipped or failed
  file is listed in the UI rather than hidden.

## 4. The listing matches the behavior

Store text, `PRIVACY.md` and the welcome screen must say what the code does: local-only processing,
read-only access to one chosen folder, a one-time model download, and WebGPU required with an
opt-in CPU fallback.
