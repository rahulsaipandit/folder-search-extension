/**
 * MCPRegistry - singleton that owns all active MCP sessions.
 *
 * Responsibilities:
 *   - Instantiate transports (auto-detect or explicit) per MCPServerConfig.
 *   - Connect / disconnect sessions with graceful error isolation.
 *   - Provide a flat list of resolved tools across all ready sessions.
 *   - Per-run tool cache (Nemilia pattern): hash sessions → pre-built tool list
 *     so repeated calls within the same agent turn don't re-enumerate.
 *   - Subscribe to status changes for UI reactivity.
 *
 * Transport selection logic for 'auto' mode:
 *   1. Try Streamable HTTP: POST initialize, check protocolVersion in result.
 *      Cache Mcp-Session-Id if present.
 *   2. Try SSE: GET with Accept: text/event-stream, wait for endpoint event.
 *   3. Fallback: plain HTTP (no persistent connection, each call is stateless).
 *
 * DATA CONSUMER direction only. No Node.js APIs.
 */

import { MCPSession } from './session/MCPSession'
import { SSETransport } from './transport/SSETransport'
import { StreamableHTTPTransport } from './transport/StreamableHTTPTransport'
import { OAuth2PKCEProvider } from './auth/OAuth2PKCEProvider'
import * as storage from './storage'
import type {
  MCPServerConfig,
  MCPSessionStatus,
  MCPStatusMap,
  ResolvedTool,
  RemoteTransportType,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Transport auto-detection (adapted from packages/website/src/lib/mcp/transport.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-URL detected transport cache - survives for the lifetime of the registry. */
const _detectedTransport = new Map<string, 'streamable-http' | 'sse'>()

async function detectTransport(
  url: string,
  headers: Record<string, string>
): Promise<'streamable-http' | 'sse'> {
  const cached = _detectedTransport.get(url)
  if (cached) return cached

  // ── 1. Try Streamable HTTP ────────────────────────────────────────────────
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'PageAgent', version: '1.0' },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>
      if ((data?.result as Record<string, unknown>)?.protocolVersion) {
        _detectedTransport.set(url, 'streamable-http')
        return 'streamable-http'
      }
    }
  } catch { /* fall through */ }

  // ── 2. Try SSE ────────────────────────────────────────────────────────────
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...headers },
      signal: AbortSignal.timeout(4_000),
    })
    if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) {
      _detectedTransport.set(url, 'sse')
      return 'sse'
    }
  } catch { /* fall through */ }

  // Default to SSE (most broadly compatible)
  _detectedTransport.set(url, 'sse')
  return 'sse'
}

// ─────────────────────────────────────────────────────────────────────────────
// MCPRegistry
// ─────────────────────────────────────────────────────────────────────────────

type StatusListener = (statuses: MCPStatusMap) => void

export class MCPRegistry {
  private readonly _sessions = new Map<string, MCPSession>()
  private readonly _configs = new Map<string, MCPServerConfig>()
  private _statusListeners: StatusListener[] = []

  // Nemilia-style per-run tool cache: session-hash → resolved tools
  private _toolCache: ResolvedTool[] | null = null
  private _toolCacheKey = ''

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Connect to all enabled servers.
   * Failures are isolated per-server (graceful degradation).
   * Loads tokens from storage before connecting.
   */
  async initialize(configs: MCPServerConfig[]): Promise<void> {
    await Promise.allSettled(
      configs.filter((c) => c.enabled).map((c) => this.addServer(c))
    )
  }

  /**
   * Load server configs from persistent storage and connect to all enabled ones.
   * Call this at app startup to restore the previous session.
   */
  async loadAndConnect(): Promise<void> {
    const configs = await storage.loadServers()
    await this.initialize(configs)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Server management
  // ─────────────────────────────────────────────────────────────────────────

  async addServer(config: MCPServerConfig): Promise<void> {
    // Resolve token from storage if not already in headers
    let resolvedConfig = config
    const storedToken = await storage.loadToken(config.id)
    if (storedToken && !this._hasAuthHeader(config.headers)) {
      resolvedConfig = {
        ...config,
        headers: { ...config.headers, Authorization: `Bearer ${storedToken}` },
      }
    }

    // Resolve 'auto' transport
    let transport = resolvedConfig.transport as RemoteTransportType
    if (transport === 'auto') {
      transport = await detectTransport(resolvedConfig.url, resolvedConfig.headers ?? {})
      // Cache detected transport back to storage
      await storage.updateServerTransport(config.id, transport)
    }

    const mcpTransport = this._createTransport({ ...resolvedConfig, transport })
    const session = new MCPSession(mcpTransport, resolvedConfig)

    session.onStatusChange(() => {
      this._invalidateToolCache()
      this._notifyListeners()
    })

    this._sessions.set(config.id, session)
    this._configs.set(config.id, resolvedConfig)
    this._notifyListeners()

    try {
      await session.connect()
    } catch (err) {
      console.warn(`[MCPRegistry] failed to connect to "${config.label}":`, err)
    }

    this._notifyListeners()
  }

  async removeServer(id: string): Promise<void> {
    const session = this._sessions.get(id)
    if (!session) return
    await session.disconnect().catch(() => {})
    this._sessions.delete(id)
    this._configs.delete(id)
    this._invalidateToolCache()
    this._notifyListeners()
  }

  async reconnect(id: string): Promise<void> {
    const config = this._configs.get(id)
    if (!config) throw new Error(`MCPRegistry: server "${id}" not found`)
    await this.removeServer(id)
    await this.addServer(config)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Token management
  // ─────────────────────────────────────────────────────────────────────────

  async setToken(serverId: string, token: string): Promise<void> {
    await storage.saveToken(serverId, token)
    // Reconnect with the new token
    const config = this._configs.get(serverId)
    if (config) {
      await this.removeServer(serverId)
      await this.addServer({ ...config, headers: { ...config.headers, Authorization: `Bearer ${token}` } })
    }
  }

  async revokeToken(serverId: string): Promise<void> {
    await storage.deleteToken(serverId)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns all available tools from all ready sessions.
   * Result is cached per unique combination of ready session IDs (Nemilia pattern).
   */
  getAllTools(): ResolvedTool[] {
    const cacheKey = this._computeCacheKey()
    if (this._toolCache && this._toolCacheKey === cacheKey) {
      return this._toolCache
    }

    const tools: ResolvedTool[] = []
    for (const [, session] of this._sessions) {
      if (session.status !== 'ready') continue
      const config = this._configs.get(session.id)
      const serverLabel = config?.label ?? session.id
      for (const tool of session.tools) {
        tools.push({ ...tool, serverId: session.id, serverLabel })
      }
    }

    this._toolCache = tools
    this._toolCacheKey = cacheKey
    return tools
  }

  /**
   * Execute a tool on its owning server session.
   * Used by FunctionCallingAdapter and PromptInjectionAdapter.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<import('./types').MCPToolResult> {
    const session = this._sessions.get(serverId)
    if (!session || session.status !== 'ready') {
      throw new Error(
        `MCPRegistry: session "${serverId}" is not ready ` +
        `(status: ${session?.status ?? 'not found'})`
      )
    }
    return session.callTool(toolName, args)
  }

  /**
   * Find the server that owns a given tool name.
   * Returns undefined if no ready session has that tool.
   */
  resolveToolServer(toolName: string): string | undefined {
    for (const tool of this.getAllTools()) {
      if (tool.name === toolName) return tool.serverId
    }
    return undefined
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────────────────

  getStatuses(): MCPStatusMap {
    const map: MCPStatusMap = new Map()
    for (const [id, session] of this._sessions) {
      const config = this._configs.get(id)
      const status: MCPSessionStatus = {
        id,
        label: config?.label ?? id,
        status: session.status,
        errorMessage: session.errorMessage,
        toolCount: session.tools.length,
      }
      if (session.status === 'ready') {
        status.lastConnectedAt = new Date().toISOString()
      }
      map.set(id, status)
    }
    return map
  }

  subscribe(listener: StatusListener): () => void {
    this._statusListeners.push(listener)
    return () => {
      this._statusListeners = this._statusListeners.filter((l) => l !== listener)
    }
  }

  get hasTools(): boolean {
    return this.getAllTools().length > 0
  }

  get sessionCount(): number {
    return this._sessions.size
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  private _createTransport(config: MCPServerConfig) {
    const authProvider = config.oauth
      ? new OAuth2PKCEProvider({
          ...config.oauth,
          storageKey: `mcp_oauth_${config.id}`,
        })
      : undefined

    const headers = config.headers ?? {}

    if (config.transport === 'streamable-http') {
      return new StreamableHTTPTransport({
        url: config.url,
        headers,
        authProvider,
        onReconnect: () => {
          // Session will hot-reload via notifications/tools/list_changed
        },
      })
    }

    // SSE (default)
    return new SSETransport({ url: config.url, headers, authProvider })
  }

  private _hasAuthHeader(headers?: Record<string, string>): boolean {
    if (!headers) return false
    return 'Authorization' in headers || 'authorization' in headers
  }

  private _computeCacheKey(): string {
    const readyIds = [...this._sessions.entries()]
      .filter(([, s]) => s.status === 'ready')
      .map(([id]) => id)
      .sort()
      .join(',')
    return readyIds
  }

  private _invalidateToolCache(): void {
    this._toolCache = null
    this._toolCacheKey = ''
  }

  private _notifyListeners(): void {
    const statuses = this.getStatuses()
    for (const listener of this._statusListeners) {
      try { listener(statuses) } catch { /* ignore */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: MCPRegistry | null = null

/** Get or create the global MCPRegistry singleton. */
export function getMCPRegistry(): MCPRegistry {
  if (!_instance) _instance = new MCPRegistry()
  return _instance
}

/** Replace the singleton - for testing only. */
export function setMCPRegistry(instance: MCPRegistry): void {
  _instance = instance
}
