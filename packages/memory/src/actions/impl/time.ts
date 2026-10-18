import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const tzSchema = {
	parse: (v: unknown) => (v ?? {}) as { timezone?: string },
	safeParse: (v: unknown) => ({ success: true as const, data: (v ?? {}) as { timezone?: string } }),
}

const emptySchema = {
	parse: (v: unknown) => (v ?? {}) as Record<string, never>,
	safeParse: (v: unknown) => ({ success: true as const, data: (v ?? {}) as Record<string, never> }),
}

const timestampSchema = {
	parse: (v: unknown) => v as { iso: string; unix: number; humanUtc: string; timezone: string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { iso: string; unix: number; humanUtc: string; timezone: string } }),
}

const epochSchema = {
	parse: (v: unknown) => v as { epochMs: number; epochSec: number; humanUtc: string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { epochMs: number; epochSec: number; humanUtc: string } }),
}

export const currentTimeAction: ActionDefinition<
	{ timezone?: string },
	{ iso: string; unix: number; humanUtc: string; timezone: string }
> = {
	id: 'org.page-agent.time.current',
	name: 'currentTime',
	description: 'Return current date and time. Optional IANA timezone (e.g. "America/New_York").',
	version: '1.0.0',
	category: 'time',
	capabilities: [],
	inputSchema: tzSchema,
	outputSchema: timestampSchema,
	execute: async ({ timezone }) => {
		const now = new Date()
		const tz = timezone ?? 'UTC'
		const humanUtc = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'long', timeStyle: 'medium' })
		return {
			iso: now.toISOString(),
			unix: Math.floor(now.getTime() / 1000),
			humanUtc,
			timezone: tz,
		}
	},
	fallbackToLLM: false,
	timeoutMs: 100,
	userInvocable: true,
}

export const epochTimeAction: ActionDefinition<
	Record<string, never>,
	{ epochMs: number; epochSec: number; humanUtc: string }
> = {
	id: 'org.page-agent.time.epoch',
	name: 'epochTime',
	description: 'Return current Unix epoch milliseconds and seconds.',
	version: '1.0.0',
	category: 'time',
	capabilities: [],
	inputSchema: emptySchema,
	outputSchema: epochSchema,
	execute: async () => {
		const now = Date.now()
		return {
			epochMs: now,
			epochSec: Math.floor(now / 1000),
			humanUtc: new Date(now).toUTCString(),
		}
	},
	fallbackToLLM: false,
	timeoutMs: 100,
	userInvocable: true,
}
