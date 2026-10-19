# Privacy

> Draft for review: this describes what the code does today. Have it reviewed before publishing
> it as a store privacy policy.

**Folder Search processes the folder you choose entirely on your device.**

- **Your files.** Contents, text, thumbnails and search vectors are stored in this browser's local
  storage (IndexedDB) and never leave your computer. The extension has read-only access to the one
  folder you pick and never modifies, uploads or shares it. Removing a folder in Manage deletes its
  index, thumbnails and saved access; your original files are never touched.
- **The model download.** The first time you set up, the search model files are downloaded from
  huggingface.co after you approve it. Your files and queries are not part of that request.
- **Optional "Answer from these files".** If you turn this on, excerpts of matching files are sent
  to the AI model you configured, which can only be a server on your own computer or a model
  running inside the browser. No cloud AI provider is built in.
- **No tracking.** No analytics, advertising identifiers, crash reporting or remote configuration.
  The extension requests no access to websites, tabs or browsing history.
- **Permissions used:** `sidePanel` (the panel), `storage` (settings), `offscreen` (runs the model
  without blocking the UI).
