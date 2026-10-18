/**
 * MCPCatalog - built-in MCP server definitions.
 *
 * These are well-known public MCP servers. They are pre-configured so users
 * only need to provide an API key (token), not a URL or transport setting.
 *
 * The catalog is additive - custom servers added by the user live in MCPStorage
 * and are merged with catalog servers at runtime by MCPRegistry.
 *
 * To add a new catalog server:
 *   1. Add an entry to MCP_CATALOG with a stable `id`.
 *   2. Set `transport: 'streamable-http'` or `'sse'` if the protocol is known,
 *      or `'auto'` to let the registry detect it.
 *   3. Add `requiresToken: true` if an API key is required.
 */

import type { MCPServerConfig } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Catalog entries
// ─────────────────────────────────────────────────────────────────────────────

/** Extended config with catalog-specific metadata. */
export interface MCPCatalogEntry extends Omit<MCPServerConfig, 'enabled'> {
  /** Short description shown in the server picker UI. */
  about: string
  /** True if this server requires a bearer token to work. */
  requiresToken: boolean
  /** URL to the API key / developer console for this provider. */
  tokenUrl?: string
}

export const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    id: 'catalog_github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'streamable-http',
    about: 'Search code, issues, PRs and repositories on GitHub.',
    requiresToken: true,
    tokenUrl: 'https://github.com/settings/tokens',
    allowedTools: undefined,
    maxResultBytes: 8192,
    headers: {},
  },
  {
    id: 'catalog_brave',
    label: 'Brave Search',
    url: 'https://api.search.brave.com/mcp',
    transport: 'streamable-http',
    about: 'Privacy-respecting web search and news via Brave.',
    requiresToken: true,
    tokenUrl: 'https://api.search.brave.com/register',
    allowedTools: undefined,
    maxResultBytes: 8192,
    headers: {},
  },
  {
    id: 'catalog_exa',
    label: 'Exa',
    url: 'https://mcp.exa.ai/mcp',
    transport: 'streamable-http',
    about: 'Semantic web search optimised for AI workloads.',
    requiresToken: true,
    tokenUrl: 'https://dashboard.exa.ai/api-keys',
    allowedTools: undefined,
    maxResultBytes: 8192,
    headers: {},
  },
  {
    id: 'catalog_perplexity',
    label: 'Perplexity',
    url: 'https://mcp.perplexity.ai/mcp',
    transport: 'streamable-http',
    about: 'Real-time web search with cited answers.',
    requiresToken: true,
    tokenUrl: 'https://www.perplexity.ai/api',
    allowedTools: undefined,
    maxResultBytes: 8192,
    headers: {},
  },
  {
    id: 'catalog_calendar',
    label: 'Google Calendar',
    url: 'https://calendar.googleapis.com/mcp',
    transport: 'auto',
    about: 'Read and write Google Calendar events.',
    requiresToken: false, // uses OAuth 2.0 PKCE instead of a bearer token
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      clientId: '', // must be set by the application at runtime
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      redirectUri: '', // must be set by the application at runtime
    },
    allowedTools: undefined,
    maxResultBytes: 8192,
    headers: {},
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map from catalog ID to catalog entry for O(1) lookups. */
export const CATALOG_MAP: ReadonlyMap<string, MCPCatalogEntry> = new Map(
  MCP_CATALOG.map((s) => [s.id, s])
)

/** Returns true if the given ID refers to a built-in catalog server. */
export function isCatalogServer(id: string): boolean {
  return CATALOG_MAP.has(id)
}

/** Resolve a catalog entry into a full MCPServerConfig with a runtime token. */
export function resolveCatalogServer(
  id: string,
  token?: string,
  overrides?: Partial<MCPServerConfig>
): MCPServerConfig | null {
  const entry = CATALOG_MAP.get(id)
  if (!entry) return null

  const headers: Record<string, string> = { ...(entry.headers ?? {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`

  return {
    ...entry,
    ...overrides,
    id: entry.id,
    label: entry.label,
    url: entry.url,
    transport: entry.transport,
    headers,
    enabled: true,
  }
}

/** Generate a stable ID for a user-added custom server given its URL. */
export function generateServerId(url: string): string {
  // Strip protocol and trailing slash, replace non-alphanumeric runs with '_'
  return 'custom_' + url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 48)
}

/**
 * Build the system-prompt section that describes available MCP tools.
 * Used by PromptInjectionAdapter and can also be called directly.
 */
export function formatMCPToolsForPrompt(
  tools: Array<{ name: string; description: string; serverLabel: string }>
): string {
  if (tools.length === 0) return ''

  const lines = tools.map(
    (t) => `  - ${t.name} (from ${t.serverLabel}): ${t.description}`
  )

  return `## Available MCP Tools\n\n${lines.join('\n')}`
}
