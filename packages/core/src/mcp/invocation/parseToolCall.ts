/**
 * parseToolCall - extract a structured tool call from raw LLM text output.
 *
 * Handles all three formats from buildToolSystemPrompt:
 *   'xml'        - <tool_call>{"name":"...","arguments":{...}}</tool_call>
 *   'json-fence' - ```json\n{"tool":"...","arguments":{...}}\n```
 *   'hermes'     - <tool_call>{"name":"...","arguments":{...}}</tool_call>
 *
 * Returns null for final answers (no tool call in the text).
 */

import type { ToolCallFormat, ParsedToolCall } from '../types'

// ── Regex patterns ────────────────────────────────────────────────────────────

const PATTERNS: Record<ToolCallFormat, RegExp> = {
  xml:          /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/,
  'json-fence': /```(?:json)?\s*([\s\S]*?)\s*```/,
  hermes:       /<tool_call>([\s\S]*?)<\/tool_call>/,
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseToolCall(text: string, format: ToolCallFormat = 'xml'): ParsedToolCall | null {
  const match = text.match(PATTERNS[format])
  if (!match) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[1])
  } catch {
    // Attempt to clean up common LLM whitespace / newline artifacts
    try {
      const cleaned = match[1].replace(/\n\s*/g, ' ').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return null
    }
  }

  // Support both { name, arguments } and { tool, arguments } conventions
  const name = (parsed.name ?? parsed.tool) as string | undefined
  if (!name || typeof name !== 'string') return null

  const args = (parsed.arguments ?? parsed.args ?? {}) as Record<string, unknown>

  return {
    name,
    arguments: args,
    rawMatch: match[0],
  }
}

/**
 * Returns true if the streaming buffer contains an incomplete tool_call opening tag.
 * Used by AgenticCore to suppress token streaming until the full block is available,
 * preventing partial XML/JSON from being shown to the user.
 */
export function hasPartialToolCall(buffer: string, format: ToolCallFormat = 'xml'): boolean {
  switch (format) {
    case 'xml':
    case 'hermes':
      return buffer.includes('<tool_call>') && !buffer.includes('</tool_call>')
    case 'json-fence':
      return (buffer.match(/```/g) ?? []).length % 2 !== 0
  }
}

/**
 * Strip a tool_call block from the text for display purposes.
 * Removes the raw XML/fence so only prose is shown to the user.
 */
export function stripToolCall(text: string, format: ToolCallFormat = 'xml'): string {
  return text.replace(PATTERNS[format], '').trim()
}
