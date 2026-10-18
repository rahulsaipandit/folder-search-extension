/**
 * IInvocationAdapter - decouples tool exposure from tool discovery/execution.
 *
 * Two adapters implement this interface:
 *
 *   FunctionCallingAdapter  - for OpenAI-compatible models with native tool use.
 *     prepareTools()   → { mode: 'function-calling', tools: OpenAIToolDefinition[] }
 *     extractCalls()   → reads tool_calls array from the LLM response
 *     buildResult()    → { role: 'tool', tool_call_id, content } message
 *
 *   PromptInjectionAdapter  - for local models without function calling support.
 *     prepareTools()   → { mode: 'prompt-injection', systemAddendum: string }
 *     extractCalls()   → regex-parses <tool_call> / ```json / hermes blocks
 *     buildResult()    → synthetic user message with tool result text
 *
 * This lets the same MCPRegistry power both adapter paths. The consuming code
 * (AgenticCore, executive twin, GuideAxon mobile) picks the right adapter and
 * calls through it without knowing the LLM protocol details.
 */

import type {
  ResolvedTool,
  ParsedToolCall,
  ChatMessage,
  MCPToolResult,
  ToolPreparationResult,
  LLMResponse,
} from '../types'

export interface IInvocationAdapter {
  /**
   * Convert a list of resolved tools into the format required by the LLM.
   *
   * - FunctionCallingAdapter: returns { mode: 'function-calling', tools }
   *   Caller adds `tools` to the /chat/completions request body.
   *
   * - PromptInjectionAdapter: returns { mode: 'prompt-injection', systemAddendum }
   *   Caller appends `systemAddendum` to the system prompt before calling the LLM.
   */
  prepareTools(tools: ResolvedTool[]): ToolPreparationResult

  /**
   * Extract all tool calls from the LLM response.
   *
   * - FunctionCallingAdapter: reads `choices[0].message.tool_calls`.
   * - PromptInjectionAdapter: regex-parses structured text blocks in the content.
   *
   * Returns an empty array if the model produced a final answer without tool use.
   */
  extractCalls(response: LLMResponse): ParsedToolCall[]

  /**
   * Build a message that injects a tool result back into the conversation.
   *
   * - FunctionCallingAdapter: returns `{ role: 'tool', tool_call_id, content }`.
   * - PromptInjectionAdapter: returns `{ role: 'user', content: '<tool_result>...' }`.
   */
  buildResult(toolCall: ParsedToolCall, result: MCPToolResult): ChatMessage
}
