import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * M11 R1.0 S3d / T45: remove the pre-R1.0 versioned copies once Skills come from the single library.
 * Only directories that carry a WillYou/SmartDD ownership marker are removed; anything else is kept.
 * A copy marked with another store's id belongs to another WillYou data directory and is kept, and while any such
 * copy remains the shared coordination directory and the unattributable M4 copies are kept too.
 * Every removal renames first, so an interrupted run leaves either the old tree or a trash entry the next run finishes.
 */
export interface LegacyCopyCleanup { removed: string[]; kept: { name: string; reason: 'unmarked' | 'other-store' | 'unattributable' }[] }

const directory = (path: string) => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };
const marker = (path: string): Record<string, unknown> | null => { try { const value: unknown = JSON.parse(readFileSync(path, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } };
const discard = (parent: string, name: string) => { const trash = join(parent, '.willyou-trash-' + randomUUID()); renameSync(join(parent, name), trash); rmSync(trash, { recursive: true, force: true }); };

export function cleanupPreLibraryCopies(input: { home: string; storeId: string; unattributable: boolean }): LegacyCopyCleanup {
  const result: LegacyCopyCleanup = { removed: [], kept: [] }, agents = join(input.home, '.agents'), skills = join(agents, 'skills');
  for (const parent of [agents, skills]) if (directory(parent)) for (const entry of readdirSync(parent)) if (entry.startsWith('.willyou-trash-')) rmSync(join(parent, entry), { recursive: true, force: true });
  const m4: string[] = [];let foreign = false;
  if (directory(skills)) for (const name of readdirSync(skills).sort()) {
    if (!name.startsWith('smartdd-') || !directory(join(skills, name))) continue;
    const bundle = marker(join(skills, name, '.willyou-owned-bundle.json')), legacy = marker(join(skills, name, '.smartdd-owned.json'));
    if (bundle && typeof bundle.storeId === 'string') {
      if (bundle.storeId === input.storeId) { discard(skills, name); result.removed.push('.agents/skills/' + name); }
      else { foreign = true; result.kept.push({ name: '.agents/skills/' + name, reason: 'other-store' }); }
    } else if (legacy?.owner === 'SmartDD' && legacy.schema === 1) m4.push(name);
    else result.kept.push({ name: '.agents/skills/' + name, reason: 'unmarked' });
  }
  const runtime = join(agents, 'smartdd-runtime'), root = marker(join(runtime, '.willyou-catalog-root.json')), runtimeOwned = directory(runtime) && root?.owner === 'SmartDD';
  const attribute = input.unattributable && !foreign;
  for (const name of m4) { if (attribute) { discard(skills, name); result.removed.push('.agents/skills/' + name); } else result.kept.push({ name: '.agents/skills/' + name, reason: 'unattributable' }); }
  if (directory(runtime)) { if (!runtimeOwned) result.kept.push({ name: '.agents/smartdd-runtime', reason: 'unmarked' }); else if (attribute) { discard(agents, 'smartdd-runtime'); result.removed.push('.agents/smartdd-runtime'); } else result.kept.push({ name: '.agents/smartdd-runtime', reason: 'unattributable' }); }
  return result;
}
