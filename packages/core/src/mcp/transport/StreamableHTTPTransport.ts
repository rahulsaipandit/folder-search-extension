/**
 * StreamableHTTPTransport - MCP Streamable HTTP transport (spec 2025-03-26).
 *
 * Improvements over SSETransport:
 *   - Persistent session: Mcp-Session-Id header carried on every request.
 *   - Resumable streams: Last-Event-ID header sent on reconnect.
 *   - Exponential-backoff reconnect: 1s → 2s → 4s … capped at 30s.
 *   - Automatic tools/list refresh is triggered by the session via
 *     notifications/tools/list_changed after reconnect.
 *
 * Reference: https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/
 *
 * Platforms: Web + React Native (fetch-based).
 */

import { SSETransport, type SSETransportConfig } from './SSETransport'
import { makeNotification, type JSONRPCMessage, type JSONRPCRequest } from '../protocol/jsonrpc'

const MIN_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

export type StreamableHTTPTransportConfig = SSETransportConfig & {
  /** Initial delay before first reconnect attempt in ms. Default: 1000 */
  initialReconnectDelayMs?: number
  /** Called after a successful reconnect so the caller can refresh its tool list. */
  onReconnect?: () => void
}

export class StreamableHTTPTransport extends SSETransport {
  private _sessionId: string | null = null
  private _lastEventId: string | null = null
  private _reconnectDelay: number
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _intentionalDisconnect = false

  private readonly sHTTPConfig: StreamableHTTPTransportConfig

  constructor(sHTTPConfig: StreamableHTTPTransportConfig) {
    super(sHTTPConfig)
    this.sHTTPConfig = sHTTPConfig
    this._reconnectDelay = sHTTPConfig.initialReconnectDelayMs ?? MIN_RECONNECT_MS
  }

  override async connect(): Promise<void> {
    this._intentionalDisconnect = false
    await super.connect()
    this._reconnectDelay = this.sHTTPConfig.initialReconnectDelayMs ?? MIN_RECONNECT_MS
  }

  override async disconnect(): Promise<void> {
    this._intentionalDisconnect = true
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    await super.disconnect()
    this._sessionId = null
    this._lastEventId = null
  }

  /** Inject Mcp-Session-Id and Last-Event-ID on every request. */
  protected override async _buildHeaders(): Promise<Record<string, string>> {
    const base = await super._buildHeaders()
    if (this._sessionId) base['Mcp-Session-Id'] = this._sessionId
    if (this._lastEventId) base['Last-Event-ID'] = this._lastEventId
    return base
  }

  /** Intercept inbound messages to extract session ID and track last event ID. */
  override onMessage(handler: (msg: JSONRPCMessage) => void): void {
    super.onMessage((msg) => {
      // Capture session ID from the initialize response
      if (
        'result' in msg &&
        msg.result !== null &&
        typeof msg.result === 'object' &&
        'sessionId' in (msg.result as object)
      ) {
        this._sessionId = (msg.result as { sessionId: string }).sessionId ?? null
      }

      // Track last event ID for stream resumption (non-standard but common in practice)
      if ('id' in msg && typeof msg.id === 'string' && msg.id.startsWith('evt-')) {
        this._lastEventId = msg.id
      }

      handler(msg)
    })
  }

  /** Reconnect with exponential backoff when the stream closes unexpectedly. */
  protected override _onStreamClosed(): void {
    if (this._intentionalDisconnect) return
    this._connected = false

    console.info(
      `[StreamableHTTPTransport] stream closed, reconnecting in ${this._reconnectDelay}ms`
    )

    this._reconnectTimer = setTimeout(async () => {
      try {
        await super.connect()
        this._reconnectDelay = this.sHTTPConfig.initialReconnectDelayMs ?? MIN_RECONNECT_MS
        this.sHTTPConfig.onReconnect?.()
      } catch (err) {
        console.warn('[StreamableHTTPTransport] reconnect failed:', err)
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_MS)
        this._onStreamClosed() // schedule next attempt
      }
    }, this._reconnectDelay)
  }

  /**
   * Terminate the session on the server (MCP 2025-03-26 §3.6).
   * Call before disconnect() for a clean close when the server supports it.
   */
  async terminateSession(): Promise<void> {
    if (!this._sessionId || !this.isConnected) return
    try {
      const postUrl =
        this.sHTTPConfig.postUrl ?? this.sHTTPConfig.url.replace('/sse', '/message')
      const headers = await this._buildHeaders()
      await fetch(postUrl, { method: 'DELETE', headers })
    } catch {
      // Best-effort - server may already be gone
    }
  }

  /**
   * For Streamable HTTP, outbound messages are POSTed directly to the server URL
   * (not a separate /message endpoint). Override send() to handle the session header.
   */
  override async send(message: JSONRPCRequest): Promise<void> {
    if (!this._connected) throw new Error('StreamableHTTPTransport: not connected')

    const headers = await this._buildHeaders()
    const res = await fetch(this.sHTTPConfig.url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!res.ok) {
      throw new Error(
        `StreamableHTTPTransport: POST failed ${res.status} ${res.statusText}`
      )
    }

    // Capture any session ID returned on outbound responses
    const newSid = res.headers.get('Mcp-Session-Id')
    if (newSid) this._sessionId = newSid
  }
}
