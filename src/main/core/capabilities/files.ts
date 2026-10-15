import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { sha256 } from './assets';

const OWNER = '.smartdd-owned.json';

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('投影中发现符号链接，拒绝覆盖');
    return stat.isDirectory() ? listFiles(root, path) : [relative(root, path)];
  });
}

/** Immutable trees: never overwrite differing contents, including a user's namesake directory. */
export function writeOwnedTree(root: string, files: Record<string, string>, backupRoot: string): void {
  const owner = JSON.stringify({ owner: 'SmartDD', schema: 1 });
  const expected: Record<string, string> = { ...files, [OWNER]: owner };
  for (const name of Object.keys(expected)) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('无效的包文件路径');
  }
  if (existsSync(root)) {
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error(`Skill 目标已存在且不属于 SmartDD：${root}`);
    try {
      if (lstatSync(join(root, OWNER)).isSymbolicLink() || readFileSync(join(root, OWNER), 'utf8') !== owner) throw new Error();
    } catch { throw new Error(`Skill 目标已有用户内容，保留原样：${root}`); }
    const names = [...new Set([...listFiles(root), ...Object.keys(expected)])].sort();
    const changes = names.filter((name) => !existsSync(join(root, name)) || !(name in expected) || readFileSync(join(root, name), 'utf8') !== expected[name]);
    if (!changes.length) return;
    const backup = join(backupRoot, randomUUID());
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    const diff = changes.map((name) => {
      const path = join(root, name);
      if (existsSync(path)) {
        const target = join(backup, name);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        copyFileSync(path, target);
      }
      return `${name}: ${existsSync(path) ? sha256(readFileSync(path)).slice(0, 12) : 'missing'} → ${name in expected ? sha256(expected[name]).slice(0, 12) : 'unexpected'}`;
    });
    throw new Error(`投影内容已改变，停止启动，保留原文件。差异：${diff.join('；')}。备份：${backup}`);
  }
  const staging = `${root}.tmp-${randomUUID()}`;
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    for (const [name, content] of Object.entries(expected)) {
      const file = join(staging, name);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, content, { mode: 0o600, flag: 'wx' });
    }
    renameSync(staging, root);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

export function readOwnedTree(root: string): Record<string, string> {
  if (lstatSync(root).isSymbolicLink() || JSON.parse(readFileSync(join(root, OWNER), 'utf8')).owner !== 'SmartDD') throw new Error('Skill 版本目录不可用');
  return Object.fromEntries(listFiles(root).filter((name) => name !== OWNER).map((name) => [name, readFileSync(join(root, name), 'utf8')]));
}
