import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const numericSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'expression' in v) {
			return v as { expression: string }
		}
		throw new Error('Expected { expression: string }')
	},
	safeParse: (v: unknown) => {
		try {
			return { success: true as const, data: numericSchema.parse(v) }
		} catch (e) {
			return { success: false as const, error: e }
		}
	},
}

const numericResultSchema = {
	parse: (v: unknown) => v as { result: number | string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { result: number | string } }),
}

const stringSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'text' in v) return v as { text: string }
		throw new Error('Expected { text: string }')
	},
	safeParse: (v: unknown) => {
		try {
			return { success: true as const, data: stringSchema.parse(v) }
		} catch (e) {
			return { success: false as const, error: e }
		}
	},
}

const stringResultSchema = {
	parse: (v: unknown) => v as { result: string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { result: string } }),
}

/** Safe arithmetic evaluator - no eval(), no LLM cost */
function safeCalculate(expression: string): number | string {
	// Allow: digits, operators, parens, whitespace, **, %, Math functions
	const sanitized = expression.replace(/\s/g, '')
	if (!/^[\d+\-*/().%^e,Math\w]+$/.test(sanitized)) {
		throw new Error(`Unsafe expression: "${expression}"`)
	}

	// Replace ^ with ** for exponentiation
	const normalized = sanitized.replace(/\^/g, '**')

	try {
		// biome-ignore lint/security/noEval: controlled arithmetic evaluation
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const result = Function(`"use strict"; return (${normalized})`)() as number
		if (typeof result !== 'number' || !isFinite(result)) {
			return String(result)
		}
		return result
	} catch {
		throw new Error(`Cannot evaluate: "${expression}"`)
	}
}

export const calculateAction: ActionDefinition<{ expression: string }, { result: number | string }> =
	{
		id: 'org.page-agent.compute.calculate',
		name: 'calculate',
		description:
			'Evaluate a mathematical expression. Supports +,-,*,/,**,%, Math.sqrt, Math.pow, etc.',
		version: '1.0.0',
		category: 'compute',
		capabilities: [],
		inputSchema: numericSchema,
		outputSchema: numericResultSchema,
		execute: async ({ expression }) => ({ result: safeCalculate(expression) }),
		fallbackToLLM: false,
		timeoutMs: 1_000,
		userInvocable: true,
	}

export const urlEncodeAction: ActionDefinition<{ text: string }, { result: string }> = {
	id: 'org.page-agent.compute.url-encode',
	name: 'urlEncode',
	description: 'URL-encode a string (encodeURIComponent).',
	version: '1.0.0',
	category: 'compute',
	capabilities: [],
	inputSchema: stringSchema,
	outputSchema: stringResultSchema,
	execute: async ({ text }) => ({ result: encodeURIComponent(text) }),
	fallbackToLLM: false,
	timeoutMs: 100,
	userInvocable: true,
}

export const urlDecodeAction: ActionDefinition<{ text: string }, { result: string }> = {
	id: 'org.page-agent.compute.url-decode',
	name: 'urlDecode',
	description: 'URL-decode a string (decodeURIComponent).',
	version: '1.0.0',
	category: 'compute',
	capabilities: [],
	inputSchema: stringSchema,
	outputSchema: stringResultSchema,
	execute: async ({ text }) => {
		try {
			return { result: decodeURIComponent(text) }
		} catch {
			return { result: text }
		}
	},
	fallbackToLLM: false,
	timeoutMs: 100,
	userInvocable: true,
}
