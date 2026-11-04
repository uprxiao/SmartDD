import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { canonicalJson } from './manifest';
import { skillFilesHash } from './run-plan';

/** One WillYou skill as agents should see it; the name never carries a version. */
export interface LibrarySkill { name: string; files: Readonly<Record<string, Buffer>>; executables: ReadonlySet<string> }
/** How one agent discovers skills: the shared `~/.agents/skills`, or links in its own directory (relative to HOME). */
export interface AgentSkillTarget { agentId: string; readsSharedAgentSkills: boolean; skillDirectory?: string }
export interface LibraryConflict { name: string; location: string }
export interface LibrarySyncResult { written: string[]; unchanged: string[]; removed: string[]; conflicts: LibraryConflict[] }

const MARKER = '.willyou-owned.json';
const NAME = /^willyou-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function libraryName(appId: string | undefined, skillId: string): string {
  const name = 'willyou-' + (appId ? appId + '-' : '') + skillId;
  if (name.length > 64 || !NAME.test(name)) throw new ApplicationError('INVALID_PACKAGE', 'Skill 名称不符合 Agent 可加载的格式');
  return name;
}

const present = (path: string) => { try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } };

function ownedHash(path: string, name: string): string | null {
  const stat = present(path);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  try { const marker = JSON.parse(readFileSync(join(path, MARKER), 'utf8')); return marker?.owner === 'WillYou' && marker.name === name && typeof marker.contentHash === 'string' ? marker.contentHash : null; }
  catch { return null; }
}

function readTree(root: string, base = ''): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
    const relative = base ? base + '/' + entry.name : entry.name;
    if (!base && entry.name === MARKER) continue;
    if (entry.isDirectory()) Object.assign(files, readTree(root, relative));
    else if (entry.isFile()) files[relative] = readFileSync(join(root, relative));
  }
  return files;
}

function writeTree(target: string, skill: LibrarySkill, hash: string): void {
  for (const [relative, bytes] of Object.entries(skill.files)) {
    if (relative.split('/').some(part => !part || part === '.' || part === '..') || relative === MARKER) throw new ApplicationError('INVALID_PACKAGE', 'Skill 文件路径无效');
    const path = join(target, relative); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { mode: skill.executables.has(relative) ? 0o755 : 0o644 }); chmodSync(path, skill.executables.has(relative) ? 0o755 : 0o644);
  }
  writeFileSync(join(target, MARKER), canonicalJson({ schema: 1, owner: 'WillYou', name: skill.name, contentHash: hash }) + '\n', { mode: 0o644 });
}

/** Removes by first renaming next to the target, so a reader sees the old tree, nothing, or the new tree, never a partial one. */
function discard(path: string): void { const trash = join(dirname(path), '.willyou-trash-' + randomUUID()); renameSync(path, trash); rmSync(trash, { recursive: true, force: true }); }

/**
 * Converges the agents' skill directories to exactly `skills`. Only WillYou-marked copies and WillYou links are
 * created, replaced or removed; anything else with the same name is reported as a conflict and left untouched.
 * Callers serialize calls.
 */
export function syncAgentSkillLibrary(input: { home: string; targets: readonly AgentSkillTarget[]; skills: readonly LibrarySkill[] }): LibrarySyncResult {
  const shared = join(input.home, '.agents', 'skills'); mkdirSync(shared, { recursive: true });
  const result: LibrarySyncResult = { written: [], unchanged: [], removed: [], conflicts: [] };
  const desired = new Map<string, LibrarySkill>();
  for (const skill of input.skills) { if (!NAME.test(skill.name) || desired.has(skill.name)) throw new ApplicationError('INVALID_PACKAGE', 'Skill 名称无效或重复'); desired.set(skill.name, skill); }
  for (const entry of readdirSync(shared)) if (entry.startsWith('.willyou-staging-') || entry.startsWith('.willyou-trash-')) rmSync(join(shared, entry), { recursive: true, force: true });

  const delivered = new Set<string>();
  for (const skill of desired.values()) {
    const target = join(shared, skill.name), hash = skillFilesHash(skill.files), existing = present(target);
    if (existing && ownedHash(target, skill.name) === null) { result.conflicts.push({ name: skill.name, location: shared }); continue; }
    delivered.add(skill.name);
    if (existing && ownedHash(target, skill.name) === hash && skillFilesHash(readTree(target)) === hash) { result.unchanged.push(skill.name); continue; }
    const staging = join(shared, '.willyou-staging-' + randomUUID()); mkdirSync(staging);
    try { writeTree(staging, skill, hash); if (existing) discard(target); renameSync(staging, target); }
    catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
    result.written.push(skill.name);
  }
  for (const entry of readdirSync(shared).sort()) {
    if (!NAME.test(entry) || desired.has(entry) || ownedHash(join(shared, entry), entry) === null) continue;
    discard(join(shared, entry)); result.removed.push(entry);
  }

  for (const target of input.targets) {
    if (target.readsSharedAgentSkills || !target.skillDirectory) continue;
    const directory = join(input.home, target.skillDirectory); mkdirSync(directory, { recursive: true });
    const ours = (path: string) => { const stat = present(path); return !!stat?.isSymbolicLink() && dirname(readlinkSync(path)) === shared; };
    for (const name of delivered) {
      const link = join(directory, name), stat = present(link), destination = join(shared, name);
      if (stat && !ours(link)) { result.conflicts.push({ name, location: directory }); continue; }
      if (stat && readlinkSync(link) === destination) continue;
      if (stat) unlinkSync(link);
      symlinkSync(destination, link);
    }
    for (const entry of readdirSync(directory)) if (NAME.test(entry) && !delivered.has(entry) && ours(join(directory, entry))) unlinkSync(join(directory, entry));
  }
  return result;
}
