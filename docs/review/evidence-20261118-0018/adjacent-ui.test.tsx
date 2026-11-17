// @vitest-environment jsdom
// Isolated component contract checks. These are NOT browser / packaged-App evidence.
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeFileSync } from 'node:fs';

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
afterAll(() => writeFileSync('docs/review/evidence-20261118-0018/adjacent-ui-observations.json', JSON.stringify(observations, null, 2) + '\n'));
const fixtures: { db: Database.Database; runs: AgentRunService }[] = [];
afterEach(async () => { cleanup(); for (const f of fixtures.splice(0)) { await f.runs.closeAll(); await new Promise(r => setTimeout(r, 0)); f.db.close(); } });
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
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runBundledMigrations(db); const store = new AgentStore(db), emitter = new Emitter();
  const driver = { id: 'claude-sdk' as const, command: 'fake', create: () => ({ driverId: 'claude-sdk' as const, on: emitter.on.bind(emitter), open: async () => ({ nativeId: 'local-claude', confirmed: true }), startTurn: async (t: any) => { emitter.emit({ type: 'turn.started', nativeTurnId: 'n1', clientInputId: t.clientInputId }); return { nativeTurnId: 'n1' }; }, respond: async () => {}, interrupt: async () => {}, close: async () => { emitter.emit({ type: 'exit', code: 0, signal: null }); } }) };
  const runs = new AgentRunService({ store, drivers: new Map([['claude-sdk', driver]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'review-2327', pid: process.pid, startedAt: null } });
  const svc = new AgentTaskService({ store, runs, profileDriver: () => 'claude-sdk', resolveLaunch: async () => ({ driverId: 'claude-sdk', executable: { path: '/synthetic/claude', version: '2.1.326' }, env: {}, stateRoot: '/synthetic/state', compatibility: {}, extraArgs: [] }) });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/review-work', title: 'review', profileId: 'p', tier: 'ask' });
  fixtures.push({ db, runs }); return { db, store, runs, svc, taskId, emitter };
}

it('T01: draft hydration must adopt the revision of the body it actually loaded before the first save', async () => {
  const b = backend(), v1 = 'v1-' + 'a'.repeat(60 * 1024), v2 = 'v2-' + 'b'.repeat(60 * 1024), edited = 'user edit after reading revision two';
  b.svc.saveDraft(b.taskId, { text: v1 }, 0); const initial = b.svc.snapshot(b.taskId);
  mocks.snapshot.mockResolvedValue(initial); let otherWindowSaved = false;
  mocks.draftBody.mockImplementation(async (taskId, off, revision) => {
    if (!otherWindowSaved) { b.svc.saveDraft(b.taskId, { text: v2 }, 1); otherWindowSaved = true; }
    return b.svc.draftBody(taskId, off, revision);
  });
  mocks.saveDraft.mockImplementation(async (taskId, draft, revision) => b.svc.saveDraft(taskId, draft, revision));
  render(<AgentTaskView taskId={b.taskId} />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value === v2).toBe(true));
  fireEvent.change(input, { target: { value: edited } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1)); await act(async () => {});
  const stored = b.store.draft(b.taskId);
  observations.T01 = { snapshotRevision: initial.draft?.revision, hydratedBodyRevision: 2, displayedV2BeforeEditing: true, firstSaveExpectedRevision: mocks.saveDraft.mock.calls[0][2], serverRevision: stored?.revision, serverSavedFirstEdit: stored?.draft?.text === edited, localEditRetained: input.value === edited, warningCount: mocks.toast.mock.calls.length };
  expect(stored?.draft?.text === edited).toBe(true);
});

it('T02: incomplete stored plan must not become a cached full plan or be copied as an empty success', async () => {
  const b = backend(), plan = 'PLAN_START_' + 'p'.repeat(600 * 1024) + '_PLAN_END', writeText = vi.fn().mockResolvedValue(undefined);
  await b.svc.submit(b.taskId, { clientInputId: 'plan-fixture-2327', text: 'make a plan', expectedSelectionRevision: 1 }); await until(() => !!b.runs.runForTask(b.taskId) && b.runs.busy(b.runs.runForTask(b.taskId)!.runId));
  b.emitter.emit({ type: 'item.completed', nativeItemId: 'tool-message', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'plan-tool', name: 'ExitPlanMode', input: { plan } }] } });
  const snap = b.svc.snapshot(b.taskId), row = snap.items.find(x => x.type === 'proposed_plan')!;
  const originalPayloadBytes = Buffer.byteLength(JSON.stringify({ name: 'ExitPlanMode', input: { plan }, status: 'running', plan }));
  const storedPayload = JSON.parse(b.store.itemById(b.taskId, row.itemId)!.payloadJson);
  let bodyComplete = false; mocks.snapshot.mockResolvedValue(snap); mocks.itemBody.mockImplementation(async (taskId, itemId, off, revision) => { const r = b.svc.itemBody(taskId, itemId, off, revision); if (r.done) bodyComplete = true; return r; });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<AgentTaskView taskId={b.taskId} />);
  const copy = await screen.findByRole('button', { name: '复制' }); fireEvent.click(copy);
  await waitFor(() => expect(mocks.itemBody).toHaveBeenCalled());
  await waitFor(() => expect(bodyComplete).toBe(true)); await act(async () => {});
  fireEvent.click(copy); await act(async () => {});
  observations.T02 = { originalPlanBytes: Buffer.byteLength(plan), projectedPayloadBytes: originalPayloadBytes, storedTruncated: storedPayload.truncated, storedHasFullPlan: typeof storedPayload.plan === 'string', fullBodyReads: mocks.itemBody.mock.calls.length, copyCalls: writeText.mock.calls.map(x => ({ chars: String(x[0]).length, complete: x[0] === plan })), notices: mocks.toast.mock.calls.map(x => x[0]) };
  expect(writeText.mock.calls.every(c => c[0] === plan)).toBe(true);
  expect(writeText.mock.calls.length > 0 || mocks.toast.mock.calls.some(c => /失败|不完整|无法|截断/.test(String(c[0])))).toBe(true);
});
