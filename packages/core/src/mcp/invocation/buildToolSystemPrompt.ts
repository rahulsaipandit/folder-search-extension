/**
 * buildToolSystemPrompt - injects MCP tool definitions into a system prompt.
 *
 * Used by PromptInjectionAdapter when the LLM lacks native function-calling support
 * (local open-weight models: Llama, Qwen, Phi, Mistral, etc.).
 *
 * Three output formats:
 *
 *   'xml'        - <tool_call>{"name":"...","arguments":{...}}</tool_call>
 *                  Best general compatibility with Llama/Qwen/Phi models.
 *
 *   'json-fence' - ```json\n{"tool":"...","arguments":{...}}\n```
 *                  Works well with code-fine-tuned models.
 *
 *   'hermes'     - NousHermes / Functionary function-call style.
 *                  Best with models fine-tuned for function calling.
 */

import type { ToolCallFormat } from '../types'
import type { MCPToolDefinition } from '../types'

const FORMAT_INSTRUCTIONS: Record<ToolCallFormat, string> = {
  xml: `When you need to use a tool, output EXACTLY this XML block and nothing else on that turn:

<tool_call>
{"name": "<tool_name>", "arguments": {<json_arguments>}}
</tool_call>

After receiving the <tool_result> block, continue your response naturally.`,

  'json-fence': `When you need to use a tool, output EXACTLY this JSON code block and nothing else on that turn:

\`\`\`json
{"tool": "<tool_name>", "arguments": {<json_arguments>}}
\`\`\`

After receiving the tool result, continue your response naturally.`,

  hermes: `When you need to use a tool, output EXACTLY this block and nothing else on that turn:

<tool_call>{"name": "<tool_name>", "arguments": {<json_arguments>}}</tool_call>

After receiving the <tool_response> block, continue your response naturally.`,
}

const TOOL_RULES = `Rules:
- Only call ONE tool per turn.
- Pass all required arguments as valid JSON.
- Do NOT call a tool if you already have enough information to answer.
- If no tool is needed, respond directly without any tool block.`

export function buildToolSystemPrompt(
  tools: MCPToolDefinition[],
  format: ToolCallFormat = 'xml'
): string {
  if (tools.length === 0) return ''

  const toolsJson = JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
    null,
    2
  )

  return `You have access to the following tools.

${FORMAT_INSTRUCTIONS[format]}

${TOOL_RULES}

Available tools:
${toolsJson}`.trim()
}
