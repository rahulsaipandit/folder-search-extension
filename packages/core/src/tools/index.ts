/**
 * Internal tools for PageAgent.
 * @note Adapted from browser-use
 * @note Fork customizations: form-autofill tools (detect_form_fields, fill_form_field,
 * submit_form) for job-application autofill, and cost/error-classification bookkeeping
 * consumed by PageAgentCore. See git history for the detailed rationale.
 */
import * as z from 'zod/v4'

import type { PageAgentCore } from '../PageAgentCore'
import { waitFor } from '../utils'

/**
 * Per-invocation context passed to every tool execution.
 * Tools MUST honor `signal` to support cooperative cancellation.
 */
export interface ToolContext {
	signal: AbortSignal
}

/**
 * Internal tool definition that has access to PageAgent `this` context
 */
export interface PageAgentTool<TParams = any> {
	// name: string
	description: string
	inputSchema: z.ZodType<TParams>
	execute: (this: PageAgentCore, args: TParams, ctx: ToolContext) => Promise<string>
}

export function tool<TParams>(options: PageAgentTool<TParams>): PageAgentTool<TParams> {
	return options
}

/**
 * Internal tools for PageAgent.
 * Note: Using any to allow different parameter types for each tool
 */
export const tools = new Map<string, PageAgentTool>()

tools.set(
	'done',
	tool({
		description:
			'Complete the current task and return a final response. Use this ONLY when you have fully achieved the user\'s goal, or when you cannot proceed further. The "success" field should be true only if the task was completed successfully; set to false if the task could not be completed. The "text" field is your final response - keep it concise unless the user explicitly asks for detail. Do NOT call this tool unless the task is truly finished.',
		inputSchema: z.object({
			text: z.string(),
			success: z.boolean().default(true),
		}),
		execute: async function (this: PageAgentCore, input) {
			// @note main loop will handle this one
			return Promise.resolve('Task completed')
		},
	})
)

tools.set(
	'wait',
	tool({
		description: 'Wait for x seconds. Can be used to wait until the page or data is fully loaded.',
		inputSchema: z.object({
			seconds: z.number().min(1).max(10).default(1),
		}),
		execute: async function (this: PageAgentCore, input, { signal }) {
			// try to subtract LLM calling time from the actual wait time
			const lastTimeUpdate = await this.pageController.getLastUpdateTime()
			const secondsSinceLastUpdate = (Date.now() - lastTimeUpdate) / 1000
			const actualWaitTime = Math.max(0, input.seconds - secondsSinceLastUpdate)
			console.log(`actualWaitTime: ${actualWaitTime} seconds`)
			await waitFor(actualWaitTime, signal)

			const waitedSeconds = (secondsSinceLastUpdate + actualWaitTime).toFixed(2)
			return `✅ Waited for ${waitedSeconds} seconds.`
		},
	})
)

tools.set(
	'ask_user',
	tool({
		description:
			'Ask the user a question and wait for their answer. Use this if you need more information or clarification.',
		inputSchema: z.object({
			question: z.string(),
		}),
		execute: async function (this: PageAgentCore, input, { signal }) {
			if (!this.onAskUser) {
				throw new Error('ask_user tool requires onAskUser callback to be set')
			}
			const answer = await this.onAskUser(input.question, { signal })
			return `User answered: ${answer}`
		},
	})
)

tools.set(
	'click_element_by_index',
	tool({
		description:
			'Click on an interactive element on the page identified by its numeric index. The index corresponds to the numbered elements shown in the page content (e.g., [1], [2], [3]). Use this to click buttons, links, checkboxes, radio buttons, or any clickable element. NOT for text input fields - use input_text for those. If the click causes a navigation, wait() afterward for the page to load.',
		inputSchema: z.object({
			index: z.int().min(0),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.clickElement(input.index)
			return result.message
		},
	})
)

tools.set(
	'input_text',
	tool({
		description:
			'Type text into an input field or textarea identified by its numeric index. Use this for form fields, search boxes, text areas, or any editable text element. The field will be clicked first to focus it, then the text will be typed. To clear a field before typing, include the desired value directly. If you need to select from a dropdown, use select_dropdown_option instead.',
		inputSchema: z.object({
			index: z.int().min(0),
			text: z.string(),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.inputText(input.index, input.text)
			return result.message
		},
	})
)

tools.set(
	'select_dropdown_option',
	tool({
		description:
			'Select an option from a dropdown/select element identified by its numeric index. The text parameter is the visible label text of the option you want to select, not the value attribute. Use this ONLY for <select> elements or custom dropdown widgets. For regular input fields, use input_text instead.',
		inputSchema: z.object({
			index: z.int().min(0),
			text: z.string(),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.selectOption(input.index, input.text)
			return result.message
		},
	})
)

/**
 * @note Reference from browser-use
 */
tools.set(
	'scroll',
	tool({
		description:
			'Scroll the page vertically to view content that is currently off-screen. Use "down: true" to scroll down, "down: false" to scroll up. Control scroll distance with num_pages (fraction of viewport, default 0.1) or pixels (exact pixel amount). If num_pages is 0, no scrolling occurs. Optionally provide "index" to scroll a specific scrollable element (like a dropdown or custom UI container) rather than the main page. For horizontal scrolling within tables, use scroll_horizontally instead.',
		inputSchema: z.object({
			down: z.boolean().default(true),
			num_pages: z.number().min(0).max(10).optional().default(0.1),
			pixels: z.number().int().min(0).optional(),
			index: z.number().int().min(0).optional(),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.scroll({
				...input,
				numPages: input.num_pages,
			})
			return result.message
		},
	})
)

/**
 * @todo Tables need a dedicated parser to extract structured data. This tool is useless.
 */
tools.set(
	'scroll_horizontally',
	tool({
		description:
			'Scroll horizontally within a page or specific element identified by index. Use this when viewing wide data tables or dashboards where content is clipped horizontally. Use "right: true" to scroll right, "right: false" to scroll left. Provide a pixel amount for the scroll distance. If the page has no horizontal overflow, this tool will have no effect.',
		inputSchema: z.object({
			right: z.boolean().default(true),
			pixels: z.number().int().min(0),
			index: z.number().int().min(0).optional(),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.scrollHorizontally(input)
			return result.message
		},
	})
)

tools.set(
	'execute_javascript',
	tool({
		description:
			'Execute arbitrary JavaScript code on the current page. Supports async/await syntax for promises. ⚠️ Use with extreme caution! This bypasses all safe guards and can cause unpredictable side effects. Only use when no other tool can accomplish the goal - for example: reading hidden DOM attributes, triggering custom event handlers, or accessing JavaScript APIs not exposed through the normal page interface. This tool must be explicitly enabled in the agent config (experimentalScriptExecutionTool: true). ' +
			'An `AbortSignal` named `signal` is available in scope: long-running async code MUST honor it ' +
			'(e.g. `await fetch(url, { signal })`, or `signal.throwIfAborted()` in loops)',
		inputSchema: z.object({
			script: z.string(),
		}),
		execute: async function (this: PageAgentCore, input, { signal }) {
			const result = await this.pageController.executeJavascript(input.script, signal)
			signal.throwIfAborted()
			return result.message
		},
	})
)

// ============== Autofill Tools ==============

tools.set(
	'detect_form_fields',
	tool({
		description:
			'Analyze the current page to detect and extract form fields for job applications. Returns structured information about input fields, dropdowns, textareas, and buttons that can be used for autofill. Focuses on form elements likely to be part of job application forms. Use this before attempting to fill out job applications.',
		inputSchema: z.object({
			include_all_forms: z
				.boolean()
				.default(false)
				.describe('Include all forms on page, not just job application forms'),
		}),
		execute: async function (this: PageAgentCore, input) {
			// Update DOM tree to get latest state - this is also what assigns the
			// highlightIndex values that fill_form_field/submit_form expect.
			await this.pageController.updateTree()

			// @note detect_form_fields reads from PageController's own selectorMap
			// (via getFormFields) rather than running a standalone DOM query, so the
			// indices it reports are the *same* highlightIndex space that
			// fill_form_field/submit_form resolve through pageController.inputText()/
			// selectOption()/clickElement(). A separately-computed index (e.g. position
			// within a raw querySelectorAll) would not line up with those.
			const result = await this.pageController.getFormFields(input.include_all_forms)

			if (!result.success) {
				return `❌ Failed to detect form fields: ${result.message}`
			}

			let fields
			try {
				fields = JSON.parse(result.message).fields
			} catch (e) {
				return `❌ Failed to parse form fields: ${e}`
			}
			if (!Array.isArray(fields) || fields.length === 0) {
				return 'ℹ️ No form fields detected on the current page.'
			}

			const humanList = fields
				.map((field: any) => {
					const label = field.label || field.placeholder || field.name || field.fieldType
					const req = field.required ? ' *' : ''
					const opts = field.options?.length
						? ` [${field.options
								.slice(0, 4)
								.map((o: any) => o.text)
								.join(' | ')}${field.options.length > 4 ? ' …' : ''}]`
						: ''
					return `[${field.highlightIndex}] ${label} (${field.fieldType})${req}${opts}`
				})
				.join('\n')

			// FIELDS_DATA marker lets programmatic consumers (e.g. ResumeManager) parse structured
			// field data without screen-scraping the human-readable list above.
			return `✅ Detected ${fields.length} form fields:\n\n${humanList}\n\nFIELDS_DATA:${JSON.stringify({ fields })}`
		},
	})
)

tools.set(
	'fill_form_field',
	tool({
		description:
			'Fill a specific form field identified by its Page Agent highlightIndex with the provided value. Use this for text inputs, textareas, and dropdown selections in job application forms. The field must be identified using detect_form_fields first to get the correct highlightIndex.',
		inputSchema: z.object({
			highlight_index: z.number().min(0).describe('Page Agent highlightIndex of the field to fill'),
			value: z.string().describe('Value to input into the field'),
			field_type: z
				.enum(['text', 'email', 'tel', 'url', 'textarea', 'select'])
				.describe('Type of field being filled'),
		}),
		execute: async function (this: PageAgentCore, input) {
			const { highlight_index, value, field_type } = input

			try {
				if (field_type === 'select') {
					// Use the select dropdown tool
					const result = await this.pageController.selectOption(highlight_index, value)
					return result.message
				} else {
					// Use the input text tool for text fields
					const result = await this.pageController.inputText(highlight_index, value)
					return result.message
				}
			} catch (error) {
				return `❌ Failed to fill form field at index ${highlight_index}: ${error instanceof Error ? error.message : 'Unknown error'}`
			}
		},
	})
)

tools.set(
	'submit_form',
	tool({
		description:
			'Submit a form by clicking the submit button identified by its Page Agent highlightIndex. Use this after filling all required form fields to complete job applications. The button index should be obtained from detect_form_fields.',
		inputSchema: z.object({
			submit_button_index: z
				.number()
				.min(0)
				.describe('Page Agent highlightIndex of the submit button'),
		}),
		execute: async function (this: PageAgentCore, input) {
			const result = await this.pageController.clickElement(input.submit_button_index)
			return result.message
		},
	})
)

// Skills Library integration - lets the LLM call deterministic operations (time, math, etc.)
// via an external ActionInvoker instead of relying on LLM reasoning for precise, repeatable tasks.
tools.set(
	'call_skill',
	tool({
		description:
			'Call a deterministic skill for operations like time retrieval or math calculations. Use this instead of LLM reasoning for precise, repeatable tasks. Available skills depend on the agent configuration.',
		inputSchema: z.object({
			actionId: z
				.string()
				.describe('The ID of the action to call, e.g., "org.page-agent.time.current"'),
			// Flexible record type to accommodate different parameter requirements across skills.
			// Each skill defines its own expected input structure, validated by the skill
			// execution engine against the skill definition before execution.
			input: z
				.record(z.string(), z.any())
				.describe('Input parameters for the action as a JSON object'),
		}),
		execute: async function (this: PageAgentCore, input, { signal }) {
			if (!this.actionInvoker) {
				return '❌ Action invoker not available in this agent configuration'
			}
			try {
				const result = await this.actionInvoker.invoke(input.actionId, input.input, {
					agentId: this.id,
					timestamp: Date.now(),
					signal,
				})
				return `✅ Skill ${input.actionId} executed successfully: ${JSON.stringify(result)}`
			} catch (error) {
				return `❌ Skill ${input.actionId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			}
		},
	})
)

// @todo send_keys
// @todo upload_file
// @todo extract_structured_data
