/**
 * Web skill store — localStorage index + expo-asset SKILL.md loading.
 * Mirrors the API of skill-store.native.ts (op-sqlite + Expo FileSystem).
 *
 * Storage layout:
 *   localStorage key "cognitiveBrain:user_skills_v1" → JSON Record<id, Skill>
 *
 * Built-in skill content is loaded from Metro-bundled .md assets via
 * expo-asset (cross-platform) + fetch(), so core/skills/ remains the
 * single source of truth on both platforms.
 */

import { Asset } from 'expo-asset';
import type { Skill } from './skill-types';
import { importSkillFromSKILLMD } from './skill-io';
import { BUILT_IN_SKILL_MODULES } from './skill-assets.web';

const STORAGE_KEY = 'cognitiveBrain:user_skills_v1';

// ─── localStorage helpers ────────────────────────────────────────────────────

function readStore(): Record<string, Skill> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, Skill>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[skill-store.web] localStorage write failed (non-fatal):', e);
  }
}

// ─── built-in asset loading ──────────────────────────────────────────────────

async function loadBuiltInSkillAssets(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const mod of BUILT_IN_SKILL_MODULES) {
    try {
      const asset = Asset.fromModule(mod);
      await asset.downloadAsync();
      const uri = asset.uri;
      if (!uri) continue;
      const res = await fetch(uri);
      const content = await res.text();
      const skill = importSkillFromSKILLMD(content, { isBuiltIn: true });
      skill.id = `builtin-${skill.name}`;
      skills.push(skill);
    } catch (e) {
      console.warn('[skill-store.web] Failed to load built-in skill asset:', e);
    }
  }
  return skills;
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function getAllSkills(): Promise<Skill[]> {
  return Object.values(readStore());
}

export async function getSkillById(id: string): Promise<Skill | undefined> {
  return readStore()[id];
}

export async function getSkillByName(name: string): Promise<Skill | undefined> {
  return Object.values(readStore()).find((s) => s.name === name);
}

export async function saveSkill(skill: Skill): Promise<void> {
  const store = readStore();
  store[skill.id] = { ...skill, updatedAt: Date.now() };
  writeStore(store);
}

export async function deleteSkill(id: string): Promise<void> {
  const store = readStore();
  delete store[id];
  writeStore(store);
}

/**
 * Return all skills, seeding built-ins on first load.
 * Priority:
 *   1. localStorage (fast path — already initialised)
 *   2. Bundle .md assets — fresh session / cleared storage
 */
export async function getOrSeedSkills(): Promise<Skill[]> {
  const existing = Object.values(readStore());
  if (existing.length > 0) return existing;

  const builtIns = await loadBuiltInSkillAssets();
  const now = Date.now();
  const store: Record<string, Skill> = {};
  for (const s of builtIns) {
    store[s.id] = { ...s, createdAt: now, updatedAt: now };
  }
  writeStore(store);
  return Object.values(store);
}

/** @deprecated Use getOrSeedSkills() at call sites that need seeding. */
export async function seedDefaultSkills(): Promise<void> {
  await getOrSeedSkills();
}
