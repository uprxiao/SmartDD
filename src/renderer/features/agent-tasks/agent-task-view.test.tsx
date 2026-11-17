// @vitest-environment jsdom
// M14-A45 长内容全文与复制、A43 草稿初始化竞态（复核 2127 FR04／FR05）：组件层回归，不代替打包 App 验收。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), on: vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn(), draftBody: vi.fn(), toast: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: mocks }, events: { on: mocks.on } }));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: () => null }));
vi.mock('./agent-terminal', () => ({ AgentTerminalDrawer: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import { AgentTaskView } from './agent-task-view';

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.mockResolvedValue([]);
  mocks.saveDraft.mockResolvedValue({ ok: true, revision: 1 });
  mocks.on.mockImplementation(() => () => {});
  mocks.prepareAttachment.mockResolvedValue({ id: 'prepared', kind: 'path', name: 'note.txt', mime: 'text/plain', size: 1, image: false, relativePath: 'note.txt' });
  (window as any).electronAPI = { pathForFile: () => '/w/note.txt' };
  HTMLElement.prototype.scrollTo = vi.fn();
});
const snapshot = (extra: any = {}) => ({ taskId: 'task', title: 't', cwd: '/w', projectId: null, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' }, selectionRevision: 1, draft: null, items: [], turns: [], requests: [], queued: [], queuedTotal: 0, run: null, goal: null, goalPending: null, status: 'idle', seq: 1, hasOlder: false, ...extra });
const item = (type: string, payload: any) => ({ itemId: 'long', turnId: null, ordinal: 1, revision: 1, type, terminal: 'completed', createdAt: '', updatedAt: '', payload });
/** 把完整正文按两段返回，模拟按字节分段读取。 */
const serveInTwo = (payload: unknown) => { const t = JSON.stringify(payload), mid = Math.floor(t.length / 2); return (_: string, __: string, off: number) => Promise.resolve(off === 0 ? { chunk: t.slice(0, mid), next: 1, done: false } : { chunk: t.slice(mid), next: 2, done: true }); };

it('FR04：截断的计划复制前先读取全文，复制内容完整', async () => {
  const plan = 'PLAN_' + 'p'.repeat(30 * 1024) + '_TAIL';
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mocks.itemBody.mockImplementation(serveInTwo({ plan }));
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('proposed_plan', { plan: plan.slice(0, 2000), truncated: true, bytes: plan.length })] }));
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '复制' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toBe(plan);
});

it('FR04：读取全文失败时不复制残缺内容并提示', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mocks.itemBody.mockRejectedValue(new Error('读取失败'));
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('proposed_plan', { plan: 'p'.repeat(2000), truncated: true, bytes: 40_000 })] }));
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '复制' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('读取完整内容失败')));
  expect(writeText).not.toHaveBeenCalled();
});

it('FR04：截断的用户消息可展开全文', async () => {
  const text = 'USER_' + 'u'.repeat(30 * 1024) + '_USER_TAIL';
  mocks.itemBody.mockImplementation(serveInTwo({ text }));
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('user_message', { text: text.slice(0, 2000), truncated: true })] }));
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: /展开全文/ }));
  expect(await screen.findByText(/_USER_TAIL/)).toBeTruthy();
});

function holdInit() {
  let initial!: (s: any) => void, event!: (e: any) => void;
  mocks.on.mockImplementation((name: any, cb: any) => { if (String(name?.name ?? name).includes('event')) event = cb; return () => {}; });
  return { setInitial: (later: any) => mocks.snapshot.mockImplementationOnce(() => new Promise(r => { initial = r; })).mockResolvedValue(later), fire: (seq: number) => event({ taskId: 'task', seq, type: 'item.created' }), resolve: (s: any) => initial(s) };
}

it('FR05：更新的快照先到也加载已保存的草稿，晚到的旧初始化不影响', async () => {
  const h = holdInit();
  h.setInitial(snapshot({ seq: 20, draft: { draft: { text: 'saved server draft' }, revision: 7 } }));
  render(<AgentTaskView taskId="task" />);
  await act(async () => { h.fire(20); await new Promise(r => setTimeout(r, 120)); });
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value).toBe('saved server draft'));
  await act(async () => h.resolve(snapshot({ seq: 5, draft: { draft: { text: 'older draft' }, revision: 3 } })));
  expect(input.value).toBe('saved server draft');
});

it('FR05：初始化前粘贴的附件，在同水位初始化快照到达后保留', async () => {
  const h = holdInit();
  h.setInitial(snapshot({ seq: 20 }));
  render(<AgentTaskView taskId="task" />);
  await act(async () => { h.fire(20); await new Promise(r => setTimeout(r, 120)); });
  const input = await screen.findByPlaceholderText('随心输入');
  fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'note.txt', { type: 'text/plain' })] } });
  await screen.findByText('note.txt');
  await act(async () => h.resolve(snapshot({ seq: 20, draft: { draft: { text: '', attachments: [] }, revision: 2 } })));
  expect(screen.queryByText('note.txt')).not.toBeNull();
});

it('FR05：过大的草稿分段读回', async () => {
  const text = '草稿'.repeat(30_000);
  mocks.draftBody.mockImplementation((_: string, off: number) => serveInTwo({ text })('', '', off));
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, revision: 4, truncated: true, bytes: 180_000 } }));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value).toBe(text));
});
