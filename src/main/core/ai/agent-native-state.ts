import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, copyFileSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { CodeAgentKind } from '@shared/ai-agents';
import { claudeSessionFile } from '../tasks/native-sessions';
import { lastRequestedModel } from './agent-run-state';

/** Read only this session's first metadata record, never a provider name from prompts. */
export function readCodexProviderId(file: string | null, sessionId: string): string | null {
  if (!file) return null;
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('原生会话文件身份异常');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const opened = fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) throw new Error('原生会话记录正在变化，请稍后恢复');
    bytes = Buffer.alloc(Math.min(before.size, 2 * 1024 * 1024));
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error('原生会话记录正在变化，请稍后恢复');
  } finally { closeSync(fd); }
  const after = lstatSync(file);
  if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('原生会话记录正在变化，请稍后恢复');
  const end = bytes.indexOf(10);
  if (end < 0 && before.size > bytes.length) throw new Error('原生会话元数据超过读取范围');
  let record: { type?: string; payload?: { id?: string; model_provider?: unknown } };
  try { record = JSON.parse(bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8')); }
  catch { throw new Error('原生 Codex 会话元数据无效，无法安全恢复'); }
  if (record?.type !== 'session_meta' || record.payload?.id !== sessionId) throw new Error('原生 Codex 会话身份不匹配');
  const name = record.payload.model_provider;
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error('原生会话供应商标识无效');
  return name;
}

/** Metadata read from the tail of this exact native session; never scans prompts
 * or other sessions to guess a model. A missing field stays unknown.
 */
export function readRequestedModel(kind: CodeAgentKind, file: string | null): string | null {
  if (!file) return null;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('原生会话文件身份异常');
  const budget = 8 * 1024 * 1024, start = Math.max(0, stat.size - budget), bytes = Buffer.alloc(Math.min(stat.size, budget));
  const fd = openSync(file, 'r');
  try { readSync(fd, bytes, 0, bytes.length, start); } finally { closeSync(fd); }
  const text = bytes.toString('utf8'), lines = (start ? text.slice(text.indexOf('\n') + 1) : text).split('\n');
  const rows: unknown[] = [];
  for (const line of lines) {
    if (!line || line.length > 2 * 1024 * 1024) continue;
    try { rows.push(JSON.parse(line)); } catch { /* Incomplete records do not attest a model. */ }
  }
  const after = lstatSync(file);
  if (stat.ino !== after.ino || stat.dev !== after.dev || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('原生会话记录正在变化，请稍后恢复');
  return lastRequestedModel(kind, rows);
}

export interface ClaudeRestoreReceipt { from: string; to: string; sessionId: string; assertCurrent(): void }
// Host-only proof: the empty-history restore path intentionally cannot issue it.
const copiedClaudeSessions = new WeakSet<ClaudeRestoreReceipt>();
export const isCopiedClaudeSession = (receipt: ClaudeRestoreReceipt): boolean => copiedClaudeSessions.has(receipt);
type Entry = { source: string; suffix: string; hash: string };
function pathExists(path:string):boolean {
  try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
function sessionEntries(file: string, tree: string): Entry[] {
  const entries: Entry[] = [], pending: { path: string; suffix: string }[] = [{ path: file, suffix: 'session.jsonl' }];
  if (pathExists(tree)) pending.push({ path: tree, suffix: 'session' });
  let total = 0;
  while (pending.length) {
    const item = pending.pop()!, stat = lstatSync(item.path);
    if(entries.length>4096)throw new Error('原生会话超过本次复制预算');
    if (stat.isSymbolicLink()) throw new Error('原生会话包含链接，拒绝复制');
    if (stat.isDirectory()) {
      entries.push({ source: item.path, suffix: item.suffix + '/', hash: 'directory' });
      for (const name of readdirSync(item.path).sort().reverse()) pending.push({ path: join(item.path, name), suffix: item.suffix + '/' + name });
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > 256 * 1024 * 1024 || entries.length > 4096) throw new Error('原生会话超过本次复制预算');
      entries.push({ source: item.path, suffix: item.suffix, hash: createHash('sha256').update(readFileSync(item.path)).digest('hex') });
    } else throw new Error('原生会话包含不支持的文件');
  }
  return entries.sort((a,b) => a.suffix.localeCompare(b.suffix));
}
const digest = (entries: Entry[]) => JSON.stringify(entries.map(({ suffix, hash }) => ({ suffix, hash })));
function ownedParents(root: string, path: string): void {
  const suffix = relative(resolve(root), resolve(path));
  if (suffix === '..' || suffix.startsWith(`..${sep}`)) throw new Error('会话目标超出配置目录');
  let current = resolve(root);
  if (!pathExists(current)) mkdirSync(current, { recursive: true, mode: 0o700 });
  for (const part of ['', ...suffix.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    if (!pathExists(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('会话目标目录身份异常');
  }
}

/** Copy only this session ID and its same-name subtree. Native/default targets
 * use exclusive creation; managed targets replace only the prior copy of this ID.
 * Source bytes are never modified or removed.
 */
export function copyClaudeSession(input: { from: string; to: string; cwd: string; sessionId: string; nativeTarget: boolean }): ClaudeRestoreReceipt {
  const { from, to, cwd, sessionId } = input;
  if (!/^[a-f0-9-]{36}$/i.test(sessionId) || resolve(from) === resolve(to)) throw new Error('跨目录恢复身份无效');
  const sourceFile = claudeSessionFile(from, cwd, sessionId, true);
  if (!sourceFile) throw new Error('原生会话源文件不存在，无法恢复');
  const rel = relative(join(from, 'projects'), sourceFile), parts = rel.split(sep);
  if (parts.length !== 2 || parts[0] === '..' || parts[1] !== `${sessionId}.jsonl`) throw new Error('原生会话源路径无效');
  const sourceTree = join(dirname(sourceFile), sessionId), before = sessionEntries(sourceFile, sourceTree);
  const parent = join(to, 'projects', parts[0]), targetFile = join(parent, parts[1]), targetTree = join(parent, sessionId);
  ownedParents(to, parent);
  if (input.nativeTarget && (pathExists(targetFile) || pathExists(targetTree))) throw new Error('用户配置目录已有同名会话，拒绝覆盖，请选择其他智能体');
  if (!input.nativeTarget && pathExists(targetFile)) sessionEntries(targetFile, targetTree);
  const staging = join(parent, `.willyou-copy-${randomUUID()}`); mkdirSync(staging, { mode: 0o700 });
  const stageFile = join(staging, 'session.jsonl'), stageTree = join(staging, 'session');
  const created: { path: string; hash: string }[] = [];
  try {
    for (const entry of before.filter((item) => item.hash === 'directory').sort((a,b) => a.suffix.length-b.suffix.length)) mkdirSync(join(staging, entry.suffix), { recursive: true, mode: 0o700 });
    for (const entry of before.filter((item) => item.hash !== 'directory')) copyFileSync(entry.source, join(staging, entry.suffix), constants.COPYFILE_EXCL);
    if (digest(sessionEntries(sourceFile, sourceTree)) !== digest(before) || digest(sessionEntries(stageFile, stageTree)) !== digest(before)) throw new Error('原生会话复制期间发生变化，请重试');
    if (input.nativeTarget) {
      // link() is no-replace even if another process created the destination
      // after preflight. The default user's existing history is never replaced.
      linkSync(stageFile, targetFile); created.push({ path: targetFile, hash: before.find((entry) => entry.suffix === 'session.jsonl')!.hash });
      if (pathExists(stageTree)) {
        mkdirSync(targetTree, { mode: 0o700 }); created.push({ path: targetTree, hash: 'directory' });
        for (const entry of before.filter((item) => item.suffix.startsWith('session/'))) {
          const target = join(targetTree, entry.suffix.slice('session/'.length));
          if (entry.hash === 'directory') { if (target !== targetTree) { mkdirSync(target, { mode: 0o700 }); created.push({ path: target, hash: 'directory' }); } }
          else { copyFileSync(entry.source, target, constants.COPYFILE_EXCL); created.push({ path: target, hash: entry.hash }); }
        }
      }
    } else {
      renameSync(stageFile, targetFile);
      if (pathExists(targetTree)) rmSync(targetTree, { recursive: true });
      if (pathExists(stageTree)) renameSync(stageTree, targetTree);
    }
    const expected = digest(before);
    const assertCurrent = () => {
      if (digest(sessionEntries(sourceFile, sourceTree)) !== expected || digest(sessionEntries(targetFile, targetTree)) !== expected) throw new Error('原生会话复制凭据已失效，请重新恢复');
    };
    assertCurrent(); const receipt = { from, to, sessionId, assertCurrent };
    copiedClaudeSessions.add(receipt); return receipt;
  } catch (error) {
    for (const entry of created.reverse()) {
      try {
        if (entry.hash === 'directory') rmdirSync(entry.path);
        else if (createHash('sha256').update(readFileSync(entry.path)).digest('hex') === entry.hash) unlinkSync(entry.path);
      } catch { /* Preserve foreign or uncertain data. */ }
    }
    throw error;
  } finally { rmSync(staging, { recursive: true }); }
}
