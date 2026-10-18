/**
 * MCP DATA CONSUMER - Shared Types
 *
 * These types cover the outbound direction only: PageAgent/website calling
 * external MCP servers (GitHub, Brave Search, etc.) to fetch live data.
 *
 * NOT related to packages/mcp/ - that package is the AGENTIC CONTROL server
 * (inbound: Claude Desktop / Cursor calling PageAgent to drive the browser).
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema (minimal subset for tool input schemas)
// ─────────────────────────────────────────────────────────────────────────────

export type JSONSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'

export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[]
  description?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  additionalProperties?: boolean | JSONSchema
  [key: string]: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Protocol Primitives
// ─────────────────────────────────────────────────────────────────────────────

export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
}

export interface MCPResourceDefinition {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type MCPContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string }

export interface MCPToolResult {
  content: MCPContentItem[]
  isError?: boolean
}

export interface MCPCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { listChanged?: boolean; subscribe?: boolean }
  prompts?: { listChanged?: boolean }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Status
// ─────────────────────────────────────────────────────────────────────────────

export type SessionStatus = 'disconnected' | 'connecting' | 'ready' | 'error'

export interface MCPSessionStatus {
  id: string
  label: string
  status: SessionStatus
  errorMessage?: string
  toolCount: number
  lastConnectedAt?: string
}

export type MCPStatusMap = Map<string, MCPSessionStatus>

// ─────────────────────────────────────────────────────────────────────────────
// Server Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 'auto'           - detect transport by probing (Streamable HTTP → SSE → plain HTTP).
 *                    Right default for user-added servers where transport is unknown.
 * 'streamable-http' - skip detection, use StreamableHTTPTransport directly.
 *                    Right for catalog servers where transport is known.
 * 'sse'            - skip detection, use SSETransport directly.
 */
export type RemoteTransportType = 'auto' | 'streamable-http' | 'sse'

export interface MCPServerConfig {
  /** Unique identifier - used as session key and storage key. */
  id: string
  label: string
  url: string
  transport: RemoteTransportType

  /**
   * Static auth headers (e.g. API keys).
   * Values prefixed with "securestore:<key>" are resolved from storage at call time.
   */
  headers?: Record<string, string>

  /** OAuth 2.0 + PKCE config - optional, for servers that require it. */
  oauth?: {
    authorizationEndpoint: string
    tokenEndpoint: string
    clientId: string
    scopes: string[]
    redirectUri: string
  }

  enabled: boolean
  /** If set, only these tool names can be called. Omit to allow all. */
  allowedTools?: string[]
  /** Max bytes of tool result content injected into context. Default: 8192 */
  maxResultBytes?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolved Tool (both transport and tool info in one flat object)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedTool extends MCPToolDefinition {
  /** ID of the MCPServerConfig that owns this tool. */
  serverId: string
  /** Server label - shown in UI and injected into system prompt. */
  serverLabel: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Invocation Adapter types (IInvocationAdapter.ts uses these)
// ─────────────────────────────────────────────────────────────────────────────

export type ToolCallFormat = 'xml' | 'json-fence' | 'hermes'

export interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
  rawMatch: string
  /** Present only when using FunctionCallingAdapter - needed for tool result message. */
  toolCallId?: string
}

/** Opaque LLM response shape - both adapters accept this. */
export interface LLMResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id: string
        function: { name: string; arguments: string }
      }>
    }
  }>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string // for role: 'tool' messages
}

export type ToolPreparationResult =
  | { mode: 'function-calling'; tools: OpenAIToolDefinition[] }
  | { mode: 'prompt-injection'; systemAddendum: string }

export interface OpenAIToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JSONSchema
  }
}
