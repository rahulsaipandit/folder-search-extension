// ===================================================================
// Environment-Agnostic Key-Value Storage Adapter
// ===================================================================
// Abstracts persistent key-value storage so the same settings/memory
// code runs in:
//   - Chrome extensions  (chrome.storage.local)
//   - Edge extensions    (chrome.storage.local - Chromium-compatible)
//   - Firefox extensions (browser.storage.local via WebExtensions API)
//   - Plain web pages    (window.localStorage)
//
// To add a new environment:
//   1. Implement the `KVStore` interface below.
//   2. Register it in `detectStore()` or call `setStorageAdapter()` at
//      extension/app startup before any settings calls are made.
// ===================================================================

/** Minimal async key-value contract every adapter must satisfy. */
export interface KVStore {
  /**
   * Retrieve the value stored under `key`.
   * Returns `undefined` if the key does not exist.
   */
  get(key: string): Promise<unknown>

  /** Persist `value` under `key`, overwriting any existing value. */
  set(key: string, value: unknown): Promise<void>

  /** Remove `key` and its value. No-op if the key does not exist. */
  remove(key: string): Promise<void>

  /** Remove all keys managed by this store. */
  clear(): Promise<void>
}

// ─── Chrome / Edge extension adapter ─────────────────────────────────────────
//
// Both Chrome and Chromium-based Edge expose the `chrome.*` namespace.
// No special handling needed for Edge.

export class ChromeStorageAdapter implements KVStore {
  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key)
    return result[key]
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  }

  async clear(): Promise<void> {
    await chrome.storage.local.clear()
  }
}

// ─── Firefox / Safari extension adapter ──────────────────────────────────────
//
// Firefox WebExtensions expose `browser.storage.local` (Promise-based).
// Safari 14+ also supports `browser.*` via the Web Extension API polyfill.
// If the environment only ships the `browser` global (not `chrome`), use this.

export class BrowserStorageAdapter implements KVStore {
  // `browser` is declared as `any` because TypeScript's `@types/webextension-polyfill`
  // is an optional dev dependency. Cast at call site as needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly api = (globalThis as any).browser?.storage?.local

  async get(key: string): Promise<unknown> {
    const result = await this.api.get(key)
    return result[key]
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.api.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await this.api.remove(key)
  }

  async clear(): Promise<void> {
    await this.api.clear()
  }
}

// ─── Plain-web / content-script adapter ──────────────────────────────────────
//
// Falls back to `window.localStorage` for regular web pages and content
// scripts that do not have access to the extension storage APIs.
// Values are JSON-serialized; non-serializable values will throw.

export class LocalStorageAdapter implements KVStore {
  constructor(private readonly prefix = "pageAgent:") {}

  async get(key: string): Promise<unknown> {
    const raw = localStorage.getItem(this.prefix + key)
    if (raw === null) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(value))
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key)
  }

  async clear(): Promise<void> {
    const prefix = this.prefix
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => localStorage.removeItem(k))
  }
}

// ─── Runtime detection & singleton ───────────────────────────────────────────

function detectStore(): KVStore {
  // Chrome or Chromium-Edge: `chrome.storage` present
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return new ChromeStorageAdapter()
  }

  // Firefox / Safari WebExtension: `browser.storage` present but not `chrome`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).browser !== "undefined" && (globalThis as any).browser?.storage?.local) {
    return new BrowserStorageAdapter()
  }

  // Plain web page or content-script without storage permission
  return new LocalStorageAdapter()
}

let _adapter: KVStore = detectStore()

/**
 * Override the active storage adapter.
 * Call this once at startup (e.g. in the service worker / background script)
 * before any settings are read or written.
 *
 * @example
 * // Force localStorage in a unit test:
 * setStorageAdapter(new LocalStorageAdapter("test:"))
 */
export function setStorageAdapter(adapter: KVStore): void {
  _adapter = adapter
}

/** Returns the active storage adapter (auto-detected or overridden). */
export function getStorageAdapter(): KVStore {
  return _adapter
}
