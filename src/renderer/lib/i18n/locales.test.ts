import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, zhCN } from './locales';

// A missing key renders as the key itself — a silent failure. Check every literal key in use.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

const lookup = (tree: unknown, key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);

const used = new Set<string>();
for (const f of files(join(__dirname, '../..'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z][\w.-]*)'/g)) used.add(m[1]);
}
// Built from template strings in the views.
for (const r of ['resumable', 'fresh', 'not-started', 'unrecoverable']) used.add(`task.recovery.${r}`);
for (const k of ['explore', 'build', 'review', 'fix']) used.add(`home.suggestions.${k}.title`).add(`home.suggestions.${k}.prompt`);
for (const c of ['ok', 'auth', 'billing', 'model', 'config', 'not_found', 'rate_limit', 'server', 'network', 'timeout', 'unexpected', 'other']) used.add(`aiProfiles.health.categories.${c}`);
for (const s of ['ok', 'failed', 'warning']) used.add(`aiProfiles.health.${s}`);
for (const s of ['general', 'aiProfiles', 'appearance', 'terminal']) used.add(`settings.sections.${s}`).add(`settings.descriptions.${s}`);

describe('locales', () => {
  it('finds the keys in use', () => {
    expect(used.size).toBeGreaterThan(100);
    expect(used).toContain('nav.newTask');
  });

  it.each([
    ['zh-CN', zhCN],
    ['en', en],
  ])('%s has every key in use', (_, tree) => {
    const missing = [...used].filter((k) => typeof lookup(tree, k) !== 'string');
    expect(missing).toEqual([]);
  });
});
