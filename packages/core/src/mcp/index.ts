/**
 * @page-agent/core/mcp - MCP DATA CONSUMER for PageAgent, website, extension, and mobile.
 *
 * ─── What this module does ────────────────────────────────────────────────────
 * Outbound MCP client: browser/mobile → external MCP servers (GitHub, Brave Search,
 * Exa, Perplexity, Calendar, and user-added custom servers).
 *
 * ─── What this module does NOT do ─────────────────────────────────────────────
 * This is NOT the AGENTIC CONTROL server in packages/mcp/ (that exposes PageAgent
 * to Claude Desktop / Cursor via Node.js stdio). There is no code overlap because
 * the two directions run in completely different runtimes (browser vs Node.js stdio).
 *
 * ─── Platform support ─────────────────────────────────────────────────────────
 * Web, React Native (Expo), and future Node.js consumers (with fetch polyfill).
 * No Node.js-specific imports in this tree.
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────
 * ```ts
 * import { getMCPRegistry, FunctionCallingAdapter } from '@page-agent/core/mcp'
 *
 * // 1. Initialize registry with saved configs
 * const registry = getMCPRegistry()
 * await registry.loadAndConnect()
 *
 * // 2. Pick an adapter
 * const adapter = new FunctionCallingAdapter()   // or PromptInjectionAdapter
 *
 * // 3. Prepare tools for the LLM
 * const tools = registry.getAllTools()
 * const prepared = adapter.prepareTools(tools)
 * // If mode === 'function-calling': add prepared.tools to your API request
 * // If mode === 'prompt-injection': append prepared.systemAddendum to system prompt
 *
 * // 4. After the LLM responds, extract and execute tool calls
 * const calls = adapter.extractCalls(llmResponse)
 * for (const call of calls) {
 *   const serverId = registry.resolveToolServer(call.name)!
 *   const result = await registry.callTool(serverId, call.name, call.arguments)
 *   const msg = adapter.buildResult(call, result)
 *   // Append msg to chat history and call the LLM again
 * }
 * ```
 */

// ── Types (import these for TypeScript consumers) ─────────────────────────────
export type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPContentItem,
  MCPToolResult,
  MCPCapabilities,
  SessionStatus,
  MCPSessionStatus,
  MCPStatusMap,
  RemoteTransportType,
  ResolvedTool,
  ToolCallFormat,
  ParsedToolCall,
  LLMResponse,
  ChatMessage,
  ToolPreparationResult,
  OpenAIToolDefinition,
  JSONSchema,
  JSONSchemaType,
} from './types'

// ── Protocol ──────────────────────────────────────────────────────────────────
export {
  makeRequest,
  makeNotification,
  parseMessage,
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  RequestRegistry,
  JSONRPC_ERRORS,
} from './protocol/jsonrpc'
export type {
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCSuccessResponse,
  JSONRPCErrorResponse,
  JSONRPCResponse,
  JSONRPCMessage,
} from './protocol/jsonrpc'

// ── Transport ─────────────────────────────────────────────────────────────────
export type { IMCPTransport } from './transport/IMCPTransport'
export { SSETransport } from './transport/SSETransport'
export type { SSETransportConfig } from './transport/SSETransport'
export { StreamableHTTPTransport } from './transport/StreamableHTTPTransport'
export type { StreamableHTTPTransportConfig } from './transport/StreamableHTTPTransport'

// ── Auth ──────────────────────────────────────────────────────────────────────
export type { IOAuth2Provider } from './auth/IOAuth2Provider'
export { OAuth2PKCEProvider } from './auth/OAuth2PKCEProvider'
export type { OAuth2PKCEConfig } from './auth/OAuth2PKCEProvider'

// ── Session ───────────────────────────────────────────────────────────────────
export { MCPSession } from './session/MCPSession'

// ── Storage ───────────────────────────────────────────────────────────────────
export {
  saveServer,
  loadServers,
  loadServer,
  updateServerTransport,
  deleteServer,
  saveToken,
  loadToken,
  deleteToken,
  hasToken,
  initAsyncStorage,
} from './storage'

// ── Catalog ───────────────────────────────────────────────────────────────────
export {
  MCP_CATALOG,
  CATALOG_MAP,
  isCatalogServer,
  resolveCatalogServer,
  generateServerId,
  formatMCPToolsForPrompt,
} from './catalog'
export type { MCPCatalogEntry } from './catalog'

// ── Registry ──────────────────────────────────────────────────────────────────
export { MCPRegistry, getMCPRegistry, setMCPRegistry } from './registry'

// ── Invocation adapters ───────────────────────────────────────────────────────
export type { IInvocationAdapter } from './invocation/IInvocationAdapter'
export { FunctionCallingAdapter } from './invocation/FunctionCallingAdapter'
export { PromptInjectionAdapter } from './invocation/PromptInjectionAdapter'
export { buildToolSystemPrompt } from './invocation/buildToolSystemPrompt'
export { parseToolCall, hasPartialToolCall, stripToolCall } from './invocation/parseToolCall'
