/**
 * JSON-RPC 2.0 helpers for the MCP DATA CONSUMER protocol.
 * Spec: https://www.jsonrpc.org/specification
 *
 * Used by MCPSession to send requests and dispatch inbound messages.
 * No dependency on any runtime environment - works in browser and Node.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────────

export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JSONRPCSuccessResponse {
  jsonrpc: '2.0'
  id: string | number
  result: unknown
}

export interface JSONRPCErrorResponse {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JSONRPCResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse
export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse

// ─────────────────────────────────────────────────────────────────────────────
// Standard error codes
// ─────────────────────────────────────────────────────────────────────────────

export const JSONRPC_ERRORS = {
  PARSE_ERROR:      { code: -32700, message: 'Parse error' },
  INVALID_REQUEST:  { code: -32600, message: 'Invalid request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS:   { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR:   { code: -32603, message: 'Internal error' },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

export function isRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return 'id' in msg && 'method' in msg
}

export function isNotification(msg: JSONRPCMessage): msg is JSONRPCNotification {
  return !('id' in msg) && 'method' in msg
}

export function isResponse(msg: JSONRPCMessage): msg is JSONRPCResponse {
  return 'id' in msg && !('method' in msg)
}

export function isErrorResponse(msg: JSONRPCMessage): msg is JSONRPCErrorResponse {
  return isResponse(msg) && 'error' in msg
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

let _nextId = 1

export function makeRequest(method: string, params?: unknown): JSONRPCRequest {
  return { jsonrpc: '2.0', id: _nextId++, method, params }
}

export function makeNotification(method: string, params?: unknown): JSONRPCNotification {
  return { jsonrpc: '2.0', method, params }
}

export function parseMessage(raw: string): JSONRPCMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`JSON-RPC parse error: ${raw.slice(0, 100)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('jsonrpc' in parsed)) {
    throw new Error('Not a valid JSON-RPC 2.0 message')
  }
  return parsed as JSONRPCMessage
}

// ─────────────────────────────────────────────────────────────────────────────
// RequestRegistry - pending request tracking with per-request timeouts
// ─────────────────────────────────────────────────────────────────────────────

interface PendingEntry {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RequestRegistry {
  private readonly _pending = new Map<string | number, PendingEntry>()

  register(
    id: string | number,
    resolve: (r: unknown) => void,
    reject: (e: Error) => void,
    timeoutMs = 30_000
  ): void {
    const timer = setTimeout(() => {
      this._pending.delete(id)
      reject(new Error(`JSON-RPC request ${id} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    this._pending.set(id, { resolve, reject, timer })
  }

  settle(response: JSONRPCResponse): void {
    const id = response.id
    if (id === null || id === undefined) return
    const entry = this._pending.get(id)
    if (!entry) return

    clearTimeout(entry.timer)
    this._pending.delete(id)

    if (isErrorResponse(response)) {
      entry.reject(new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`))
    } else {
      entry.resolve((response as JSONRPCSuccessResponse).result)
    }
  }

  /** Reject all pending requests - call on session disconnect. */
  rejectAll(reason: string): void {
    for (const [id, entry] of this._pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
      this._pending.delete(id)
    }
  }

  get size(): number {
    return this._pending.size
  }
}
