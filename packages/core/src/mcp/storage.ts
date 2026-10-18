/**
 * MCPStorage - cross-platform persistent storage for MCP server configs and tokens.
 *
 * Strategy:
 *   - Browser: IndexedDB via the `idb` library (async, structured, no size limits).
 *   - React Native: AsyncStorage (via dynamic import so web bundles don't break).
 *   - Fallback (SSR / Node test): in-memory Map (non-persistent, logs a warning).
 *
 * Security principle of least privilege:
 *   - Server configs (url, label, transport settings) are stored separately from tokens.
 *   - Bearer tokens and OAuth credentials live in the `tokens` store only.
 *   - Deleting a server atomically removes its config AND its token in one transaction
 *     (no orphaned credentials).
 *
 * DB: 'page-agent-mcp'
 * Stores:
 *   - 'servers': Record<serverId, MCPServerConfig>  (no token fields)
 *   - 'tokens':  Record<serverId, string>           (bearer token only)
 */

import type { MCPServerConfig } from './types'

// ── DB constants ──────────────────────────────────────────────────────────────
const DB_NAME = 'page-agent-mcp'
const DB_VERSION = 1
const STORE_SERVERS = 'servers'
const STORE_TOKENS = 'tokens'

// ── idb lazy import ───────────────────────────────────────────────────────────
// Dynamic to keep React Native bundles free of idb (which assumes browser APIs).
type IDBPDatabase = import('idb').IDBPDatabase<unknown>
let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase | null> {
  if (_db) return _db

  // Skip IndexedDB in non-browser environments
  if (typeof indexedDB === 'undefined') {
    console.warn('[MCPStorage] IndexedDB not available - using in-memory fallback')
    return null
  }

  try {
    const { openDB } = await import('idb')
    _db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SERVERS)) {
          db.createObjectStore(STORE_SERVERS)
        }
        if (!db.objectStoreNames.contains(STORE_TOKENS)) {
          db.createObjectStore(STORE_TOKENS)
        }
      },
    })
    return _db
  } catch (err) {
    console.warn('[MCPStorage] failed to open IndexedDB:', err)
    return null
  }
}

// ── In-memory fallback (React Native / SSR) ───────────────────────────────────
const _memServers = new Map<string, MCPServerConfig>()
const _memTokens = new Map<string, string>()

// ─────────────────────────────────────────────────────────────────────────────
// Server config operations
// ─────────────────────────────────────────────────────────────────────────────

/** Persist a server config (without its token). */
export async function saveServer(config: MCPServerConfig): Promise<void> {
  const db = await getDB()
  if (db) {
    await db.put(STORE_SERVERS, config, config.id)
  } else {
    _memServers.set(config.id, config)
  }
}

/** Load all persisted server configs. */
export async function loadServers(): Promise<MCPServerConfig[]> {
  const db = await getDB()
  if (db) {
    return (await db.getAll(STORE_SERVERS)) as MCPServerConfig[]
  }
  return [..._memServers.values()]
}

/** Load a single server config by ID. Returns undefined if not found. */
export async function loadServer(id: string): Promise<MCPServerConfig | undefined> {
  const db = await getDB()
  if (db) {
    return (await db.get(STORE_SERVERS, id)) as MCPServerConfig | undefined
  }
  return _memServers.get(id)
}

/** Update just the transport type on an existing server config. */
export async function updateServerTransport(
  id: string,
  transport: MCPServerConfig['transport']
): Promise<void> {
  const config = await loadServer(id)
  if (config) {
    await saveServer({ ...config, transport })
  }
}

/**
 * Delete a server config AND its token in a single atomic transaction.
 * This prevents orphaned credentials when a server is removed.
 */
export async function deleteServer(id: string): Promise<void> {
  const db = await getDB()
  if (db) {
    const tx = db.transaction([STORE_SERVERS, STORE_TOKENS], 'readwrite')
    await Promise.all([
      tx.objectStore(STORE_SERVERS).delete(id),
      tx.objectStore(STORE_TOKENS).delete(id),
      tx.done,
    ])
  } else {
    _memServers.delete(id)
    _memTokens.delete(id)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token operations (separated for security)
// ─────────────────────────────────────────────────────────────────────────────

/** Persist a bearer token for a server. */
export async function saveToken(serverId: string, token: string): Promise<void> {
  const db = await getDB()
  if (db) {
    await db.put(STORE_TOKENS, token, serverId)
  } else {
    _memTokens.set(serverId, token)
  }
}

/** Load a bearer token for a server. Returns null if none stored. */
export async function loadToken(serverId: string): Promise<string | null> {
  const db = await getDB()
  if (db) {
    return ((await db.get(STORE_TOKENS, serverId)) as string | undefined) ?? null
  }
  return _memTokens.get(serverId) ?? null
}

/** Remove a token without deleting the server config. */
export async function deleteToken(serverId: string): Promise<void> {
  const db = await getDB()
  if (db) {
    await db.delete(STORE_TOKENS, serverId)
  } else {
    _memTokens.delete(serverId)
  }
}

/** Returns true if a token exists for the given server. */
export async function hasToken(serverId: string): Promise<boolean> {
  return (await loadToken(serverId)) !== null
}

// ─────────────────────────────────────────────────────────────────────────────
// React Native AsyncStorage adapter (mobile-only, gracefully absent on web)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize React Native AsyncStorage as the storage backend.
 * Call this once at app startup on mobile before any other storage operation.
 * Web clients don't need to call this (IndexedDB is used automatically).
 *
 * @example
 *   import AsyncStorage from '@react-native-async-storage/async-storage'
 *   initAsyncStorage(AsyncStorage)
 */
export function initAsyncStorage(asyncStorage: {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys(): Promise<readonly string[]>
}): void {
  // Monkey-patch the four exported functions to use AsyncStorage
  const PREFIX_S = 'mcp_server_'
  const PREFIX_T = 'mcp_token_'

  ;(saveServer as unknown as (c: MCPServerConfig) => Promise<void>) = async (config) => {
    await asyncStorage.setItem(PREFIX_S + config.id, JSON.stringify(config))
  }

  ;(loadServers as unknown as () => Promise<MCPServerConfig[]>) = async () => {
    const keys = await asyncStorage.getAllKeys()
    const serverKeys = keys.filter((k) => k.startsWith(PREFIX_S))
    const items = await Promise.all(serverKeys.map((k) => asyncStorage.getItem(k)))
    return items
      .filter(Boolean)
      .map((v) => JSON.parse(v!) as MCPServerConfig)
  }

  ;(loadServer as unknown as (id: string) => Promise<MCPServerConfig | undefined>) = async (id) => {
    const v = await asyncStorage.getItem(PREFIX_S + id)
    return v ? (JSON.parse(v) as MCPServerConfig) : undefined
  }

  ;(deleteServer as unknown as (id: string) => Promise<void>) = async (id) => {
    await asyncStorage.removeItem(PREFIX_S + id)
    await asyncStorage.removeItem(PREFIX_T + id)
  }

  ;(saveToken as unknown as (id: string, t: string) => Promise<void>) = async (id, t) => {
    await asyncStorage.setItem(PREFIX_T + id, t)
  }

  ;(loadToken as unknown as (id: string) => Promise<string | null>) = async (id) => {
    return asyncStorage.getItem(PREFIX_T + id)
  }

  ;(deleteToken as unknown as (id: string) => Promise<void>) = async (id) => {
    await asyncStorage.removeItem(PREFIX_T + id)
  }
}
