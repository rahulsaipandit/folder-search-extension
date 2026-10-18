import type { ActionDefinition } from '../../interfaces/IActionRegistry'

// Generic browser action schema builder
function browserActionSchema<T>(fields: string[]) {
	return {
		parse: (v: unknown): T => {
			if (typeof v !== 'object' || v === null) throw new Error('Expected object')
			for (const f of fields) {
				if (!(f in v)) throw new Error(`Missing field: ${f}`)
			}
			return v as T
		},
		safeParse: (v: unknown) => {
			try { return { success: true as const, data: browserActionSchema<T>(fields).parse(v) } }
			catch (e) { return { success: false as const, error: e } }
		},
	}
}

const voidSchema = {
	parse: (v: unknown) => v as { success: boolean; message?: string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { success: boolean; message?: string } }),
}

function browserUnavailable(action: string): { success: boolean; message: string } {
	return { success: false, message: `Browser action "${action}" requires browser extension context.` }
}

export const clickAction: ActionDefinition<
	{ selector: string; tabId?: number },
	{ success: boolean; message?: string }
> = {
	id: 'org.page-agent.browser.click',
	name: 'click',
	description: 'Click a DOM element matching the given CSS selector.',
	version: '1.0.0',
	category: 'browser',
	capabilities: ['scripting', 'tabs'],
	inputSchema: browserActionSchema(['selector']),
	outputSchema: voidSchema,
	execute: async ({ selector }) => {
		if (typeof document !== 'undefined') {
			const el = document.querySelector(selector)
			if (!el) return { success: false, message: `No element found: "${selector}"` }
			;(el as HTMLElement).click()
			return { success: true }
		}
		return browserUnavailable('click')
	},
	fallbackToLLM: false,
	timeoutMs: 5_000,
	userInvocable: true,
}

export const fillAction: ActionDefinition<
	{ selector: string; value: string; tabId?: number },
	{ success: boolean; message?: string }
> = {
	id: 'org.page-agent.browser.fill',
	name: 'fill',
	description: 'Fill an input field matching the CSS selector with a value.',
	version: '1.0.0',
	category: 'browser',
	capabilities: ['scripting', 'tabs'],
	inputSchema: browserActionSchema(['selector', 'value']),
	outputSchema: voidSchema,
	execute: async ({ selector, value }) => {
		if (typeof document !== 'undefined') {
			const el = document.querySelector(selector) as HTMLInputElement | null
			if (!el) return { success: false, message: `No element found: "${selector}"` }
			el.value = value
			el.dispatchEvent(new Event('input', { bubbles: true }))
			el.dispatchEvent(new Event('change', { bubbles: true }))
			return { success: true }
		}
		return browserUnavailable('fill')
	},
	fallbackToLLM: false,
	timeoutMs: 5_000,
	userInvocable: true,
}

export const scrollAction: ActionDefinition<
	{ direction?: 'up' | 'down'; pages?: number; selector?: string },
	{ success: boolean; scrolledBy?: number }
> = {
	id: 'org.page-agent.browser.scroll',
	name: 'scroll',
	description: 'Scroll the page up or down by a number of viewport pages.',
	version: '1.0.0',
	category: 'browser',
	capabilities: ['scripting'],
	inputSchema: {
		parse: (v: unknown) => (v ?? {}) as { direction?: 'up' | 'down'; pages?: number; selector?: string },
		safeParse: (v: unknown) => ({ success: true as const, data: (v ?? {}) as { direction?: 'up' | 'down'; pages?: number; selector?: string } }),
	},
	outputSchema: {
		parse: (v: unknown) => v as { success: boolean; scrolledBy?: number },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { success: boolean; scrolledBy?: number } }),
	},
	execute: async ({ direction = 'down', pages = 1 }) => {
		if (typeof window !== 'undefined') {
			const amount = window.innerHeight * pages * (direction === 'down' ? 1 : -1)
			window.scrollBy({ top: amount, behavior: 'smooth' })
			return { success: true, scrolledBy: amount }
		}
		return { success: false }
	},
	fallbackToLLM: false,
	timeoutMs: 2_000,
	userInvocable: true,
}

export const navigateAction: ActionDefinition<
	{ url: string },
	{ success: boolean; url?: string }
> = {
	id: 'org.page-agent.browser.navigate',
	name: 'navigate',
	description: 'Navigate the current tab to a URL.',
	version: '1.0.0',
	category: 'browser',
	capabilities: ['tabs'],
	inputSchema: browserActionSchema(['url']),
	outputSchema: {
		parse: (v: unknown) => v as { success: boolean; url?: string },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { success: boolean; url?: string } }),
	},
	execute: async ({ url }) => {
		if (typeof window !== 'undefined') {
			window.location.href = url
			return { success: true, url }
		}
		return { success: false }
	},
	fallbackToLLM: false,
	timeoutMs: 5_000,
	userInvocable: true,
}

export const extractTextAction: ActionDefinition<
	{ selector?: string },
	{ text: string; wordCount: number }
> = {
	id: 'org.page-agent.browser.extract-text',
	name: 'extractText',
	description: 'Extract visible text from the page or a specific element.',
	version: '1.0.0',
	category: 'browser',
	capabilities: ['scripting'],
	inputSchema: {
		parse: (v: unknown) => (v ?? {}) as { selector?: string },
		safeParse: (v: unknown) => ({ success: true as const, data: (v ?? {}) as { selector?: string } }),
	},
	outputSchema: {
		parse: (v: unknown) => v as { text: string; wordCount: number },
		safeParse: (v: unknown) => ({ success: true as const, data: v as { text: string; wordCount: number } }),
	},
	execute: async ({ selector }) => {
		if (typeof document !== 'undefined') {
			const el = selector ? document.querySelector(selector) : document.body
			const text = (el as HTMLElement | null)?.innerText ?? ''
			return { text, wordCount: text.split(/\s+/).filter(Boolean).length }
		}
		return { text: '', wordCount: 0 }
	},
	fallbackToLLM: false,
	timeoutMs: 2_000,
	userInvocable: true,
}
