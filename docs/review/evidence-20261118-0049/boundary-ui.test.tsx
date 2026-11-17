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
import { AgentTaskView } from '../../../src/renderer/features/agent-tasks/agent-task-view';

const observations: Record<string, unknown> = {};
afterAll(() => writeFileSync('docs/review/evidence-20261118-0049/boundary-ui-observations.json', JSON.stringify(observations, null, 2) + '\n'));
afterEach(() => cleanup());
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

function item(type: string, payload: any, revision = 1) { return { itemId: 'updating-item', turnId: null, ordinal: 1, revision, type, terminal: 'completed', createdAt: '2026-11-17', updatedAt: '2026-11-17', payload }; }
it('Q04ui: an irrecoverably truncated legacy draft must report damage and not silently save an empty draft', async () => {
  const originalSize = 256 * 1024, stored = { truncated: true, bytes: originalSize + 11, sha256: 'test', head: '{"text":"' + 'D'.repeat(64 * 1024) };
  const body = JSON.stringify(stored);
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, truncated: true, bytes: body.length, revision: 1 } }));
  mocks.draftBody.mockResolvedValue({ chunk: body, next: Buffer.byteLength(body), done: true, revision: 1 });
  const input = await mount(); await waitFor(() => expect(mocks.draftBody).toHaveBeenCalled()); await act(async () => {});
  observations.Q04ui = { acceptedOriginalTextChars: originalSize, editorCharsAfterReload: input.value.length, warnings: mocks.toast.mock.calls.map(c => c[0]) };
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('无法恢复')); expect(mocks.saveDraft).not.toHaveBeenCalled();
});
it('Q05: expanded todo payload must refresh when the item revision advances', async () => {
  let event!: (e: any) => void;
  mocks.on.mockImplementation((name, cb) => { if (name.name === 'agentTasks:event') event = cb; return () => {}; });
  const entries = Array.from({ length: 50 }, (_, i) => ({ id: 'todo-' + i, subject: 'task-' + i + '-' + 'x'.repeat(600), status: 'pending' }));
  let full = { entries }; const response = () => { const chunk = JSON.stringify(full); return { chunk, next: Buffer.byteLength(chunk), done: true }; };
  mocks.itemBody.mockImplementation(async () => response());
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('todo_list', { entries: entries.slice(0, 20), truncated: true })] }));
  await mount(); fireEvent.click(screen.getByRole('button', { name: /展开全文/ }));
  await screen.findByText(entries[49].subject);
  full = { entries: entries.map((e, i) => i === 0 ? { ...e, status: 'completed' } : e) };
  mocks.snapshot.mockResolvedValue(snapshot({ seq: 2, title: 'updated task', items: [item('todo_list', { entries: full.entries.slice(0, 20), truncated: true }, 2)] }));
  await act(async () => { event({ taskId: 'task', seq: 2, type: 'item.updated' }); await new Promise(r => setTimeout(r, 100)); });
  await screen.findByRole('heading', { name: 'updated task' });
  const row = screen.getByText(entries[0].subject).closest('.agent-todo-row');
  observations.Q05 = { acceptedSnapshotSeq: 2, latestItemRevision: 2, latestStatus: 'completed', renderedRowClass: row?.className, bodyFetches: mocks.itemBody.mock.calls.length };
  expect(row?.classList.contains('completed')).toBe(true);
});
