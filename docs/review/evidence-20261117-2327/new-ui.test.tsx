// @vitest-environment jsdom
// Isolated component contract checks. These are NOT browser / packaged-App evidence.
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), respond: vi.fn(), stop: vi.fn(), toast: vi.fn(), on: vi.fn(), command: vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn() }));
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
afterAll(() => writeFileSync('docs/review/evidence-20261117-2327/new-ui-observations.json', JSON.stringify(observations, null, 2) + '\n'));
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

function item(type: string, payload: any, id = 'long') {
  return { itemId: id, turnId: null, ordinal: 1, revision: 1, type, terminal: 'completed', createdAt: '2026-11-17', updatedAt: '2026-11-17', payload };
}
it('F06a: previewed long user message must expose a route to its original text', async () => {
  const original = 'USER_PREFIX_' + 'u'.repeat(30 * 1024) + '_USER_TAIL';
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('user_message', { text: original.slice(0, 4000), truncated: true, bytes: original.length })] }));
  await mount(); const expand = screen.queryByRole('button', { name: /展开全文/ });
  observations.F06a = { previewChars: 4000, originalChars: original.length, originalVisible: !!screen.queryByText(/_USER_TAIL/), hasFullTextAction: !!expand };
  expect(expand || screen.queryByText(/_USER_TAIL/)).not.toBeNull();
});
it('F06b: previewed plan must expose full content before copying or downloading', async () => {
  const original = 'PLAN_PREFIX_' + 'p'.repeat(30 * 1024) + '_PLAN_TAIL';
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('proposed_plan', { plan: original.slice(0, 4000), truncated: true, bytes: original.length })] }));
  await mount(); const expand = screen.queryByRole('button', { name: /展开全文/ });
  observations.F06b = { previewChars: 4000, originalVisible: !!screen.queryByText(/_PLAN_TAIL/), hasFullTextAction: !!expand, copyButtonPresent: !!screen.queryByRole('button', { name: '复制' }), downloadButtonPresent: !!screen.queryByRole('button', { name: '下载' }) };
  expect(expand || screen.queryByText(/_PLAN_TAIL/)).not.toBeNull();
});
it('F07a: newer first snapshot must still restore saved draft if old initialization is discarded', async () => {
  let initial!: (s: any) => void, event!: (e: any) => void;
  mocks.on.mockImplementation((name, callback) => { if (name.name === 'agentTasks:event') event = callback; return () => {}; });
  const newer = snapshot({ title: 'newer first', seq: 20, draft: { draft: { text: 'saved server draft' }, revision: 7 } });
  mocks.snapshot.mockImplementationOnce(() => new Promise(r => { initial = r; })).mockResolvedValue(newer);
  render(<AgentTaskView taskId="task" />);
  await act(async () => { event({ taskId: 'task', seq: 20, type: 'item.created' }); await new Promise(r => setTimeout(r, 100)); });
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await act(async () => initial(snapshot({ seq: 5, draft: { draft: { text: 'older draft' }, revision: 3 } })));
  observations.F07a = { expectedSavedDraft: 'saved server draft', editorText: input.value };
  expect(input.value).toBe('saved server draft');
});
it('F07b: attachments edited before equal-watermark initialization must survive', async () => {
  let initial!: (s: any) => void, event!: (e: any) => void;
  mocks.on.mockImplementation((name, callback) => { if (name.name === 'agentTasks:event') event = callback; return () => {}; });
  mocks.snapshot.mockImplementationOnce(() => new Promise(r => { initial = r; })).mockResolvedValue(snapshot({ seq: 20 }));
  render(<AgentTaskView taskId="task" />);
  await act(async () => { event({ taskId: 'task', seq: 20, type: 'item.created' }); await new Promise(r => setTimeout(r, 100)); });
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'note.txt', { type: 'text/plain' })] } });
  await screen.findByText('note.txt'); await waitFor(() => expect(mocks.prepareAttachment).toHaveBeenCalledTimes(1));
  await act(async () => initial(snapshot({ seq: 20 })));
  const retained = !!screen.queryByText('note.txt'); observations.F07b = { pastedBeforeInitialReceipt: true, sameSeq: 20, retained };
  expect(retained).toBe(true);
});

it('F06c: plan copy must include the complete original plan rather than its preview', async () => {
  const original = 'PLAN_PREFIX_' + 'p'.repeat(30 * 1024) + '_PLAN_TAIL', writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const body = JSON.stringify({ plan: original }); mocks.itemBody.mockResolvedValue({ chunk: body, next: Buffer.byteLength(body), totalBytes: Buffer.byteLength(body), done: true });
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('proposed_plan', { plan: original.slice(0, 4000), truncated: true, bytes: original.length })] }));
  await mount(); fireEvent.click(screen.getByRole('button', { name: '复制' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = String(writeText.mock.calls[0][0]); observations.F06c = { expectedChars: original.length, copiedChars: copied.length, tailCopied: copied.endsWith('_PLAN_TAIL') };
  expect(copied.length).toBe(original.length);
});
