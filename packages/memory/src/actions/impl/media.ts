import type { ActionDefinition } from '../../interfaces/IActionRegistry'

const svgSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'svg' in v) return v as { svg: string }
		throw new Error('Expected { svg: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: svgSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const colorNameSchema = {
	parse: (v: unknown) => {
		if (typeof v === 'object' && v !== null && 'name' in v) return v as { name: string }
		throw new Error('Expected { name: string }')
	},
	safeParse: (v: unknown) => {
		try { return { success: true as const, data: colorNameSchema.parse(v) } }
		catch (e) { return { success: false as const, error: e } }
	},
}

const svgResultSchema = {
	parse: (v: unknown) => v as { svg: string; safe: boolean; issues: string[] },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { svg: string; safe: boolean; issues: string[] } }),
}

const colorResultSchema = {
	parse: (v: unknown) => v as { hex: string; rgb: [number, number, number]; name: string },
	safeParse: (v: unknown) => ({ success: true as const, data: v as { hex: string; rgb: [number, number, number]; name: string } }),
}

/** Basic SVG sanitization - removes script, event handlers, foreign objects */
function sanitizeSvg(svg: string): { svg: string; issues: string[] } {
	const issues: string[] = []

	const safe = svg
		.replace(/<script[\s\S]*?<\/script>/gi, () => { issues.push('Removed <script>'); return '' })
		.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, () => { issues.push('Removed <foreignObject>'); return '' })
		.replace(/\son\w+="[^"]*"/gi, (m) => { issues.push(`Removed event: ${m.slice(1, 10)}`); return '' })
		.replace(/href="javascript:[^"]*"/gi, () => { issues.push('Removed javascript: href'); return '' })

	return { svg: safe, issues }
}

// Named CSS colors subset (common ones)
const CSS_COLORS: Record<string, [number, number, number]> = {
	red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
	white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128],
	grey: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0],
	purple: [128, 0, 128], pink: [255, 192, 203], brown: [165, 42, 42],
	cyan: [0, 255, 255], magenta: [255, 0, 255], lime: [0, 255, 0],
	navy: [0, 0, 128], teal: [0, 128, 128], silver: [192, 192, 192],
	gold: [255, 215, 0], indigo: [75, 0, 130], violet: [238, 130, 238],
	coral: [255, 127, 80], salmon: [250, 128, 114], khaki: [240, 230, 140],
	crimson: [220, 20, 60], turquoise: [64, 224, 208], wheat: [245, 222, 179],
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export const svgProcessorAction: ActionDefinition<
	{ svg: string },
	{ svg: string; safe: boolean; issues: string[] }
> = {
	id: 'org.page-agent.media.svg-processor',
	name: 'svgProcessor',
	description: 'Sanitize SVG markup - removes scripts, event handlers, and foreign objects.',
	version: '1.0.0',
	category: 'media',
	capabilities: [],
	inputSchema: svgSchema,
	outputSchema: svgResultSchema,
	execute: async ({ svg }) => {
		const { svg: safe, issues } = sanitizeSvg(svg)
		return { svg: safe, safe: issues.length === 0, issues }
	},
	fallbackToLLM: false,
	timeoutMs: 500,
	userInvocable: false,
}

export const colorLookupAction: ActionDefinition<
	{ name: string },
	{ hex: string; rgb: [number, number, number]; name: string }
> = {
	id: 'org.page-agent.media.color-lookup',
	name: 'colorLookup',
	description: 'Look up a CSS color name and return its hex and RGB values.',
	version: '1.0.0',
	category: 'media',
	capabilities: [],
	inputSchema: colorNameSchema,
	outputSchema: colorResultSchema,
	execute: async ({ name }) => {
		const key = name.toLowerCase().trim()
		const rgb = CSS_COLORS[key]
		if (!rgb) throw new Error(`Unknown color: "${name}"`)
		return { hex: rgbToHex(...rgb), rgb, name: key }
	},
	fallbackToLLM: false,
	timeoutMs: 100,
	userInvocable: true,
}
