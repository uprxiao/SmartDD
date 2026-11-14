import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { readCodexProviderId, readRequestedModel, copyClaudeSession } from './agent-native-state';
import { encodeClaudeDir } from '../tasks/native-sessions';

const ID = '12345678-1234-4234-8234-123456789abc';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let base: string, from: string, to: string, cwd: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.WILLYOU_NATIVE_STATE_TEST_TMP ?? tmpdir(), 'willyou-agent-native-state-'));
  from = join(base, 'managed-from'); to = join(base, 'managed-to'); cwd = join(base, 'project');
  mkdirSync(cwd); mkdirSync(from); mkdirSync(to);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));
const put = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
const file = (root: string, id = ID) => join(root, 'projects', encodeClaudeDir(cwd), `${id}.jsonl`);
const tree = (root: string, id = ID) => join(dirname(file(root, id)), id);
const jsonl = (root: string, rows: unknown[], id = ID) => put(file(root, id), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
const mainRows = () => [{ type: 'assistant', requestedModel: 'source-model', message: { content: 'PUBLIC_SYNTHETIC_ONLY' } }];
const copy = (nativeTarget = false) => copyClaudeSession({ from, to, cwd, sessionId: ID, nativeTarget });
it('reads only the exact Codex session header provider, not later prompts or host configuration guesses', () => {
  const path = put(join(from,'rollout.jsonl'), JSON.stringify({type:'session_meta',payload:{id:ID,model_provider:'willyou_original'}})+'\n'+JSON.stringify({type:'session_meta',payload:{id:ID,model_provider:'PROMPT_MUST_NOT_WIN'}})+'\n');
  const before=readFileSync(path);
  expect(readCodexProviderId(path,ID)).toBe('willyou_original');
  expect(readFileSync(path)).toEqual(before);
  expect(()=>readCodexProviderId(path,OTHER)).toThrow('身份不匹配');
  expect(readCodexProviderId(null,ID)).toBeNull();
});
it('refuses missing, spoofed or unsafe native provider metadata without exposing record contents', () => {
  const path=join(from,'rollout.jsonl');
  for(const name of ['with.dot','x[0]','x\ny','x=secret','',42]) {
    put(path,JSON.stringify({type:'session_meta',payload:{id:ID,model_provider:name}})+'\n');
    expect(()=>readCodexProviderId(path,ID)).toThrow('供应商标识无效');
  }
  put(path,JSON.stringify({type:'session_meta',payload:{id:ID}})+'\n');
  expect(readCodexProviderId(path,ID)).toBeNull();
  put(path,JSON.stringify({type:'response_item',payload:{id:ID,model_provider:'openai'}})+'\n');
  expect(()=>readCodexProviderId(path,ID)).toThrow('身份不匹配');
  put(path,'PUBLIC_SENTINEL_MUST_NOT_APPEAR_IN_ERROR\n');
  expect(()=>readCodexProviderId(path,ID)).toThrow('元数据无效');
  const link=join(from,'linked.jsonl');symlinkSync(path,link);
  expect(()=>readCodexProviderId(link,ID)).toThrow('身份异常');
});
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name), s = lstatSync(p), key = relative(root, p);
      if (s.isSymbolicLink()) result[key] = 'symlink';
      else if (s.isDirectory()) { result[key + '/'] = 'dir'; walk(p); }
      else result[key] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root); return result;
}
function noStaging(root: string) { expect(Object.keys(snapshot(root)).filter((name) => name.includes('.willyou-copy-'))).toEqual([]); }

it('reads only main Claude metadata; prompt, tools, sidechain and API-error records cannot change model', () => {
  const path = jsonl(from, [
    { type: 'attachment', attachment: { identity: { modelId: 'fallback' } } },
    { type: 'assistant', requestedModel: 'first' },
    { type: 'assistant', requestedModel: 'main-last' },
    { type: 'user', requestedModel: 'prompt-forgery', message: { content: 'requestedModel: PROMPT' } },
    { type: 'assistant', message: { model: 'alias-not-requested', content: [{ type: 'tool_use', input: { requestedModel: 'tool-forgery' } }] } },
    { type: 'assistant', requestedModel: 'sidechain', isSidechain: true },
    { type: 'assistant', requestedModel: 'api-error', isApiErrorMessage: true },
  ]);
  expect(readRequestedModel('claude', path)).toBe('main-last');
});
it('uses Claude attachment fallback only without valid requestedModel and ignores malformed trailing records', () => {
  const path = jsonl(from, [{ type: 'attachment', attachment: { identity: { modelId: 'fallback-last' } } }, { type: 'assistant', requestedModel: '-invalid' }]);
  writeFileSync(path, readFileSync(path, 'utf8') + '{"type":"assistant","requestedModel":"truncated');
  expect(readRequestedModel('claude', path)).toBe('fallback-last');
});
it('Codex selects the last main turn_context payload.model, never assistant/tool text', () => {
  const path = jsonl(from, [{ type: 'turn_context', payload: { model: 'codex-first' } }, { type: 'turn_context', payload: { model: 'codex-last' } }, { type: 'assistant', requestedModel: 'claude-only' }, { type: 'turn_context', payload: { model: 'side' }, isSidechain: true }, { type: 'event_msg', payload: { message: 'model fake' } }]);
  expect(readRequestedModel('codex', path)).toBe('codex-last');
});
it('unknown metadata and null filename stay unknown', () => {
  expect(readRequestedModel('claude', null)).toBeNull();
  expect(readRequestedModel('claude', jsonl(from, [{ type: 'user', message: 'requestedModel fake' }]))).toBeNull();
});
it('rejects symlink JSONL identity', () => {
  const actual = put(join(base, 'real.jsonl'), '{}\n'), link = join(base, 'linked.jsonl'); symlinkSync(actual, link);
  expect(() => readRequestedModel('claude', link)).toThrow('身份异常');
});
it('managed copy replaces exactly matching JSONL+tree, removes stale target files, keeps source and other sessions untouched', () => {
  jsonl(from, mainRows()); put(join(tree(from), 'subagents', 'agent.jsonl'), '{"public":true}\n'); mkdirSync(join(tree(from), 'empty'), { recursive: true });
  jsonl(from, [{ type: 'assistant', requestedModel: 'other' }], OTHER); put(join(tree(from, OTHER), 'other.txt'), 'OTHER SOURCE');
  jsonl(to, [{ old: true }]); put(join(tree(to), 'stale.txt'), 'REMOVE'); put(join(tree(to), 'subagents', 'obsolete.txt'), 'REMOVE');
  jsonl(to, [{ untouched: true }], OTHER); put(join(tree(to, OTHER), 'other.txt'), 'OTHER TARGET');
  const before = snapshot(from), otherFile = readFileSync(file(to, OTHER)), otherTree = snapshot(tree(to, OTHER));
  const receipt = copy(); receipt.assertCurrent();
  expect(readFileSync(file(to))).toEqual(readFileSync(file(from))); expect(snapshot(tree(to))).toEqual(snapshot(tree(from)));
  expect(snapshot(from)).toEqual(before); expect(readFileSync(file(to, OTHER))).toEqual(otherFile); expect(snapshot(tree(to, OTHER))).toEqual(otherTree);
  noStaging(to);
});
it('managed JSONL without source subtree removes only the previous matching target subtree', () => {
  jsonl(from, mainRows()); jsonl(to, [{ old: true }]); put(join(tree(to), 'obsolete'), 'REMOVE'); const before = snapshot(from);
  const receipt = copy(); receipt.assertCurrent(); expect(existsSync(tree(to))).toBe(false); expect(snapshot(from)).toEqual(before); noStaging(to);
});
it('native/default copy only adds exact matching new JSONL+tree and leaves all existing data/source unchanged', () => {
  jsonl(from, mainRows()); put(join(tree(from), 'sub', 'a.txt'), 'A'); jsonl(to, [{ keep: true }], OTHER); put(join(to, 'settings.json'), 'PUBLIC EXISTING');
  const sourceBefore = snapshot(from), targetBefore = snapshot(to); const receipt = copy(true); receipt.assertCurrent();
  const targetAfter = snapshot(to); for (const [path, hash] of Object.entries(targetBefore)) expect(targetAfter[path]).toBe(hash);
  expect(snapshot(from)).toEqual(sourceBefore); expect(readFileSync(file(to))).toEqual(readFileSync(file(from))); expect(snapshot(tree(to))).toEqual(snapshot(tree(from))); noStaging(to);
});
it.each(['jsonl', 'tree'] as const)('native/default existing same-ID %s refuses without changing any bytes or paths', (collision) => {
  jsonl(from, mainRows()); put(join(tree(from), 'a'), 'A');
  if (collision === 'jsonl') jsonl(to, [{ existing: 'DO NOT TOUCH' }]); else put(join(tree(to), 'existing'), 'DO NOT TOUCH');
  const sourceBefore = snapshot(from), targetBefore = snapshot(to);
  expect(() => copy(true)).toThrow('拒绝覆盖'); expect(snapshot(from)).toEqual(sourceBefore); expect(snapshot(to)).toEqual(targetBefore); noStaging(to);
});
it('missing exact source refuses without changing target and never copies another available session', () => {
  jsonl(from, mainRows(), OTHER); put(join(to, 'settings.json'), 'PUBLIC EXISTING'); const before = snapshot(to);
  expect(() => copy()).toThrow('源文件不存在'); expect(snapshot(to)).toEqual(before); noStaging(to);
});
it.each(['tree', 'nested', 'dangling-tree'] as const)('source %s symlink refuses without changing source/target or leaving staging', (which) => {
  jsonl(from, mainRows()); const actual = join(base, 'outside-public'); mkdirSync(actual); put(join(actual, 'test'), 'PUBLIC');
  if (which === 'nested') { mkdirSync(tree(from)); symlinkSync(actual, join(tree(from), 'linked')); }
  else symlinkSync(which === 'tree' ? actual : join(base, 'nonexistent-public'), tree(from));
  const sourceBefore = snapshot(from), targetBefore = snapshot(to);
  expect(() => copy()).toThrow('链接'); expect(snapshot(from)).toEqual(sourceBefore); expect(snapshot(to)).toEqual(targetBefore); noStaging(to);
});
it.each(['source-file', 'source-tree', 'target-file', 'target-tree'] as const)('receipt invalidates after %s changes', (changed) => {
  jsonl(from, mainRows()); put(join(tree(from), 'sub', 'a.txt'), 'A'); const receipt = copy(); receipt.assertCurrent();
  if (changed === 'source-file') writeFileSync(file(from), '{"changed":"source"}\n');
  if (changed === 'source-tree') put(join(tree(from), 'sub', 'a.txt'), 'CHANGED SOURCE');
  if (changed === 'target-file') writeFileSync(file(to), '{"changed":"target"}\n');
  if (changed === 'target-tree') put(join(tree(to), 'sub', 'a.txt'), 'CHANGED TARGET');
  expect(() => receipt.assertCurrent()).toThrow('失效'); noStaging(to);
});
it('invalid session ID and identical roots reject before writing anything', () => {
  jsonl(from, mainRows()); const sourceBefore = snapshot(from), targetBefore = snapshot(to);
  expect(() => copyClaudeSession({ from, to, cwd, sessionId: '../bad', nativeTarget: false })).toThrow('身份无效');
  expect(() => copyClaudeSession({ from, to: from, cwd, sessionId: ID, nativeTarget: false })).toThrow('身份无效');
  expect(snapshot(from)).toEqual(sourceBefore); expect(snapshot(to)).toEqual(targetBefore);
});
