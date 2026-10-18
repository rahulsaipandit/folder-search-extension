/**
 * FunctionCallingAdapter - IInvocationAdapter for OpenAI-compatible models.
 *
 * Uses the native `tools` parameter on the /chat/completions API.
 * The model returns structured `tool_calls` in the message object, so no
 * regex parsing is needed - the LLM handles the formatting.
 *
 * Compatible with: GPT-4o, Claude (via OpenAI-compatible proxy), Gemini (OpenAI mode),
 * Groq, Together AI, Fireworks, and any OpenAI-compatible endpoint.
 *
 * Message flow:
 *   1. prepareTools() → { mode: 'function-calling', tools: [...] }
 *      Caller adds `tools` to the request body.
 *   2. Model responds with message.tool_calls[].
 *   3. extractCalls() reads tool_calls and returns ParsedToolCall[].
 *   4. buildResult() returns { role: 'tool', tool_call_id, content } message.
 *   5. Caller appends assistant + tool messages to history and loops.
 */

import type { IInvocationAdapter } from './IInvocationAdapter'
import type {
  ResolvedTool,
  ParsedToolCall,
  ChatMessage,
  MCPToolResult,
  ToolPreparationResult,
  LLMResponse,
  OpenAIToolDefinition,
} from '../types'

export class FunctionCallingAdapter implements IInvocationAdapter {
  prepareTools(tools: ResolvedTool[]): ToolPreparationResult {
    if (tools.length === 0) {
      // No tools available - return empty list; caller can omit the field
      return { mode: 'function-calling', tools: [] }
    }

    const openAITools: OpenAIToolDefinition[] = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))

    return { mode: 'function-calling', tools: openAITools }
  }

  extractCalls(response: LLMResponse): ParsedToolCall[] {
    const toolCalls = response.choices?.[0]?.message?.tool_calls
    if (!toolCalls || toolCalls.length === 0) return []

    const parsed: ParsedToolCall[] = []

    for (const tc of toolCalls) {
      let args: Record<string, unknown>
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // Malformed arguments - skip this call but log it so it's visible
        console.warn(
          `[FunctionCallingAdapter] could not parse arguments for tool "${tc.function.name}":`,
          tc.function.arguments.slice(0, 200)
        )
        continue
      }

      parsed.push({
        name: tc.function.name,
        arguments: args,
        rawMatch: JSON.stringify(tc),
        toolCallId: tc.id, // Required for the tool result message
      })
    }

    return parsed
  }

  buildResult(toolCall: ParsedToolCall, result: MCPToolResult): ChatMessage {
    if (!toolCall.toolCallId) {
      throw new Error(
        `FunctionCallingAdapter.buildResult: ParsedToolCall for "${toolCall.name}" ` +
        'is missing toolCallId. Did you use FunctionCallingAdapter.extractCalls()?'
      )
    }

    const textContent = result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')

    const content = result.isError
      ? `Error executing tool "${toolCall.name}": ${textContent}`
      : textContent || JSON.stringify(result.content)

    return {
      role: 'tool',
      content,
      tool_call_id: toolCall.toolCallId,
    }
  }
}
