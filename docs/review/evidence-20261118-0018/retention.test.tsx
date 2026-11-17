// @vitest-environment jsdom
// Isolated component contract checks. These are NOT browser / packaged-App evidence.
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), respond: vi.fn(), stop: vi.fn(), toast: vi.fn(), on: vi.fn(), command: vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn(), draftBody: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { agentTasks: mocks },
  events: { on: mocks.on },
}));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: () => null }));
vi.mock('../../../src/renderer/features/agent-tasks/agent-terminal', () => ({ AgentTerminalDrawer: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import Database from 'better-sqlite3';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { AgentStore } from '../../../src/main/core/agent/agent-store';
import { AgentRunService } from '../../../src/main/core/agent/agent-run-service';
import { AgentTaskService } from '../../../src/main/core/agent/agent-task-service';
import { Emitter } from '../../../src/main/core/agent/driver';
import { until } from '../../../src/main/core/agent/test-doubles';
import { AgentTaskView } from '../../../src/renderer/features/agent-tasks/agent-task-view';

const observations: Record<string, unknown> = {};
afterAll(() => writeFileSync('docs/review/evidence-20261118-0018/retention-observations.json', JSON.stringify(observations, null, 2) + '\n'));
const roots: string[] = [];
const fixtures: { db: Database.Database; runs: AgentRunService }[] = [];
afterEach(async () => { cleanup(); for (const f of fixtures.splice(0)) { await f.runs.closeAll(); await new Promise(r => setTimeout(r, 0)); f.db.close(); } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.mockResolvedValue([{ profileId: 'p', name: 'Codex', tiers: ['ask', 'auto', 'full'], models: [], driverId: 'codex-app-server' }]);
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.saveDraft.mockResolvedValue({ ok: true, revision: 1 });
  mocks.respond.mockResolvedValue(undefined);
  mocks.on.mockImplementation(() => () => {});
  mocks.submit.mockResolvedValue({ status: 'accepted' });
  mocks.command.mockResolvedValue({ ok: true });
  mocks.prepareAttachment.mockResolvedValue({ id: 'prepared', kind: 'path', name: 'note.txt', mime: 'text/plain', size: 1, image: false, relativePath: 'note.txt' });
  (window as any).electronAPI = { pathForFile: () => '/review/note.txt' };
  HTMLElement.prototype.scrollTo = vi.fn();
});
function snapshot(extra: any = {}) {
  return { taskId: 'task', title: 'review task', cwd: '/w', projectId: null, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' }, selectionRevision: 1, draft: { draft: { text: 'first draft' }, revision: 0 }, items: [], turns: [], requests: [], queued: [], run: null, goal: null, status: 'idle', seq: 1, ...extra };
}
async function mount() {
  render(<AgentTaskView taskId="task" />);
  return await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
}

function backend() {
  const artifactDir = mkdtempSync(join(tmpdir(), 'm14-review-0018-artifact-')); roots.push(artifactDir);
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runBundledMigrations(db); const store = new AgentStore(db, { artifactDir }), emitter = new Emitter();
  const driver = { id: 'claude-sdk' as const, command: 'fake', create: () => ({ driverId: 'claude-sdk' as const, on: emitter.on.bind(emitter), open: async () => ({ nativeId: 'local-claude', confirmed: true }), startTurn: async (t: any) => { emitter.emit({ type: 'turn.started', nativeTurnId: 'n1', clientInputId: t.clientInputId }); return { nativeTurnId: 'n1' }; }, respond: async () => {}, interrupt: async () => {}, close: async () => { emitter.emit({ type: 'exit', code: 0, signal: null }); } }) };
  const runs = new AgentRunService({ store, drivers: new Map([['claude-sdk', driver]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'review-2327', pid: process.pid, startedAt: null } });
  const svc = new AgentTaskService({ store, runs, profileDriver: () => 'claude-sdk', resolveLaunch: async () => ({ driverId: 'claude-sdk', executable: { path: '/synthetic/claude', version: '2.1.326' }, env: {}, stateRoot: '/synthetic/state', compatibility: {}, extraArgs: [] }) });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/review-work', title: 'review', profileId: 'p', tier: 'ask' });
  fixtures.push({ db, runs }); return { db, store, runs, svc, taskId, emitter };
}

it('U01a: oversized new timeline text must remain recoverable through a body/artifact reference', async () => {
  const b = backend(), text = 'BEGIN_' + 'a'.repeat(1200 * 1024) + '_FULL_TAIL';
  await b.svc.submit(b.taskId, { clientInputId: 'retention-input-a', text: 'read result', expectedSelectionRevision: 1 });
  await until(() => !!b.runs.runForTask(b.taskId) && b.runs.busy(b.runs.runForTask(b.taskId)!.runId));
  b.emitter.emit({ type: 'item.completed', nativeItemId: 'oversize-text', itemType: 'assistant', payload: { content: [{ type: 'text', text }] } });
  const item = b.svc.snapshot(b.taskId).items.find(x => x.type === 'assistant_message')!;
  let off = 0, raw = '';
  for (;;) { const c = b.svc.itemBody(b.taskId, item.itemId, off, item.revision); raw += c.chunk; if (c.done) break; off = c.next; }
  const restored = JSON.parse(raw);
  observations.U01a = { originalTextBytes: Buffer.byteLength(text), bodyBytesReadBack: Buffer.byteLength(raw), restoredTextBytes: Buffer.byteLength(restored.text ?? ''), markedIncomplete: restored.storedTruncated === true, tailRecoverable: String(restored.text ?? '').endsWith('_FULL_TAIL'), returnedFields: Object.keys(restored) };
  expect(restored.text === text).toBe(true);
});

it('U01b: truncated work detail must either show complete text or explicitly mark missing content', async () => {
  const b = backend(), thinking = 'REASON_' + 'r'.repeat(1200 * 1024) + '_REASON_TAIL';
  await b.svc.submit(b.taskId, { clientInputId: 'retention-input-b', text: 'reason', expectedSelectionRevision: 1 });
  await until(() => !!b.runs.runForTask(b.taskId) && b.runs.busy(b.runs.runForTask(b.taskId)!.runId));
  b.emitter.emit({ type: 'item.completed', nativeItemId: 'oversize-reasoning', itemType: 'assistant', payload: { content: [{ type: 'thinking', thinking }] } });
  const snap = b.svc.snapshot(b.taskId); let readDone = false;
  mocks.snapshot.mockResolvedValue(snap);
  mocks.itemBody.mockImplementation(async (taskId, itemId, off, revision) => { const r = b.svc.itemBody(taskId, itemId, off, revision); if (r.done) readDone = true; return r; });
  render(<AgentTaskView taskId={b.taskId} />);
  fireEvent.click(await screen.findByRole('button', { name: /工作中/ }));
  fireEvent.click(await screen.findByRole('button', { name: /展开全文/ }));
  await waitFor(() => expect(readDone).toBe(true)); await act(async () => {});
  const complete = !!screen.queryByText(/_REASON_TAIL/), warning = !!screen.queryByText(/超过保存上限|只保留|内容不完整/);
  observations.U01b = { completeTailVisible: complete, incompleteWarningVisible: warning, expandStillAvailable: !!screen.queryByRole('button', { name: /展开全文/ }) };
  expect(complete || warning).toBe(true);
});
