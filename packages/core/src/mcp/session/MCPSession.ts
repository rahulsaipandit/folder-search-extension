/**
 * MCPSession - manages one connection to a remote MCP server.
 *
 * Responsibilities:
 *   - JSON-RPC 2.0 initialize handshake (protocolVersion negotiation)
 *   - Enumerates tools and resources after connect
 *   - Hot-reloads tools on notifications/tools/list_changed
 *   - Enforces allowedTools whitelist per MCPServerConfig
 *   - Caps result content size to prevent context overflow (default: 8 KB)
 *   - Fires status change listeners for UI reactivity
 *
 * DATA CONSUMER direction only. No Node.js APIs.
 * Works in browsers and React Native.
 */

import type { IMCPTransport } from '../transport/IMCPTransport'
import {
  makeRequest,
  makeNotification,
  RequestRegistry,
  isResponse,
  isNotification,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from '../protocol/jsonrpc'
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPToolResult,
  MCPCapabilities,
  SessionStatus,
} from '../types'

const DEFAULT_MAX_RESULT_BYTES = 8_192
const MCP_PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'PageAgent', version: '1.0' }

export class MCPSession {
  readonly id: string

  protected _tools: MCPToolDefinition[] = []
  protected _resources: MCPResourceDefinition[] = []
  protected _status: SessionStatus = 'disconnected'
  protected _errorMessage: string | undefined

  private readonly _registry = new RequestRegistry()
  private _statusListeners: Array<(status: SessionStatus) => void> = []

  protected readonly transport: IMCPTransport
  protected readonly config: MCPServerConfig

  constructor(transport: IMCPTransport, config: MCPServerConfig) {
    this.transport = transport
    this.config = config
    this.id = config.id
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._setStatus('connecting')

    try {
      this.transport.onMessage((msg) => this._onMessage(msg))
      await this.transport.connect()

      // MCP initialize handshake - required before any other request
      const result = await this._request<{
        protocolVersion: string
        capabilities: MCPCapabilities
        serverInfo?: { name: string; version: string }
      }>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: true } },
        clientInfo: CLIENT_INFO,
      })

      // Acknowledge initialization to the server
      await this._notify('notifications/initialized', {})

      // Enumerate server capabilities
      if (result.capabilities?.tools !== undefined) {
        await this._loadTools()
      }
      if (result.capabilities?.resources !== undefined) {
        await this._loadResources()
      }

      this._setStatus('ready')
    } catch (err) {
      this._errorMessage = String(err)
      this._setStatus('error')
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this._registry.rejectAll('Session disconnected')
    await this.transport.disconnect()
    this._setStatus('disconnected')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool execution
  // ─────────────────────────────────────────────────────────────────────────

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    this._assertReady()
    this._assertToolAllowed(name)

    const raw = await this._request<MCPToolResult>('tools/call', { name, arguments: args })
    return this._capResult(raw)
  }

  async readResource(uri: string): Promise<unknown> {
    this._assertReady()
    return this._request('resources/read', { uri })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  get tools(): MCPToolDefinition[] {
    return this.config.allowedTools
      ? this._tools.filter((t) => this.config.allowedTools!.includes(t.name))
      : this._tools
  }

  get resources(): MCPResourceDefinition[] {
    return this._resources
  }

  get status(): SessionStatus {
    return this._status
  }

  get errorMessage(): string | undefined {
    return this._errorMessage
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(listener: (status: SessionStatus) => void): () => void {
    this._statusListeners.push(listener)
    return () => {
      this._statusListeners = this._statusListeners.filter((l) => l !== listener)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  protected async _loadTools(): Promise<void> {
    try {
      const { tools } = await this._request<{ tools: MCPToolDefinition[] }>('tools/list', {})
      this._tools = tools ?? []
    } catch (err) {
      console.warn(`[MCPSession:${this.id}] failed to load tools:`, err)
    }
  }

  private async _loadResources(): Promise<void> {
    try {
      const { resources } = await this._request<{ resources: MCPResourceDefinition[] }>(
        'resources/list',
        {}
      )
      this._resources = resources ?? []
    } catch (err) {
      console.warn(`[MCPSession:${this.id}] failed to load resources:`, err)
    }
  }

  protected _request<T>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const msg = makeRequest(method, params)
      this._registry.register(msg.id, (result) => resolve(result as T), reject)
      this.transport.send(msg as JSONRPCRequest).catch(reject)
    })
  }

  protected async _notify(method: string, params?: unknown): Promise<void> {
    const msg = makeNotification(method, params)
    // Notifications don't have an id - cast to JSONRPCRequest to reuse send()
    await this.transport.send(msg as unknown as JSONRPCRequest)
  }

  private _onMessage(msg: JSONRPCMessage): void {
    if (isResponse(msg)) {
      this._registry.settle(msg)
      return
    }

    if (isNotification(msg)) {
      switch (msg.method) {
        case 'notifications/tools/list_changed':
          this._loadTools().catch((e) =>
            console.warn(`[MCPSession:${this.id}] hot-reload tools failed:`, e)
          )
          break
        case 'notifications/resources/list_changed':
          this._loadResources().catch(() => {})
          break
        default:
          break
      }
    }
  }

  private _setStatus(status: SessionStatus): void {
    this._status = status
    for (const listener of this._statusListeners) {
      try { listener(status) } catch { /* ignore listener errors */ }
    }
  }

  private _assertReady(): void {
    if (this._status !== 'ready') {
      throw new Error(`MCPSession "${this.id}" is not ready (status: ${this._status})`)
    }
  }

  private _assertToolAllowed(name: string): void {
    const { allowedTools } = this.config
    if (allowedTools && !allowedTools.includes(name)) {
      throw new Error(
        `MCPSession "${this.id}": tool "${name}" is not in the allowedTools list`
      )
    }
  }

  private _capResult(result: MCPToolResult): MCPToolResult {
    const maxBytes = this.config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES
    const capped = result.content.map((item) => {
      if (item.type === 'text' && item.text.length > maxBytes) {
        return {
          ...item,
          text:
            item.text.slice(0, maxBytes) +
            `\n[...truncated at ${maxBytes} bytes to prevent context overflow]`,
        }
      }
      return item
    })
    return { ...result, content: capped }
  }
}
