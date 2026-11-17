import Database from 'better-sqlite3';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { AgentStore } from '../../../src/main/core/agent/agent-store';

// Inject an actual partially written private temporary file, then the filesystem error.
const fault = vi.hoisted(() => ({ partialWrite: false }));
vi.mock('node:fs', async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...fs, writeFileSync: (path: any, data: any, options: any) => {
    if (fault.partialWrite && String(path).endsWith('.tmp')) {
      fault.partialWrite = false;
      fs.writeFileSync(path, String(data).slice(0, 8192), options);
      throw Object.assign(new Error('review: write failed after partial bytes'), { code: 'EIO' });
    }
    return fs.writeFileSync(path, data, options);
  } };
});

const fixtures: { root: string; dbs: Database.Database[] }[] = [];
const observations: Record<string, unknown> = {};
afterEach(() => {
  fault.partialWrite = false;
  for (const f of fixtures.splice(0)) {
    for (const db of f.dbs) if (db.open) db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
afterAll(() => writeFileSync('docs/review/evidence-20261118-0049/artifact-lifecycle-observations.json', JSON.stringify(observations, null, 2) + '\n'));
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-review-0049-lifecycle-')));
  const file = join(root, 'review.sqlite'), artifacts = join(root, 'artifacts');
  const db = new Database(file); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const fixture = { root, dbs: [db] }; fixtures.push(fixture);
  const store = new AgentStore(db, { artifactDir: artifacts });
  const taskId = store.createTask({ projectId: null, dirId: null, cwd: root, title: 'review', selection: { driverId: 'codex-app-server', profileId: 'fixture', tier: 'ask' } });
  const bindingId = store.createBinding({ task_id: taskId, driver_id: 'codex-app-server', profile_id: 'fixture', continuation_hash: 'a'.repeat(64), state_root: root, cwd_identity: root });
  const runId = 'review-run';
  store.insertRun({ runId, taskId, projectId: null, driverId: 'codex-app-server', bindingId, generation: 1, owner: { instanceId: 'review', pid: process.pid, startedAt: null }, launchPlanHash: 'fixture' });
  const put = (text: string) => store.upsertItem({ taskId, runId, turnId: null, nativeKey: 'same', type: 'assistant_message', payload: { text } });
  const files = () => readdirSync(join(artifacts, taskId)).sort();
  return { root, file, artifacts, db, fixture, store, taskId, put, files };
}

it('L01: a partial file write is cleaned; incomplete fallback and the next normal revision stay readable', () => {
  const s = setup(); fault.partialWrite = true;
  const itemId = s.put('partial-' + 'a'.repeat(1100 * 1024));
  const fallback = JSON.parse(s.store.readItemBody(s.taskId, itemId)!.text);
  const afterFailure = s.files();
  expect(fallback.storedTruncated).toBe(true);
  expect(afterFailure).toEqual([]);
  const text = 'complete-' + 'b'.repeat(1100 * 1024);
  expect(s.put(text)).toBe(itemId);
  expect(JSON.parse(s.store.readItemBody(s.taskId, itemId)!.text).text).toBe(text);
  expect(s.files()).toEqual([`${itemId}.r2.json`]);
  observations.L01 = { afterFailure, incomplete: fallback.storedTruncated, afterRetry: s.files() };
});

it('L02: failure while accepting an oversized user message rolls back its turn and file; retry accepts once', () => {
  const s = setup(), text = '\u0001'.repeat(256 * 1024);
  s.db.exec("CREATE TRIGGER review_fail_accept BEFORE INSERT ON agent_items WHEN NEW.type='user_message' BEGIN SELECT RAISE(ABORT, 'review rollback'); END");
  const input = { taskId: s.taskId, clientInputId: 'same-input', text, sourceKind: 'user' as const };
  expect(() => s.store.acceptTurn(input)).toThrow('review rollback');
  const afterFailure = s.files();
  expect(afterFailure).toEqual([]);
  expect(s.store.turns(s.taskId)).toEqual([]);
  s.db.exec('DROP TRIGGER review_fail_accept');
  const accepted = s.store.acceptTurn(input), duplicate = s.store.acceptTurn(input);
  expect(duplicate).toMatchObject({ duplicate: true, turn: { turn_id: accepted.turn.turn_id } });
  const item = s.store.items(s.taskId)[0];
  expect(JSON.parse(s.store.readItemBody(s.taskId, item.itemId)!.text).text).toBe(text);
  expect(s.files()).toEqual([`${item.itemId}.r1.json`]);
  observations.L02 = { afterFailure, acceptedTurn: accepted.turn.turn_id, duplicateTurn: duplicate.turn.turn_id, files: s.files() };
});

it('L03: an update rollback preserves the old original; retry commits the next revision and cleans the old file', () => {
  const s = setup(), before = 'first-' + 'c'.repeat(1100 * 1024), after = 'second-' + 'd'.repeat(1100 * 1024);
  const itemId = s.put(before);
  s.db.exec("CREATE TRIGGER review_fail_update BEFORE UPDATE ON agent_items BEGIN SELECT RAISE(ABORT, 'review update rollback'); END");
  expect(() => s.put(after)).toThrow('review update rollback');
  expect(s.files()).toEqual([`${itemId}.r1.json`]);
  expect(s.store.readItemBody(s.taskId, itemId)!.revision).toBe(1);
  expect(JSON.parse(s.store.readItemBody(s.taskId, itemId)!.text).text).toBe(before);
  s.db.exec('DROP TRIGGER review_fail_update');
  s.put(after);
  expect(s.files()).toEqual([`${itemId}.r2.json`]);
  expect(JSON.parse(s.store.readItemBody(s.taskId, itemId)!.text).text).toBe(after);
  observations.L03 = { currentRevision: s.store.readItemBody(s.taskId, itemId)!.revision, files: s.files() };
});

it('L04: minimal structured references and escaped inputs survive a real database reopen with idempotent receipts', () => {
  const s = setup(), rows = Array.from({ length: 60000 }, (_, i) => ({ i, v: '值' }));
  const itemId = s.store.addHostItem(s.taskId, null, 'system_notice', { rows });
  const text = '\u0001'.repeat(256 * 1024);
  const input = { taskId: s.taskId, clientInputId: 'persisted', text, sourceKind: 'user' as const };
  const accepted = s.store.acceptTurn(input), beforeFiles = s.files();
  s.db.close();
  const reopened = new Database(s.file); reopened.pragma('foreign_keys=ON'); s.fixture.dbs.push(reopened);
  const store = new AgentStore(reopened, { artifactDir: s.artifacts });
  expect(JSON.parse(store.readItemBody(s.taskId, itemId)!.text).rows).toEqual(rows);
  const user = store.items(s.taskId).find(i => i.type === 'user_message')!;
  expect(JSON.parse(store.readItemBody(s.taskId, user.itemId)!.text).text).toBe(text);
  expect(store.acceptTurn(input)).toMatchObject({ duplicate: true, turn: { turn_id: accepted.turn.turn_id } });
  expect(s.files()).toEqual(beforeFiles);
  observations.L04 = { rows: rows.length, inputChars: text.length, filesBeforeReopen: beforeFiles, filesAfterRetry: s.files() };
});
