// 输入框 @文件（需求 R01）：只在任务工作目录内查找，结果为相对路径；插入引用只改草稿，不自动发送。
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_FILES = 20_000;
const SKIP = new Set(['.git', 'node_modules', '.svn', 'dist', 'out', 'build', '.next', '.venv', '__pycache__']);
const cache = new Map<string, { at: number; files: Promise<string[]> }>();

function gitList(cwd: string): Promise<string[] | null> {
  return new Promise(resolve => {
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(String(out).split('\0').filter(Boolean).slice(0, MAX_FILES));
    });
  });
}

function walk(root: string): string[] {
  const out: string[] = [], stack = [root];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') { if (SKIP.has(e.name) || e.isDirectory()) continue; }
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(full); }
      else if (e.isFile()) out.push(relative(root, full));
      if (out.length >= MAX_FILES) break;
    }
  }
  return out;
}

export function listProjectFiles(cwd: string): Promise<string[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 10_000) return hit.files;
  const files = gitList(cwd).then(list => list ?? walk(cwd));
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

/** 子序列模糊匹配：文件名命中优先，连续命中加分，路径短的靠前。 */
export function rankFiles(files: readonly string[], query: string, limit = 30): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, limit);
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const lower = f.toLowerCase(), base = lower.slice(lower.lastIndexOf('/') + 1);
    let s = 0, i = 0, prev = -2;
    for (let k = 0; k < lower.length && i < q.length; k++) if (lower[k] === q[i]) { s += k === prev + 1 ? 3 : 1; prev = k; i++; }
    if (i < q.length) continue;
    if (base.includes(q)) s += 20;
    if (base.startsWith(q)) s += 10;
    scored.push({ f, s: s - f.length * 0.01 });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.f);
}

export async function searchProjectFiles(cwd: string, query: string, limit = 30) {
  return rankFiles(await listProjectFiles(cwd), query, limit);
}
