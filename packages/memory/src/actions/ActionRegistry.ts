import type { IActionRegistry, ActionContext, ActionDefinition } from '../interfaces/IActionRegistry'
import type { ActionMeta } from '../types'
import { compareSemVer, parseSemVer } from './types'

/**
 * ActionRegistry - typed, versioned, deterministic-first skill registry.
 *
 * - Multiple versions of the same skill can coexist
 * - Best semver match is selected on invoke
 * - Always-present skill summary for agent system prompts
 * - SKILL.md filesystem discovery via loadFromDirectory()
 */
export class ActionRegistry implements IActionRegistry {
	// Map<skillId, ActionDefinition[]> - sorted desc by version
	private readonly actions = new Map<string, ActionDefinition[]>()

	register(skill: ActionDefinition): void {
		const existing = this.actions.get(skill.id) ?? []

		// Conflict check: same id + same version
		const conflict = existing.find((s) => s.version === skill.version)
		if (conflict) {
			throw new Error(
				`[ActionRegistry] Skill "${skill.id}" version "${skill.version}" is already registered.`
			)
		}

		existing.push(skill)
		// Keep sorted descending (newest first)
		existing.sort((a, b) => compareSemVer(parseSemVer(b.version), parseSemVer(a.version)))
		this.actions.set(skill.id, existing)
	}

	get(id: string, version?: string): ActionDefinition | undefined {
		const versions = this.actions.get(id)
		if (!versions || versions.length === 0) return undefined

		if (!version) return versions[0] // newest

		// Exact match
		const exact = versions.find((s) => s.version === version)
		if (exact) return exact

		// Best compatible match: parse constraint (e.g. '>=1.0.0', '^1', '~2.3')
		return this.resolveBestMatch(versions, version)
	}

	list(): ActionMeta[] {
		const metas: ActionMeta[] = []
		for (const versions of this.actions.values()) {
			if (versions[0]) {
				const s = versions[0]
				metas.push({
					id: s.id,
					name: s.name,
					description: s.description,
					version: s.version,
					category: s.category,
					fallbackToLLM: s.fallbackToLLM,
					timeoutMs: s.timeoutMs,
					userInvocable: s.userInvocable ?? false,
				})
			}
		}
		return metas
	}

	listByCategory(): Record<string, ActionMeta[]> {
		const result: Record<string, ActionMeta[]> = {}
		for (const meta of this.list()) {
			if (!result[meta.category]) result[meta.category] = []
			result[meta.category]!.push(meta)
		}
		return result
	}

	async invoke(id: string, args: unknown, ctx: ActionContext): Promise<unknown> {
		const skill = this.get(id)
		if (!skill) {
			throw new Error(`[ActionRegistry] Skill "${id}" not found.`)
		}

		// Validate input
		const parseResult = skill.inputSchema.safeParse(args)
		if (!parseResult.success) {
			throw new Error(
				`[ActionRegistry] Invalid args for action "${id}": ${JSON.stringify(parseResult.error)}`
			)
		}

		const validInput = parseResult.data

		// Execute with timeout
		const timeoutMs = skill.timeoutMs ?? (skill.fallbackToLLM ? 30_000 : 5_000)
		try {
			const result = await withTimeout(
				skill.execute(validInput, ctx),
				timeoutMs,
				`Skill "${id}" timed out after ${timeoutMs}ms`
			)

			// Validate output
			const outResult = skill.outputSchema.safeParse(result)
			if (!outResult.success) {
				console.warn(
					`[ActionRegistry] Skill "${id}" output validation failed - returning raw result`
				)
				return result
			}
			return outResult.data
		} catch (err) {
			if (skill.fallbackToLLM && ctx.brainEngine) {
				console.warn(`[ActionRegistry] Skill "${id}" failed, falling back to LLM:`, err)
				const prompt = `Execute: ${id}\nArgs: ${JSON.stringify(validInput)}`
				const thinkResult = await ctx.brainEngine.think(prompt)
				return thinkResult.answer
			}
			throw err
		}
	}

	async loadFromDirectory(_dir: string): Promise<number> {
		// SKILL.md filesystem discovery - uses dynamic import of discovery module
		// Only available in Node.js environment (desktop/build-time)
		try {
			const { discoverActionFiles } = await import('./discovery.js')
			const parsed = await discoverActionFiles(_dir)
			let count = 0
			for (const skillFile of parsed) {
				try {
					// Create a dynamic skill from SKILL.md metadata (no execute function - LLM-only)
					const skill: ActionDefinition = {
						id: skillFile.id,
						name: skillFile.name,
						description: skillFile.description,
						version: skillFile.version,
						category: skillFile.category,
						capabilities: skillFile.allowedTools,
						inputSchema: {
							parse: (v: unknown) => v,
							safeParse: (v: unknown) => ({ success: true, data: v }),
						},
						outputSchema: {
							parse: (v: unknown) => v,
							safeParse: (v: unknown) => ({ success: true, data: v }),
						},
						execute: async (input, ctx) => {
							if (!ctx.brainEngine) throw new Error('LLM required for action.md-only action')
							const result = await ctx.brainEngine.think(
								`Execute action "${skillFile.name}": ${skillFile.body}\nInput: ${JSON.stringify(input)}`
							)
							return result.answer
						},
						fallbackToLLM: !skillFile.disableModelInvocation,
						timeoutMs: 30_000,
						userInvocable: skillFile.userInvocable,
					}
					this.register(skill)
					count++
				} catch (err) {
					console.warn(
						`[ActionRegistry] Failed to register action file "${skillFile.name}":`,
						err
					)
				}
			}
			return count
		} catch {
			// Not in Node environment or discovery module not available
			return 0
		}
	}

	buildActionSummary(): string {
		const byCategory = this.listByCategory()
		const lines: string[] = ['AVAILABLE ACTIONS:']

		for (const [category, skills] of Object.entries(byCategory)) {
			const skillList = skills.map((s) => `${s.name}(...)`).join('  |  ')
			lines.push(`  ${category}: ${skillList}`)
		}

		return lines.join('\n')
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private resolveBestMatch(
		versions: ActionDefinition[],
		constraint: string
	): ActionDefinition | undefined {
		// Simple constraint parsing: >=, ^, ~, exact
		const gte = constraint.startsWith('>=')
		const caret = constraint.startsWith('^')
		const tilde = constraint.startsWith('~')

		const versionStr = constraint.replace(/^[>=^~]+/, '')
		const target = parseSemVer(versionStr)

		for (const skill of versions) {
			const v = parseSemVer(skill.version)
			if (gte && compareSemVer(v, target) >= 0) return skill
			if (caret && v.major === target.major && compareSemVer(v, target) >= 0) return skill
			if (tilde && v.major === target.major && v.minor === target.minor && v.patch >= target.patch)
				return skill
		}

		return versions[0] // Fallback to newest
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms)
		promise.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e instanceof Error ? e : new Error(String(e)))
			}
		)
	})
}
