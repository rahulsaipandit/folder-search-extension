import type { ActionContext, ActionDefinition } from '../interfaces/IActionRegistry'
import type { ActionMeta } from '../types'

export type { ActionContext, ActionDefinition, ActionMeta }

/** Version resolution - parse semver string into comparable parts */
export interface SemVer {
	major: number
	minor: number
	patch: number
	raw: string
}

export function parseSemVer(version: string): SemVer {
	const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
	return { major, minor, patch, raw: version }
}

export function compareSemVer(a: SemVer, b: SemVer): number {
	if (a.major !== b.major) return a.major - b.major
	if (a.minor !== b.minor) return a.minor - b.minor
	return a.patch - b.patch
}

/** Action file parsed result */
export interface ParsedActionFile {
	id: string
	name: string
	description: string
	version: string
	category: string
	allowedTools: string[]
	disableModelInvocation: boolean
	userInvocable: boolean
	body: string
}
