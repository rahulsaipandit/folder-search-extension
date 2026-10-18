/**
 * PromptInjectionAdapter - IInvocationAdapter for models without function calling.
 *
 * Injects tool definitions as plain text in the system prompt. The model is
 * instructed to emit a structured text block (xml / json-fence / hermes format)
 * when it wants to call a tool. The adapter parses those blocks with a regex.
 *
 * Use this for:
 *   - Local open-weight models (llama.rn / WebLLM / Ollama / LM Studio)
 *   - Any model that doesn't support the `tools` parameter
 *   - Streaming scenarios where you want to detect and suppress tool blocks live
 *
 * Message flow:
 *   1. prepareTools() → { mode: 'prompt-injection', systemAddendum }
 *      Caller appends `systemAddendum` to the system prompt.
 *   2. Model responds with plain text potentially containing a tool block.
 *   3. extractCalls() regex-parses the text; returns [] for final answers.
 *   4. buildResult() returns a synthetic user message with the tool result.
 *   5. Caller appends assistant + user messages to history and loops.
 *
 * For streaming: use hasPartialToolCall() to detect incomplete blocks and
 * suppress them from being shown to the user until the full block is parsed.
 */

import type { IInvocationAdapter } from './IInvocationAdapter'
import type {
  ResolvedTool,
  ParsedToolCall,
  ChatMessage,
  MCPToolResult,
  ToolPreparationResult,
  LLMResponse,
  ToolCallFormat,
} from '../types'
import { buildToolSystemPrompt } from './buildToolSystemPrompt'
import { parseToolCall } from './parseToolCall'

export class PromptInjectionAdapter implements IInvocationAdapter {
  private readonly format: ToolCallFormat

  constructor(format: ToolCallFormat = 'xml') {
    this.format = format
  }

  prepareTools(tools: ResolvedTool[]): ToolPreparationResult {
    const systemAddendum = buildToolSystemPrompt(tools, this.format)
    return { mode: 'prompt-injection', systemAddendum }
  }

  extractCalls(response: LLMResponse): ParsedToolCall[] {
    // For prompt injection, the tool call is embedded in the text content
    const content = response.choices?.[0]?.message?.content
    if (!content) return []

    const call = parseToolCall(content, this.format)
    return call ? [call] : []
  }

  buildResult(toolCall: ParsedToolCall, result: MCPToolResult): ChatMessage {
    const textContent = result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')

    const errorSuffix = result.isError ? ' (error)' : ''
    let content: string

    switch (this.format) {
      case 'xml':
        content = `<tool_result name="${toolCall.name}"${errorSuffix}>\n${textContent}\n</tool_result>`
        break
      case 'hermes':
        content = `<tool_response name="${toolCall.name}"${errorSuffix}>\n${textContent}\n</tool_response>`
        break
      case 'json-fence':
        content = `Tool result for \`${toolCall.name}\`${errorSuffix}:\n\`\`\`\n${textContent}\n\`\`\``
        break
    }

    return { role: 'user', content }
  }

  /** Expose the configured format for streaming suppression checks. */
  get toolCallFormat(): ToolCallFormat {
    return this.format
  }
}
