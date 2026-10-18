/**
 * SSETransport - Server-Sent Events MCP transport (legacy protocol).
 *
 * Protocol flow:
 *   1. Client opens a persistent GET connection with Accept: text/event-stream.
 *   2. Server pushes JSON-RPC messages as SSE `data:` events.
 *   3. Client sends outbound messages via POST to a separate endpoint
 *      (default: same URL with /sse replaced by /message, or `postUrl`).
 *
 * Use for older MCP servers that haven't upgraded to Streamable HTTP.
 *
 * Platforms: Web + React Native (uses fetch - no EventSource API needed).
 * No Node.js-specific APIs.
 */

import type { IMCPTransport } from './IMCPTransport'
import type { IOAuth2Provider } from '../auth/IOAuth2Provider'
import { parseMessage, type JSONRPCRequest, type JSONRPCMessage } from '../protocol/jsonrpc'

export interface SSETransportConfig {
  url: string
  /** Static extra headers (e.g. { Authorization: 'Bearer token' }) */
  headers?: Record<string, string>
  /** If set, used to obtain and refresh OAuth access tokens. */
  authProvider?: IOAuth2Provider
  /** POST endpoint for outbound messages. Defaults to {url.replace('/sse', '/message')} */
  postUrl?: string
}

export class SSETransport implements IMCPTransport {
  protected _connected = false
  protected _messageHandler: ((msg: JSONRPCMessage) => void) | null = null
  protected _abortController: AbortController | null = null
  protected config: SSETransportConfig

  constructor(config: SSETransportConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this._connected) return
    const headers = await this._buildHeaders()
    this._abortController = new AbortController()
    await this._openStream(headers)
    this._connected = true
  }

  async disconnect(): Promise<void> {
    this._abortController?.abort()
    this._abortController = null
    this._connected = false
  }

  async send(message: JSONRPCRequest): Promise<void> {
    if (!this._connected) throw new Error('SSETransport: not connected')

    const postUrl = this.config.postUrl ?? this.config.url.replace('/sse', '/message')
    const headers = await this._buildHeaders()

    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!res.ok) {
      throw new Error(`SSETransport: POST ${postUrl} failed ${res.status} ${res.statusText}`)
    }
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void {
    this._messageHandler = handler
  }

  get isConnected(): boolean {
    return this._connected
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Protected - overridden by StreamableHTTPTransport
  // ─────────────────────────────────────────────────────────────────────────

  protected async _buildHeaders(): Promise<Record<string, string>> {
    const base: Record<string, string> = { ...(this.config.headers ?? {}) }
    if (this.config.authProvider) {
      const token = await this.config.authProvider.getAccessToken()
      base['Authorization'] = `Bearer ${token}`
    }
    return base
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  private async _openStream(headers: Record<string, string>): Promise<void> {
    const signal = this._abortController!.signal

    const res = await fetch(this.config.url, {
      method: 'GET',
      headers: { ...headers, Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      signal,
    })

    if (!res.ok) {
      throw new Error(
        `SSETransport: GET ${this.config.url} failed ${res.status} ${res.statusText}`
      )
    }
    if (!res.body) throw new Error('SSETransport: response has no body')

    // Read the SSE stream asynchronously without blocking connect()
    this._readStream(res.body, signal).catch((err) => {
      if (signal.aborted) return // intentional disconnect
      console.warn('[SSETransport] stream error:', err)
      this._connected = false
      this._onStreamClosed()
    })
  }

  private async _readStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const dataLine = event.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const raw = dataLine.slice(5).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const msg = parseMessage(raw)
            this._messageHandler?.(msg)
          } catch (e) {
            console.warn('[SSETransport] unparseable event:', raw.slice(0, 80), e)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Stream ended - notify subclasses (e.g. for reconnect)
    if (!signal.aborted) this._onStreamClosed()
  }

  /** Called when the SSE stream closes unexpectedly. Override in subclasses. */
  protected _onStreamClosed(): void {
    this._connected = false
  }
}
