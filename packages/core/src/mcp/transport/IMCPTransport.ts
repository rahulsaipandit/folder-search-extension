/**
 * IMCPTransport - contract for all MCP transport implementations.
 *
 * DATA CONSUMER direction only: browser/mobile → external MCP server.
 * Implementations: SSETransport (legacy SSE), StreamableHTTPTransport (2025-03-26).
 *
 * Platform notes:
 *   - All implementations use browser `fetch` + `ReadableStream`, which works
 *     in web browsers and React Native (via built-in or polyfill fetch).
 *   - No Node.js-specific APIs; this code cannot use `child_process`, `node:http`,
 *     or the `ws` npm package. Those belong in packages/mcp/ (AGENTIC CONTROL).
 */

import type { JSONRPCMessage, JSONRPCRequest } from '../protocol/jsonrpc'

export interface IMCPTransport {
  /**
   * Establish connection to the MCP server.
   * Resolves when the transport is ready to send/receive messages.
   * Rejects on connection failure.
   */
  connect(): Promise<void>

  /**
   * Close the connection gracefully.
   * After this call, no further messages will be delivered to the onMessage handler.
   */
  disconnect(): Promise<void>

  /**
   * Send a JSON-RPC request or notification to the server.
   * Implementations must serialize `message` and dispatch it over the wire.
   */
  send(message: JSONRPCRequest): Promise<void>

  /**
   * Register a handler for all inbound JSON-RPC messages (responses + server notifications).
   * Only one handler is supported; calling this again replaces the previous one.
   */
  onMessage(handler: (msg: JSONRPCMessage) => void): void

  /** True when the transport has an active connection. */
  readonly isConnected: boolean
}
