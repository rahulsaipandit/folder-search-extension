/**
 * Native skill store — op-sqlite index + Expo FileSystem canonical SKILL.md files.
 * Mirrors the API of packages/cognitiveBrain/extension/src/skills/skill-store.ts (web).
 *
 * Storage layout:
 *   op-sqlite: user_skills table (fast queries, see DatabaseManager.ts for schema)
 *   Expo FileSystem: <documentDirectory>/skills/<name>/SKILL.md  (canonical source)
 *
 * Read / first-open path:
 *   1. Query op-sqlite → non-empty → return directly (fast path)
 *   2. Empty table: scan FileSystem skills/ → parse SKILL.md files → rebuild table
 *   3. Both empty: seed from bundled SKILL.md assets in core/skills/
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { getDatabase } from '../../../../memsoftstore/src/storage/DatabaseManager';
import type { Skill } from './skill-types';
import { exportSkillToSKILLMD, importSkillFromSKILLMD } from './skill-io';
import { BUILT_IN_SKILL_MODULES } from './skill-assets.native';

const SKILLS_DIR = `${FileSystem.documentDirectory}skills/`;

// ─── helpers ────────────────────────────────────────────────────────────────

async function getDb() {
  const { db, initializationPromise } = getDatabase();
  if (!db || !initializationPromise) {
    throw new Error('[skill-store.native] op-sqlite not available on this platform');
  }
  await initializationPromise;
  return db;
}

function rowToSkill(row: any): Skill {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    tags: JSON.parse(row.tags || '[]'),
    instructionBody: row.instruction_body,
    version: row.version,
    author: row.author,
    scoreThreshold: row.score_threshold ?? 0.70,
    isBuiltIn: row.is_built_in === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function skillToParams(skill: Skill, now: number): any[] {
  return [
    skill.id,
    skill.name,
    skill.displayName,
    skill.description,
    JSON.stringify(skill.tags),
    skill.instructionBody,
    skill.version,
    skill.author,
    skill.scoreThreshold ?? 0.70,
    skill.isBuiltIn ? 1 : 0,
    skill.createdAt || now,
    now,
  ];
}

/**
 * Load built-in SKILL.md files from Metro-bundled assets.
 * Asset content is read via expo-asset + expo-file-system so no TypeScript
 * strings are needed — SKILL.md files in core/skills/ are the sole source.
 */
async function loadBuiltInSkillAssets(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const mod of BUILT_IN_SKILL_MODULES) {
    try {
      const asset = Asset.fromModule(mod);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) continue;
      const content = await FileSystem.readAsStringAsync(uri);
      const skill = importSkillFromSKILLMD(content, { isBuiltIn: true });
      skill.id = `builtin-${skill.name}`;
      skills.push(skill);
    } catch (e) {
      console.warn('[skill-store.native] Failed to load built-in skill asset:', e);
    }
  }
  return skills;
}

async function ensureSkillsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(SKILLS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SKILLS_DIR, { intermediates: true });
  }
}

// ─── public API ─────────────────────────────────────────────────────────────

export async function getAllSkills(): Promise<Skill[]> {
  const db = await getDb();
  const result = await db.execute('SELECT * FROM user_skills ORDER BY updated_at DESC');
  return (result.rows || []).map(rowToSkill);
}

export async function getSkillById(id: string): Promise<Skill | undefined> {
  const db = await getDb();
  const result = await db.execute('SELECT * FROM user_skills WHERE id = ?', [id]);
  const row = result.rows?.[0];
  return row ? rowToSkill(row) : undefined;
}

export async function getSkillByName(name: string): Promise<Skill | undefined> {
  const db = await getDb();
  const result = await db.execute('SELECT * FROM user_skills WHERE name = ?', [name]);
  const row = result.rows?.[0];
  return row ? rowToSkill(row) : undefined;
}

export async function saveSkill(skill: Skill): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `INSERT OR REPLACE INTO user_skills
       (id, name, display_name, description, tags, instruction_body,
        version, author, score_threshold, is_built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    skillToParams(skill, now)
  );

  // Write-through to FileSystem so canonical SKILL.md stays in sync (non-fatal)
  try {
    await ensureSkillsDir();
    const dir = `${SKILLS_DIR}${skill.name}/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(
      `${dir}SKILL.md`,
      exportSkillToSKILLMD({ ...skill, updatedAt: now })
    );
  } catch (e) {
    console.warn('[skill-store.native] FileSystem write-through failed (non-fatal):', e);
  }
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDb();

  // Grab name before deleting so we can remove the FileSystem directory
  const result = await db.execute('SELECT name FROM user_skills WHERE id = ?', [id]);
  const nameRow = result.rows?.[0];
  const name: string | undefined = nameRow?.name != null ? String(nameRow.name) : undefined;

  await db.execute('DELETE FROM user_skills WHERE id = ?', [id]);

  if (name) {
    try {
      const dir = `${SKILLS_DIR}${name}/`;
      const info = await FileSystem.getInfoAsync(dir);
      if (info.exists) {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      }
    } catch (e) {
      console.warn('[skill-store.native] FileSystem delete failed (non-fatal):', e);
    }
  }
}

/**
 * Rebuild the op-sqlite index by scanning FileSystem skills/.
 * Called when the table is empty but a previous install may have left SKILL.md files.
 */
async function rebuildIndexFromFileSystem(): Promise<Skill[]> {
  try {
    const info = await FileSystem.getInfoAsync(SKILLS_DIR);
    if (!info.exists) return [];

    const entries = await FileSystem.readDirectoryAsync(SKILLS_DIR);
    const skills: Skill[] = [];

    for (const entry of entries) {
      try {
        const mdPath = `${SKILLS_DIR}${entry}/SKILL.md`;
        const mdInfo = await FileSystem.getInfoAsync(mdPath);
        if (!mdInfo.exists) continue;
        const md = await FileSystem.readAsStringAsync(mdPath);
        skills.push(importSkillFromSKILLMD(md));
      } catch {
        // Skip malformed entries
      }
    }

    if (skills.length === 0) return [];

    const db = await getDb();
    const now = Date.now();
    for (const s of skills) {
      await db.execute(
        `INSERT OR REPLACE INTO user_skills
           (id, name, display_name, description, tags, instruction_body,
            version, author, score_threshold, is_built_in, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        skillToParams(s, now)
      );
    }

    return skills;
  } catch (e) {
    console.warn('[skill-store.native] rebuildIndexFromFileSystem failed:', e);
    return [];
  }
}

/**
 * Return all skills, seeding defaults on first install.
 * Priority:
 *   1. op-sqlite (fast path)
 *   2. FileSystem scan + rebuild
 *   3. Bundled SKILL.md assets — fresh install (see skill-assets.native.ts)
 */
export async function getOrSeedSkills(): Promise<Skill[]> {
  const db = await getDb();
  const existing = await db.execute('SELECT * FROM user_skills ORDER BY updated_at DESC');
  const rows: any[] = existing.rows || [];

  if (rows.length > 0) return rows.map(rowToSkill);

  // Try recovering from FileSystem before falling back to hard-coded defaults
  const fromFS = await rebuildIndexFromFileSystem();
  if (fromFS.length > 0) return fromFS;

  // Fresh install: load from bundled SKILL.md assets, seed to op-sqlite + FileSystem
  const builtIns = await loadBuiltInSkillAssets();
  const now = Date.now();
  for (const s of builtIns) {
    await db.execute(
      `INSERT OR REPLACE INTO user_skills
         (id, name, display_name, description, tags, instruction_body,
          version, author, score_threshold, is_built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      skillToParams(s, now)
    );
  }

  // Mirror to FileSystem (non-fatal) — gives the file-scan recovery path something to work with
  try {
    await ensureSkillsDir();
    await Promise.all(
      builtIns.map(async (s) => {
        try {
          const dir = `${SKILLS_DIR}${s.name}/`;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          await FileSystem.writeAsStringAsync(`${dir}SKILL.md`, exportSkillToSKILLMD(s));
        } catch (e) {
          console.warn(`[skill-store.native] FileSystem seed failed for ${s.name} (non-fatal):`, e);
        }
      })
    );
  } catch (e) {
    console.warn('[skill-store.native] FileSystem seed pass failed (non-fatal):', e);
  }

  return builtIns.map((s) => ({ ...s, createdAt: now, updatedAt: now }));
}

/** @deprecated Use getOrSeedSkills() at call sites that need seeding. */
export async function seedDefaultSkills(): Promise<void> {
  await getOrSeedSkills();
}
