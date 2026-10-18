import { exportSkillToSKILLMD, importSkillFromSKILLMD } from '@page-agent/core/skills'
import type { Skill } from '@page-agent/core/skills'
import { getOPFSStorage, isOPFSSupported } from '@page-agent/core/storage'

import { getDB } from '../lib/db'

// Vite bundles all SKILL.md files in core/skills/ as raw strings at build time.
// Adding a new skill folder there is all that's needed — no TypeScript changes required.
const builtInSkillFiles: Record<string, string> = import.meta.glob(
	'../../../core/skills/*/SKILL.md',
	{ query: '?raw', import: 'default', eager: true }
)

// Bundled reference files (references/*.md) are optional per skill and are attached to
// the Skill object but never inlined into the prompt — see buildSkillTaskPrefix() and the
// "org.page-agent.skills.read-reference" action, which reads them from this same data on demand.
const builtInReferenceFiles: Record<string, string> = import.meta.glob(
	'../../../core/skills/*/references/*.md',
	{ query: '?raw', import: 'default', eager: true }
)

/** Extracts "<skill-name>" and "references/<file>.md" from a glob key like
 * "../../../core/skills/college-essay-counselor/references/uc-piq-basics.md". */
function parseReferencePath(globKey: string): { skillName: string; path: string } | null {
	const match = globKey.match(/core\/skills\/([^/]+)\/(references\/[^/]+\.md)$/)
	if (!match) return null
	return { skillName: match[1], path: match[2] }
}

function loadBuiltInSkills(): Skill[] {
	const referencesBySkill = new Map<string, { path: string; content: string }[]>()
	for (const [globKey, content] of Object.entries(builtInReferenceFiles)) {
		const parsed = parseReferencePath(globKey)
		if (!parsed) continue
		const list = referencesBySkill.get(parsed.skillName) ?? []
		list.push({ path: parsed.path, content })
		referencesBySkill.set(parsed.skillName, list)
	}

	return Object.entries(builtInSkillFiles).map(([, content]) => {
		const skill = importSkillFromSKILLMD(content, { isBuiltIn: true })
		skill.id = `builtin-${skill.name}`
		const referenceFiles = referencesBySkill.get(skill.name)
		if (referenceFiles && referenceFiles.length > 0) {
			skill.referenceFiles = referenceFiles
		}
		return skill
	})
}

export async function getSkillByName(name: string): Promise<Skill | undefined> {
	const db = await getDB()
	return db.getFromIndex('user_skills', 'by-name', name) as Promise<Skill | undefined>
}

export async function getAllSkills(): Promise<Skill[]> {
	const db = await getDB()
	return db.getAll('user_skills') as Promise<Skill[]>
}

export async function getSkillById(id: string): Promise<Skill | undefined> {
	const db = await getDB()
	return db.get('user_skills', id) as Promise<Skill | undefined>
}

export async function saveSkill(skill: Skill): Promise<void> {
	const db = await getDB()
	const record = { ...skill, updatedAt: Date.now() }
	await db.put('user_skills', record as any)

	// Write-through to OPFS so the canonical SKILL.md stays in sync
	if (isOPFSSupported()) {
		try {
			const opfs = getOPFSStorage()
			await opfs.writeFile(`skills/${skill.name}`, 'SKILL.md', exportSkillToSKILLMD(record))
		} catch (e) {
			console.warn('[skill-store] OPFS write-through failed (non-fatal):', e)
		}
	}
}

export async function deleteSkill(id: string): Promise<void> {
	const db = await getDB()
	const skill = (await db.get('user_skills', id)) as Skill | undefined
	await db.delete('user_skills', id)

	if (skill && isOPFSSupported()) {
		try {
			await getOPFSStorage().deleteNamespace(`skills/${skill.name}`)
		} catch (e) {
			console.warn('[skill-store] OPFS delete failed (non-fatal):', e)
		}
	}
}

/**
 * Rebuild the IndexedDB index by scanning OPFS skills/.
 * Called when IndexedDB is empty but OPFS may have skills from a previous install or migration.
 */
async function rebuildIndexFromOPFS(): Promise<Skill[]> {
	if (!isOPFSSupported()) return []
	const opfs = getOPFSStorage()
	let dirs: string[]
	try {
		dirs = await opfs.listEntries('skills')
	} catch {
		return [] // 'skills' namespace does not exist yet
	}

	const skills: Skill[] = []
	for (const dir of dirs) {
		try {
			const md = await opfs.readFileAsText(`skills/${dir}`, 'SKILL.md')
			const skill = importSkillFromSKILLMD(md)
			skills.push(skill)
		} catch {
			// Skip malformed entries
		}
	}

	if (skills.length === 0) return []

	const db = await getDB()
	const now = Date.now()
	const tx = db.transaction('user_skills', 'readwrite')
	await Promise.all([
		...skills.map((s) =>
			tx.store.put({ ...s, createdAt: s.createdAt || now, updatedAt: now } as any)
		),
		tx.done,
	])
	return skills
}

/**
 * Return all skills, seeding defaults on first install.
 * Order of priority:
 *   1. IndexedDB — fast path (non-empty means already initialised)
 *   2. OPFS — migration/recovery path (scan + rebuild index)
 *   3. Bundled SKILL.md assets — fresh install
 */
export async function getOrSeedSkills(): Promise<Skill[]> {
	const db = await getDB()
	const existing = (await db.getAll('user_skills')) as Skill[]
	if (existing.length > 0) return existing

	// Try recovering from OPFS before falling back to hard-coded defaults
	const fromOPFS = await rebuildIndexFromOPFS()
	if (fromOPFS.length > 0) return fromOPFS

	// Fresh install: seed from bundled SKILL.md files (source of truth in core/skills/)
	const builtIns = loadBuiltInSkills()
	const now = Date.now()
	const tx = db.transaction('user_skills', 'readwrite')
	await Promise.all([
		...builtIns.map((s) => tx.store.put({ ...s, createdAt: now, updatedAt: now } as any)),
		tx.done,
	])

	if (isOPFSSupported()) {
		const opfs = getOPFSStorage()
		await Promise.all(
			builtIns.map((s) =>
				opfs
					.writeFile(`skills/${s.name}`, 'SKILL.md', exportSkillToSKILLMD(s))
					.catch((e) =>
						console.warn(`[skill-store] OPFS seed failed for ${s.name} (non-fatal):`, e)
					)
			)
		)
	}

	return builtIns.map((s) => ({ ...s, createdAt: now, updatedAt: now }))
}

/** @deprecated Use getOrSeedSkills() at call sites that need seeding. */
export async function seedDefaultSkills(): Promise<void> {
	await getOrSeedSkills()
}
