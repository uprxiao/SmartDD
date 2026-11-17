// @vitest-environment jsdom
// Isolated component contract checks. These are NOT browser / packaged-App evidence.
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), respond: vi.fn(), stop: vi.fn(), toast: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { agentTasks: mocks },
  events: { on: () => () => {} },
}));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: () => null }));
vi.mock('../../../src/renderer/features/agent-tasks/agent-terminal', () => ({ AgentTerminalDrawer: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import { AgentTaskView } from '../../../src/renderer/features/agent-tasks/agent-task-view';

const observations: Record<string, unknown> = {};
afterAll(() => writeFileSync('docs/review/evidence-20261117-1620/ui-observations.json', JSON.stringify(observations, null, 2) + '\n'));
afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.mockResolvedValue([{ profileId: 'p', name: 'Codex', tiers: ['ask', 'auto', 'full'], models: [], driverId: 'codex-app-server' }]);
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.saveDraft.mockResolvedValue({ ok: true, revision: 1 });
  mocks.respond.mockResolvedValue(undefined);
  HTMLElement.prototype.scrollTo = vi.fn();
});
function snapshot(extra: any = {}) {
  return { taskId: 'task', title: 'review task', cwd: '/w', projectId: null, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' }, selectionRevision: 1, draft: { draft: { text: 'first draft' }, revision: 0 }, items: [], turns: [], requests: [], queued: [], run: null, goal: null, status: 'idle', seq: 1, ...extra };
}
async function mount() {
  render(<AgentTaskView taskId="task" />);
  return await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
}

it('RC15: text typed while awaiting a durable send receipt must survive that receipt', async () => {
  let done!: (x: any) => void;
  mocks.submit.mockImplementation(() => new Promise(r => { done = r; }));
  const input = await mount();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: 'new draft typed after sending' } });
  await act(async () => { done({ status: 'accepted' }); });
  observations.RC15 = { submitted: mocks.submit.mock.calls[0][1].text, expectedRemainingDraft: 'new draft typed after sending', actualRemainingDraft: input.value };
  expect(input.value).toBe('new draft typed after sending');
});

it('RC16: repeated send before a receipt must reuse one input id or be disabled', async () => {
  const waiting: ((x: any) => void)[] = [];
  mocks.submit.mockImplementation(() => new Promise(r => { waiting.push(r); }));
  const input = await mount();
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' });
  const calls = mocks.submit.mock.calls.map(c => ({ clientInputId: c[1].clientInputId, text: c[1].text }));
  await act(async () => { for (const r of waiting) r({ status: 'accepted' }); });
  observations.RC16 = { calls, distinctInputIds: new Set(calls.map(c => c.clientInputId)).size };
  expect(new Set(calls.map(c => c.clientInputId)).size).toBe(1);
});

it('RC17: numeric request shortcut must select first, and wait for Enter to confirm', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({
    status: 'waiting', run: { runId: 'r', driverId: 'codex-app-server', generation: 1, tier: 'ask', busy: true, steer: false },
    requests: [{ requestId: 'approval', revision: 1, class: 'native', kind: 'command_approval', status: 'pending', origin: {}, payload: { method: 'item/commandExecution/requestApproval', params: { command: 'git commit' } } }],
  }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByRole('dialog', { name: '待处理请求' });
  fireEvent.keyDown(window, { key: '1' });
  await act(async () => {});
  observations.RC17 = { keysPressed: ['1'], enterPressed: false, respondCalls: mocks.respond.mock.calls };
  expect(mocks.respond).not.toHaveBeenCalled();
});
