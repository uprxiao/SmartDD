// @vitest-environment jsdom
// M14-A45 长内容全文与复制、A43 草稿初始化竞态（复核 2127 FR04／FR05）：组件层回归，不代替打包 App 验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), managedSkills: vi.fn(), history: vi.fn(), events: vi.fn(), historyItems: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), holdDraftAttachments: vi.fn(), on: vi.fn(), archive:vi.fn(), unarchive:vi.fn(), discardAttachment:vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn(), draftBody: vi.fn(), businessReview: vi.fn(), requestBody: vi.fn(), respond: vi.fn(), readUserInput: vi.fn(), editQueued: vi.fn(), sendQueued: vi.fn(), cancelQueued: vi.fn(), retryFailedInput: vi.fn(), stop: vi.fn(), forceStop: vi.fn(), setReplyLiked: vi.fn(), branchFromReply: vi.fn(), saveProjectPlan: vi.fn(), command: vi.fn(), goal: vi.fn(), toast: vi.fn() }));
const imageRead = vi.hoisted(() => vi.fn());
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: Object.assign(mocks, { attachmentImage: imageRead }) }, events: { on: mocks.on } }));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn(), openAgentTask:vi.fn(), setAgentTaskReadOnly:vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: ({title,children,footer}: {title:string;children:React.ReactNode;footer:React.ReactNode}) => <div role="dialog" aria-label={title}>{children}{footer}</div> }));
vi.mock('./agent-terminal', () => ({ AgentTerminalDrawer: ({ onClose }: { onClose: () => void }) => <div data-testid="mock-terminal"><button type="button" onClick={onClose}>mock-close-terminal</button></div> }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import {agentComposerTargets} from './composer-target';
import { AgentTaskView } from './agent-task-view';
import { navigation } from '@renderer/core/navigation';
import { AgentChildSummary, type Relations } from './agent-relations';

function render(element: React.ReactElement) {
  const client = new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}});
  return renderView(element, {wrapper: ({children}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>});
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.mockResolvedValue([]);
  mocks.history.mockReset();
  mocks.events.mockReset().mockResolvedValue([]);
  mocks.historyItems.mockReset().mockResolvedValue([]);
  mocks.discardAttachment.mockResolvedValue(undefined);
  mocks.saveDraft.mockReset().mockResolvedValue({ ok: true, revision: 1 });
  mocks.holdDraftAttachments.mockReset().mockResolvedValue(undefined);
  mocks.stop.mockReset().mockResolvedValue({ stopped: true });
  mocks.on.mockImplementation(() => () => {});
  mocks.prepareAttachment.mockResolvedValue({ id: 'prepared', kind: 'path', name: 'note.txt', mime: 'text/plain', size: 1, image: false, relativePath: 'note.txt' });
  (window as any).electronAPI = { pathForFile: () => '/w/note.txt' };
  HTMLElement.prototype.scrollTo = vi.fn();
});
const snapshot = (extra: any = {}) => ({ taskId: 'task', title: 't', cwd: '/w', projectId: null, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' }, selectionRevision: 1, draft: null, items: [], turns: [], requests: [], queued: [], queuedTotal: 0, run: null, goal: null, goalPending: null, status: 'idle', seq: 1, hasOlder: false, ...extra });
const item = (type: string, payload: any) => ({ itemId: 'long', turnId: null, ordinal: 1, revision: 1, type, terminal: 'completed', createdAt: '', updatedAt: '', payload });

it('refreshes the managed Skill list when reopening $ in the same task', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({
    run: { catalog: { commands: [], skills: [{ name: 'open-source-radar' }] } },
  }));
  mocks.managedSkills.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'source-driven-ui-test' }]);
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入');
  fireEvent.change(input, { target: { value: '$source' } });
  await waitFor(() => expect(mocks.managedSkills).toHaveBeenCalledWith('task'));
  expect(screen.queryByRole('option', { name: /source-driven-ui-test/ })).toBeNull();
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.change(input, { target: { value: '$source' } });
  const fresh = await screen.findByRole('option', { name: /source-driven-ui-test.*WillYou 纳管/ });
  expect(screen.getAllByRole('option')[0]).toBe(fresh);
  fireEvent.keyDown(input, { key: 'Tab' });
  expect((input as HTMLTextAreaElement).value).toBe('$source-driven-ui-test ');
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('switches the single composer button between stop and queue, with a separate stop action in the task header', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'working', run: { runId: 'active', busy: true, steer: true } }));
  mocks.submit.mockResolvedValue({ status: 'queued' });
  const { container } = render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('继续输入，本轮结束后发送');
  const bar = within(container.querySelector('.agent-composer-bar')! as HTMLElement);
  const primary = bar.getByRole('button', { name: '停止本轮' });
  expect(bar.queryByRole('button', { name: '发送' })).toBeNull();
  fireEvent.change(input, { target: { value: '下一轮的草稿' } });
  expect(bar.getByRole('button', { name: '加入队列' })).toBe(primary);
  expect(within(screen.getByLabelText('当前任务')).getByRole('button', { name: '停止本轮' })).toBeTruthy();
  fireEvent.click(primary);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('task', expect.objectContaining({ text: '下一轮的草稿', mode: 'queue' })));
  expect(mocks.stop).not.toHaveBeenCalled();
});

it('handles Escape only once for the focused composer and leaves other controls and composition alone', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'working', run: { runId: 'active', busy: true } }));
  let finishStop!: () => void;
  mocks.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finishStop = resolve; }));
  const { container } = render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('继续输入，本轮结束后发送');
  const primary = within(container.querySelector('.agent-composer-bar')! as HTMLElement).getByRole('button', { name: '停止本轮' });
  expect(primary.getAttribute('aria-keyshortcuts')).toBe('Escape');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(input, { key: 'Escape', repeat: true });
  expect(mocks.stop).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.stop).toHaveBeenCalledWith('task', false, 'active');
  expect((screen.getByRole('button', { name: '正在停止…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finishStop());
});

it('resumes the first held queue entry on click and switches to sending when a draft is entered', async () => {
  const first = { turnId: 'first', version: 'v1', text: '之前排队的消息', sourceKind: 'user', editable: true, attachmentCount: 0 };
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'stopped', queuedTotal: 1, queued: [first] }));
  mocks.sendQueued.mockResolvedValue({ status: 'queued' });
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入');
  const resume = screen.getByRole('button', { name: '继续排队消息' });
  fireEvent.click(resume, { detail: 2 });
  expect(mocks.sendQueued).not.toHaveBeenCalled();
  fireEvent.click(resume);
  await waitFor(() => expect(mocks.sendQueued).toHaveBeenCalledWith('task', 'first', 'v1', 1));
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '新的草稿' } });
  expect(screen.getByRole('button', { name: '发送' })).toBe(resume);
});

it('offers continuation for a supported paused goal through the existing goal operation', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'stopped', run: { goal: true, busy: false },
    goal: { status: 'paused', objective: '检查依赖', pausedReason: 'user' } }));
  mocks.goal.mockResolvedValue({ ok: true });
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '继续目标' }));
  await waitFor(() => expect(mocks.goal).toHaveBeenCalledWith('task', { kind: 'resume' }));
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('keeps a stopped conversation without a resumable action ready for the next draft', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'stopped' }));
  render(<AgentTaskView taskId="task" />);
  const send = await screen.findByRole('button', { name: '发送' }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: /^继续(排队消息|目标)$/ })).toBeNull();
});

it('shows one ended work entry above the final reply and opens the full process below it', async () => {
  const turnId = 'multi-stage';
  const started = '2026-11-23T00:00:00Z', ended = '2026-11-23T00:00:35Z';
  const items = [
    item('user_message', { text: '用户消息' }),
    item('assistant_message', { text: '开始检查' }),
    item('tool_call', { name: 'first' }),
    item('assistant_message', { text: '再检查一项' }),
    item('command_execution', { name: 'second', input: { command: 'date' } }),
    item('assistant_message', { text: '这是最终回复' }),
  ].map((entry, ordinal) => ({ ...entry, ordinal, turnId, itemId: `entry-${ordinal}`, updatedAt: '2026-11-23T00:01:00Z' }));
  mocks.snapshot.mockResolvedValue(snapshot({ items, status: 'completed', turns: [
    { turn_id: turnId, status: 'completed', accepted_at: started, started_at: started, ended_at: ended },
  ] }));
  render(<AgentTaskView taskId="task" />);
  const reply = await screen.findByText('这是最终回复');
  const fold = screen.getByRole('button', { name: '用时 35 秒' });
  expect(screen.getAllByText(/用时 35 秒|已工作 35 秒/)).toHaveLength(1);
  expect(fold.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('开始检查')).toBeNull();
  fireEvent.click(fold);
  const intro = screen.getByText('开始检查'), next = screen.getByText('再检查一项');
  expect(intro.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(next.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const completedTime = reply.closest('.agent-assistant')?.querySelector('time');
  expect(completedTime?.dateTime).toBe(new Date(ended).toISOString());
  expect(completedTime?.textContent?.trim()).toMatch(/^\d{1,2}:\d{2}$/);
});

it('shows reasoning recorded after the answer above the completed reply when work is expanded', async () => {
  const turnId = 'late-reasoning';
  const started = '2026-11-23T00:00:00Z', ended = '2026-11-23T00:00:03Z';
  const items = [
    item('user_message', { text: '当前是哪个目录？' }),
    item('assistant_message', { text: '当前目录是 /w' }),
    item('reasoning', { text: '从当前会话读取目录' }),
  ].map((entry, ordinal) => ({ ...entry, ordinal, turnId, itemId: `late-reasoning-${ordinal}` }));
  mocks.snapshot.mockResolvedValue(snapshot({ items, status: 'completed', turns: [
    { turn_id: turnId, status: 'completed', accepted_at: started, started_at: started, ended_at: ended },
  ] }));
  render(<AgentTaskView taskId="task" />);
  const reply = await screen.findByText('当前目录是 /w');
  const fold = screen.getByRole('button', { name: '用时 3 秒' });
  expect(screen.queryByText('思考')).toBeNull();
  fireEvent.click(fold);
  const reasoning = screen.getByText('思考');
  const actions = screen.getByRole('group', { name: '回复操作' });
  expect(fold.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reasoning.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reply.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(fold);
  expect(screen.queryByText('思考')).toBeNull();
  expect(screen.getByText('当前目录是 /w')).toBe(reply);
  expect(screen.getByRole('group', { name: '回复操作' })).toBe(actions);
});

it('shows the thinking prompt below the single work separator', async () => {
  const turnId = 'starting-phase';
  const startedAt = new Date().toISOString();
  const user = { ...item('user_message', { text: '先解释一下' }), turnId };
  mocks.snapshot.mockResolvedValue(snapshot({ items: [user], status: 'working', turns: [
    { turn_id: turnId, status: 'started', accepted_at: startedAt, started_at: startedAt, ended_at: null },
  ] }));
  render(<AgentTaskView taskId="task" />);
  const thinking = (await screen.findByText('思考中……')).closest('[role=status]')!;
  expect(thinking.querySelector('svg')).toBeTruthy();
  const turn = thinking.closest('.agent-turn')!;
  const separators = turn.querySelectorAll('.agent-work-divider');
  expect(separators).toHaveLength(1);
  expect(thinking.previousElementSibling).toBe(separators[0].parentElement);
});

it('runs a single live clock for multiple process segments', async () => {
  const turnId = 'active-clock';
  const now = new Date(Date.now() - 5_000).toISOString();
  const items = [
    item('user_message', { text: '查一下两处' }),
    item('command_execution', { command: 'first', status: 'completed' }),
    item('assistant_message', { text: '继续检查第二处' }),
    { ...item('command_execution', { command: 'second', status: 'running' }), terminal: null },
  ].map((entry, ordinal) => ({ ...entry, ordinal, turnId, itemId: `working-${ordinal}` }));
  mocks.snapshot.mockResolvedValue(snapshot({ items, status: 'working', turns: [
    { turn_id: turnId, status: 'started', accepted_at: now, started_at: now, ended_at: null },
  ] }));
  render(<AgentTaskView taskId="task" />);
  const clock = await screen.findByRole('button', { name: /^工作中 \d+ 秒$/ });
  expect(screen.getAllByRole('button', { name: /^工作中 \d+ 秒$/ })).toHaveLength(1);
  expect(clock.closest('.agent-turn')?.querySelectorAll('.agent-work-divider')).toHaveLength(1);
  expect(screen.getByText('继续检查第二处')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '分支到新聊天' })).toBeNull();
  const initial = clock.textContent;
  await waitFor(() => expect(clock.textContent).not.toBe(initial), { timeout: 2200 });
});

it('can like, undo the like, and open a branch from a completed reply', async () => {
  const entry = { ...item('assistant_message', { text: '可操作的回复' }), itemId: 'reply-actions', turnId: 'completed' };
  const time = '2026-11-23T00:00:35Z';
  mocks.snapshot.mockResolvedValue(snapshot({ items: [entry], status: 'completed', turns: [
    { turn_id: entry.turnId, status: 'completed', accepted_at: time, started_at: time, ended_at: time },
  ] }));
  mocks.setReplyLiked.mockImplementation(async (_taskId, _replyId, liked) => ({ liked }));
  mocks.branchFromReply.mockResolvedValue({ taskId: 'new-chat' });
  render(<AgentTaskView taskId="task" />);
  const like = await screen.findByRole('button', { name: '点赞' });
  fireEvent.click(like);
  await screen.findByRole('button', { name: '取消点赞', pressed: true });
  expect(mocks.setReplyLiked).toHaveBeenCalledWith('task', entry.itemId, true);
  fireEvent.click(screen.getByRole('button', { name: '取消点赞' }));
  await screen.findByRole('button', { name: '点赞', pressed: false });
  expect(mocks.setReplyLiked).toHaveBeenLastCalledWith('task', entry.itemId, false);
  fireEvent.click(screen.getByRole('button', { name: '分支到新聊天' }));
  await waitFor(() => expect(navigation.openAgentTask).toHaveBeenCalledWith('new-chat'));
  expect(mocks.branchFromReply).toHaveBeenCalledWith('task', entry.itemId);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('shows the actions and completion time for each completed reply without hover or focus', async () => {
  const times = ['2026-11-23T00:00:35.000Z', '2026-11-23T00:01:20.000Z'];
  const replies = ['回复 1\n\n| 环境 | 结果 |\n| --- | --- |\n| 生产 | 正常 |', '回复 2'];
  const items = times.map((time, index) => ({ ...item('assistant_message', { text: replies[index] }),
    itemId: `reply-${index}`, turnId: `turn-${index}`, ordinal: index, updatedAt: time }));
  const turns = times.map((time, index) => ({ turn_id: items[index].turnId, status: 'completed', accepted_at: time,
    started_at: time, ended_at: time }));
  mocks.snapshot.mockResolvedValue(snapshot({ items, turns, status: 'completed' }));
  const style = document.createElement('style');
  style.textContent = readFileSync('src/renderer/features/agent-tasks/agent-tasks.css', 'utf8');
  document.head.append(style);
  try {
    render(<AgentTaskView taskId="task" />);
    const groups = await screen.findAllByRole('group', { name: '回复操作' });
    expect(groups).toHaveLength(2);
    const table = screen.getByRole('region', { name: '回复表格' });
    expect(within(table).getByRole('cell', { name: '生产' })).toBeTruthy();
    expect(getComputedStyle(table).overflowX).toBe('auto');
    for (const [index, group] of groups.entries()) {
      expect(group.contains(document.activeElement)).toBe(false);
      const computed = getComputedStyle(group);
      expect(computed.display).toBe('flex');
      expect(computed.opacity || '1').toBe('1');
      expect([...group.children].map(node => node.getAttribute('aria-label') ?? node.getAttribute('datetime')))
        .toEqual(['复制回复', '点赞', '分支到新聊天', times[index]]);
    }
  } finally {
    style.remove();
  }
});

it.each([true, false])('keeps completed request timing inside the work fold (has work items: %s)', async (hasWork) => {
  const turnId = 'wait-turn';
  const entries = [
    { ...item('user_message', { text: '用户问题' }), itemId: 'question' },
    ...(hasWork ? [{ ...item('tool_call', { name: 'fixture', status: 'completed' }), itemId: 'tool' }] : []),
    { ...item('assistant_message', { text: '完成后的回复' }), itemId: 'reply' },
  ].map((entry, ordinal) => ({ ...entry, ordinal, turnId }));
  mocks.snapshot.mockResolvedValue(snapshot({
    items: entries,
    turns: [{
      turn_id: turnId, status: 'completed', accepted_at: '2026-11-18T00:00:00Z',
      started_at: '2026-11-18T00:00:00Z', ended_at: '2026-11-18T00:00:42Z', native_wait_ms: 7000,
    }],
  }));
  render(<AgentTaskView taskId="task" />);
  const reply = await screen.findByText('完成后的回复');
  expect(screen.queryByText(/等待用户处理|用户处理耗时/)).toBeNull();
  const fold = screen.getByRole('button', { name: '用时 35 秒' });
  expect(fold.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(fold);
  const wait = screen.getByText('用户处理耗时 7 秒');
  expect(wait.closest('.agent-work')).toBe(fold.closest('.agent-work'));
  fireEvent.click(fold);
  expect(screen.queryByText('用户处理耗时 7 秒')).toBeNull();
});

/** 把完整正文按两段返回，模拟按字节分段读取。 */
const serveInTwo = (payload: unknown) => { const t = JSON.stringify(payload), mid = Math.floor(t.length / 2); return (_: string, __: string, off: number) => Promise.resolve(off === 0 ? { chunk: t.slice(0, mid), next: 1, done: false } : { chunk: t.slice(mid), next: 2, done: true }); };

it('A59 keeps the active status with the user message while startup diagnostics arrive', async () => {
  const turnId = 'hello-turn';
  const entry = (ordinal: number, type: string, payload: unknown) => ({ ...item(type, payload), itemId: `hello-${ordinal}`, turnId, ordinal });
  const items = [entry(1, 'user_message', { text: '你好' }), entry(2, 'system_notice', {
    code: 'mcpStartup', title: 'MCP 启动 · personal', severity: 'warning', diagnosticOnly: false, detail: '握手失败',
  })];
  const now = new Date().toISOString();
  const turn = { turn_id: turnId, status: 'accepted', accepted_at: now, started_at: null, ended_at: null, error_code: null };
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'working', preparingTurnId: turnId, turns: [turn], items }));
  const preparing = render(<AgentTaskView taskId="task" />);
  const user = await screen.findByText('你好');
  const work = within(user.closest('.agent-turn') as HTMLElement);
  expect(work.getByText('工作中 0 秒')).toBeTruthy();
  expect(work.getByText('思考中……')).toBeTruthy();
  expect(work.queryByText(/正在启动|正在准备执行器/)).toBeNull();
  preparing.unmount();

  mocks.snapshot.mockResolvedValue(snapshot({ status: 'working', turns: [{ ...turn, started_at: now, status: 'started' }], items }));
  const active = render(<AgentTaskView taskId="task" />);
  await screen.findByText('思考中……');
  expect(screen.queryByText(/MCP 启动 · personal/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  fireEvent.click(screen.getByRole('button', { name: '运行诊断' }));
  expect(within(screen.getByRole('dialog', { name: '运行诊断' })).getByText('MCP 启动 · personal')).toBeTruthy();
  active.unmount();

  mocks.snapshot.mockResolvedValue(snapshot({ status: 'completed', turns: [{ ...turn, started_at: now, ended_at: now, status: 'completed' }], items: [
    ...items, entry(3, 'files_changed', { fileCount: 0, status: 'incomplete', reason: '首次快照仍在后台准备' }),
    { ...entry(4, 'assistant_message', { text: '今天想一起做点什么？' }), updatedAt: now },
  ] }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<AgentTaskView taskId="task" />);
  await screen.findByText('今天想一起做点什么？');
  expect(screen.queryByText('思考中……')).toBeNull();
  expect(screen.queryByText('查看差异')).toBeNull();
  expect(screen.queryByText(/首次快照仍在后台准备/)).toBeNull();
  expect(screen.getByText('今天想一起做点什么？').closest('.agent-assistant')?.querySelector('time')?.dateTime).toBe(now);
  fireEvent.click(screen.getByRole('button', { name: '复制回复' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('今天想一起做点什么？'));
});

it('A26 shows the delegated child’s inherited tier without opening another permission choice', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ parentTaskId: 'parent' }));
  render(<AgentTaskView taskId="task" />);
  const tier = await screen.findByLabelText('权限档位');
  expect(tier).toHaveProperty('disabled', true);
  expect(tier).toHaveProperty('title', '跟随主任务的权限档位');
});

it('shows the actual current tier and the saved tier when the switch is deferred', async () => {
  const selection = { driverId: 'codex-app-server', profileId: 'p', tier: 'full' };
  mocks.snapshot.mockResolvedValue(snapshot({ selection, run: { busy: true, tier: 'ask' }, status: 'running' }));
  render(<AgentTaskView taskId="task" />);
  const trigger = await screen.findByLabelText('权限档位');
  expect(trigger.textContent).toBe('请求批准');
  expect(screen.getByText('下轮生效 · 完全访问权限')).toBeTruthy();
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu', { name: '权限' });
  expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
  expect(within(menu).getByRole('menuitemradio', { name: /完全访问权限/ }).getAttribute('aria-checked')).toBe('true');
  expect(within(menu).queryByText('了解更多')).toBeNull();
});

it.each(['claude-sdk', 'antigravity-acp'])('shows only manual and full tiers for %s', async driverId => {
  mocks.snapshot.mockResolvedValue(snapshot({ selection: { driverId, profileId: 'p', tier: 'full' }, run: { busy: true, tier: 'full' } }));
  render(<AgentTaskView taskId="task" />);
  const trigger = await screen.findByLabelText('权限档位');
  expect(trigger.textContent).toBe('完全访问权限');
  expect(trigger.classList.contains('danger')).toBe(true);
  expect(screen.queryByText(/下轮生效/)).toBeNull();
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu', { name: '权限' });
  expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
  expect(within(menu).queryByText('帮我批准')).toBeNull();
});

it('A59 shows the recorded target and model in one creation card and keeps old delegation rows readable', async () => {
  const created = { ...item('thread_created', { childTaskId: 'child', title: 'New child', target: { name: 'Codex review' }, model: 'review-model', workspaceMode: 'shared', access: 'write' }), itemId: 'creation' };
  const historical = { ...item('subtask', { childTaskId: 'old-child', title: 'Old child', workspaceMode: 'shared', access: 'write' }), itemId: 'old' };
  mocks.snapshot.mockResolvedValue(snapshot({ items: [created, historical] }));
  render(<AgentTaskView taskId="task" />);
  expect(await screen.findByText('Codex review · review-model · 共用目录 · 写入队列')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '宿主子任务 · New child' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '宿主子任务 · Old child' })).toBeTruthy();
});

it('queue shows host notifications as a status line, not their internal wording', async () => {
  const host = { turnId: 'host', text: '宿主子任务结果通知（来源 child_result，不是新的真人授权）。结果引用 r1', acceptedAt: '2026-11-19T00:00:00Z', editable: false, sourceKind: 'notification', version: 'v', attachmentCount: 0 };
  const user = { turnId: 'mine', text: 'My queued message', acceptedAt: '2026-11-19T00:00:01Z', editable: true, sourceKind: 'user', version: 'v2', attachmentCount: 0 };
  mocks.snapshot.mockResolvedValue(snapshot({ queued: [host, user], queuedTotal: 2 }));
  render(<AgentTaskView taskId="task" />);
  expect(await screen.findByText('子任务结果已送达，主任务稍后继续')).toBeTruthy();
  expect(screen.queryByText(/宿主子任务结果通知/)).toBeNull();
  expect(screen.getByText('My queued message')).toBeTruthy();
  expect(screen.getAllByTitle('删除排队消息')).toHaveLength(1);
});

it('child result card shows a Chinese status and the result text', async () => {
  const notice = { ...item('notification', { sourceKind: 'child_result', childTaskId: 'child', title: 'Review child', status: 'completed', summary: 'Review text' }), itemId: 'result' };
  mocks.snapshot.mockResolvedValue(snapshot({ items: [notice] }));
  render(<AgentTaskView taskId="task" />);
  expect(await screen.findByText('Review child · 已完成')).toBeTruthy();
  expect(screen.getByText('Review text')).toBeTruthy();
  expect(screen.queryByText(/completed/)).toBeNull();
});

it('A45 retains the available streaming prefix and marks a preview that exceeds its buffer', async () => {
  let publish!: (value: { taskId: string; itemKey: string; text: string }) => void;
  mocks.on.mockImplementation((event, callback) => { if (event.name === 'agentTasks:live') publish = callback; return () => {}; });
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'working' }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByRole('heading', { name: 't' });
  await act(async () => publish({ taskId: 'task', itemKey: 'answer', text: 'Visible live prefix' }));
  expect(screen.getByText('Visible live prefix')).toBeTruthy();
  await act(async () => publish({ taskId: 'task', itemKey: 'answer', text: '😀'.repeat(2 * 1024 * 1024) }));
  expect(screen.getByText('Visible live prefix')).toBeTruthy();
  expect(screen.getByText('部分内容未在流式预览中显示，完成后可查看全文。')).toBeTruthy();
});

it('A09 shows the MCP URL as text and confirms only cancellation', async () => {
  const url = 'http://127.0.0.1/local-mcp-test';
  const request = {
    requestId: 'mcp-url', kind: 'elicitation', origin: {}, revision: 1, status: 'pending',
    payload: { params: { serverName: 'Local MCP fixture', mode: 'url', message: 'Open the synthetic test page', url } },
  };
  mocks.snapshot.mockResolvedValue(snapshot({ requests: [request] }));
  mocks.respond.mockResolvedValue(undefined);
  render(<AgentTaskView taskId="task" />);
  const panel = within(await screen.findByRole('dialog', { name: '待处理请求' }));
  expect(panel.getByText(new RegExp(url))).toBeTruthy();
  expect(panel.queryByRole('link')).toBeNull();
  expect(panel.queryByRole('textbox')).toBeNull();
  expect(panel.queryByRole('option', { name: /批准/ })).toBeNull();
  fireEvent.click(panel.getByRole('option', { name: '取消 MCP 请求' }));
  expect(mocks.respond).not.toHaveBeenCalled();
  fireEvent.click(panel.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task', 'mcp-url', 1, { action: 'cancel' }));
});

it('P3: the request panel can revoke a queued approval while the original approve call is still pending', async () => {
  const request = { requestId: 'approval', kind: 'host_business', origin: {}, revision: 1, status: 'pending', payload: { title: '业务审批', phase: 'waiting_user' } };
  let state = snapshot({ requests: [request] });
  let publish!: (event: { taskId: string; seq: number }) => void;
  let finishApproval!: () => void;
  mocks.on.mockImplementation((event, cb) => { if (event.name === 'agentTasks:event') publish = cb; return () => {}; });
  mocks.snapshot.mockImplementation(async () => state);
  mocks.respond.mockImplementation(async (_task, _id, _revision, decision) => {
    if (decision.choice === 'allow') {
      state = snapshot({ seq: 2, requests: [{ ...request, revision: 2, payload: { ...request.payload, phase: 'queued_for_slot' } }] });
      publish({ taskId: 'task', seq: 2 });
      await new Promise<void>(resolve => { finishApproval = resolve; });
    } else {
      state = snapshot({ seq: 3 });
      finishApproval();
    }
  });
  render(<AgentTaskView taskId="task" />);
  // The composer (with its tier select) now stays below the panel, so look inside the request panel.
  fireEvent.click(within(await screen.findByRole('dialog', { name: '待处理请求' })).getByRole('option', { name: /^批准$/ }));
  expect(mocks.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(await screen.findByText(/正在等待宿主放行/)).toBeTruthy();
  const revoke = await screen.findByRole('option', { name: /撤销批准/ });
  expect((revoke as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(revoke);
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(mocks.respond).toHaveBeenLastCalledWith('task', 'approval', 2, { choice: 'cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '待处理请求' })).toBeNull());
});

it('A11/A32 keeps each approval usable while an unrelated business reply is pending', async () => {
  const business = {
    requestId: 'business', kind: 'host_business', origin: {}, revision: 1,
    status: 'pending', payload: { title: '慢业务审批', phase: 'waiting_user' },
  };
  const command = {
    requestId: 'command', kind: 'command_approval', origin: {}, revision: 1,
    status: 'pending', payload: { params: { command: 'pwd' } },
  };
  mocks.snapshot.mockResolvedValue(snapshot({ requests: [business, command] }));
  let finishBusiness!: () => void;
  let finishCommand!: () => void;
  mocks.respond.mockReset()
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishBusiness = resolve; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishCommand = resolve; }));
  render(<AgentTaskView taskId="task" />);
  const panel = within(await screen.findByRole('dialog', { name: '待处理请求' }));
  const approve = () => panel.getByRole('option', { name: /批准/ }) as HTMLButtonElement;
  const confirm = () => panel.getByRole('button', { name: '确认' });
  fireEvent.click(approve());
  fireEvent.click(confirm());
  expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task', 'business', 1, { choice: 'allow' });
  expect(approve().disabled).toBe(true);
  fireEvent.click(panel.getByRole('button', { name: '›' }));
  expect(approve().disabled).toBe(false);
  fireEvent.click(approve());
  fireEvent.click(confirm());
  expect(mocks.respond).toHaveBeenCalledTimes(2);
  expect(mocks.respond).toHaveBeenLastCalledWith('task', 'command', 1, expect.anything());
  expect(approve().disabled).toBe(true);
  await act(async () => { finishBusiness(); });
  expect(panel.getByText('pwd')).toBeTruthy();
  expect(approve().getAttribute('aria-selected')).toBe('true');
  expect(approve().disabled).toBe(true);
  await act(async () => { finishCommand(); });
});

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

it('A71 labels the plan source and requests a project save without approving the plan', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ projectId: 'project', items: [item('proposed_plan', { plan: 'First read the files' })] }));
  mocks.saveProjectPlan.mockResolvedValue({ state: 'saved' });
  render(<AgentTaskView taskId="task" />);
  expect(await screen.findByText('计划 · Claude Code 计划模式')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存到项目' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('计划已保存到任务目录的计划.md'));
  expect(mocks.saveProjectPlan).toHaveBeenCalledExactlyOnceWith('task', 'long', 1);
  expect(mocks.respond).not.toHaveBeenCalled();
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

it('A18 stops requesting pieces of a history item after leaving its task', async () => {
  let finishSecond!: (chunk: { chunk: string; next: number; done: boolean }) => void;
  mocks.itemBody.mockReset().mockImplementation((_task, _item, offset) => {
    if (offset === 0) return Promise.resolve({ chunk: '{"text":', next: 1, done: false });
    if (offset === 1) return new Promise(resolve => { finishSecond = resolve; });
    return Promise.resolve({ chunk: '}', next: 3, done: true });
  });
  mocks.snapshot.mockImplementation(async taskId => taskId === 'task'
    ? snapshot({ items: [item('user_message', { text: 'Waiting on history', truncated: true })] })
    : snapshot({ taskId, title: 'Other task', items: [] }));
  const view = render(<AgentTaskView key="task" taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: /展开全文/ }));
  await waitFor(() => expect(mocks.itemBody).toHaveBeenCalledTimes(2));
  view.rerender(<AgentTaskView key="other" taskId="other" />);
  await screen.findByRole('heading', { name: 'Other task' });
  await act(async () => finishSecond({ chunk: '"Old private history"', next: 2, done: false }));
  expect(mocks.itemBody).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Old private history')).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
});

function holdInit() {
  let initial!: (s: any) => void, event!: (e: any) => void;
  mocks.on.mockImplementation((name: any, cb: any) => { if (String(name?.name ?? name).includes('event')) event = cb; return () => {}; });
  return { setInitial: (later: any) => mocks.snapshot.mockImplementationOnce(() => new Promise(r => { initial = r; })).mockResolvedValue(later), fire: (seq: number) => event({ taskId: 'task', seq, type: 'item.created' }), resolve: (s: any) => initial(s) };
}

it('A44 keeps one history request in flight when the same cursor is clicked twice', async () => {
  const latest = { ...item('assistant_message', { text: 'Newest row' }), itemId: 'newest', ordinal: 10 };
  const fromHistory = { ...item('assistant_message', { text: 'History row' }), itemId: 'historical', ordinal: 9 };
  mocks.snapshot.mockResolvedValue(snapshot({ items: [latest], hasOlder: true }));
  let finish!: () => void;
  mocks.history.mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ items: [fromHistory], turns: [], hasOlder: false });
  }));
  render(<AgentTaskView taskId="task" />);
  const more = await screen.findByRole('button', { name: '加载更早的记录' });
  fireEvent.click(more);
  fireEvent.click(more);
  expect(mocks.history).toHaveBeenCalledTimes(1);
  expect(mocks.history).toHaveBeenCalledWith('task', 10);
  await act(async () => finish());
  expect(screen.getAllByText('History row')).toHaveLength(1);
});

it('A44 ignores an older revision from a pending history page when the snapshot already has a new version', async () => {
  const latest = { ...item('assistant_message', { text: 'Newest row' }), itemId: 'newest', ordinal: 10 };
  const historical = { ...item('assistant_message', { text: 'Old row revision' }), itemId: 'historical', ordinal: 9 };
  let state = snapshot({ items: [latest], hasOlder: true });
  let publish!: (e: { taskId: string; seq: number }) => void;
  mocks.on.mockImplementation((event, cb) => { if (event.name === 'agentTasks:event') publish = cb; return () => {}; });
  mocks.snapshot.mockImplementation(async () => state);
  let finish!: () => void;
  mocks.history.mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ items: [historical], turns: [], hasOlder: false });
  }));
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '加载更早的记录' }));
  state = snapshot({ seq: 2, items: [{ ...historical, revision: 2, payload: { text: 'New row revision' } }, latest] });
  await act(async () => publish({ taskId: 'task', seq: 2 }));
  await screen.findByText('New row revision');
  await act(async () => finish());
  expect(screen.queryByText('Old row revision')).toBeNull();
  expect(screen.getAllByText('New row revision')).toHaveLength(1);
});

it('A44 recovers missing notifications and refreshes changed history outside the latest snapshot', async () => {
  const latest = { ...item('assistant_message', { text: 'Newest row' }), itemId: 'newest', ordinal: 10 };
  const old = { ...item('assistant_message', { text: 'Cached row revision one' }), itemId: 'historical', ordinal: 9 };
  const updated = { ...old, revision: 2, payload: { text: 'Cached row revision two' } };
  let state = snapshot({ items: [latest], hasOlder: true });
  let publish!: (event: { taskId: string; seq: number }) => void;
  mocks.on.mockImplementation((event, cb) => { if (event.name === 'agentTasks:event') publish = cb; return () => {}; });
  mocks.snapshot.mockImplementation(async () => state);
  mocks.history.mockResolvedValue({ items: [old], turns: [], hasOlder: false });
  mocks.events.mockResolvedValue([
    { taskId: 'task', seq: 2, type: 'item.updated', itemId: old.itemId, payload: {} },
    { taskId: 'task', seq: 3, type: 'selection.changed', itemId: null, payload: {} },
  ]);
  mocks.historyItems.mockResolvedValue([updated]);
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '加载更早的记录' }));
  await screen.findByText('Cached row revision one');
  state = snapshot({ seq: 3, items: [latest], hasOlder: true });
  await act(async () => publish({ taskId: 'task', seq: 3 }));
  await screen.findByText('Cached row revision two', {}, { timeout: 2000 });
  expect(screen.queryByText('Cached row revision one')).toBeNull();
  expect(mocks.events).toHaveBeenCalledWith('task', 1, 3);
  expect(mocks.historyItems).toHaveBeenCalledWith('task', [old.itemId]);
});

it('A44 recovers a missing tail after the native window is shown without a DOM visibility change', async () => {
  const old = item('assistant_message', { text: 'Before hiding' });
  const updated = { ...old, revision: 2, payload: { text: 'Recovered after showing' } };
  let state = snapshot({ items: [old] });
  const listeners = new Map<string, () => void>();
  mocks.on.mockImplementation((event, cb) => { listeners.set(event.name, cb); return () => listeners.delete(event.name); });
  mocks.snapshot.mockImplementation(async () => state);
  mocks.events.mockResolvedValue([{ taskId: 'task', seq: 2, type: 'item.updated', itemId: old.itemId, payload: {} }]);
  const { unmount } = render(<AgentTaskView taskId="task" />);
  await screen.findByText('Before hiding');
  state = snapshot({ seq: 2, items: [updated] });
  const onShow = listeners.get('window:shown');
  expect(onShow).toBeTypeOf('function');
  await act(async () => onShow?.());
  await screen.findByText('Recovered after showing');
  expect(screen.queryByText('Before hiding')).toBeNull();
  unmount();
  expect(listeners.has('window:shown')).toBe(false);
});

it('A44 discards an unsafe page when the event sequence was cropped while the window was away', async () => {
  const latest = { ...item('assistant_message', { text: 'Newest row' }), itemId: 'newest', ordinal: 10 };
  const old = { ...item('assistant_message', { text: 'Old untrusted page' }), itemId: 'historical', ordinal: 9 };
  let state = snapshot({ seq: 4, items: [latest], hasOlder: true });
  mocks.snapshot.mockImplementation(async () => state);
  mocks.history.mockResolvedValue({ items: [old], turns: [], hasOlder: false });
  mocks.events.mockResolvedValue([{ taskId: 'task', seq: 9, type: 'selection.changed', itemId: null, payload: {} }]);
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button', { name: '加载更早的记录' }));
  await screen.findByText('Old untrusted page');
  state = snapshot({ seq: 9, items: [latest], hasOlder: true });
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.queryByText('Old untrusted page')).toBeNull());
  expect(screen.getByRole('button', { name: '加载更早的记录' })).toBeTruthy();
  expect(mocks.events).toHaveBeenCalledWith('task', 4, 9);
});

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

it('A43 retains draft attachment references until the last attempted write settles on navigation', async () => {
  const attachment = { id: 'attachment', kind: 'file', name: 'kept.txt', mime: 'text/plain', size: 12, image: false, storedPath: '/fixture/kept.txt' };
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: { text: 'old draft', attachments: [attachment] }, revision: 1 } }));
  let acknowledge!: () => void;
  mocks.saveDraft.mockImplementation(() => new Promise(resolve => { acknowledge = () => resolve({ ok: true, revision: 2 }); }));
  const { unmount } = render(<AgentTaskView taskId="task" />);
  await screen.findByText('kept.txt · 副本');
  const editorId = mocks.holdDraftAttachments.mock.calls[0][1];
  expect(mocks.holdDraftAttachments).toHaveBeenCalledWith('task', editorId, [attachment.storedPath]);
  fireEvent.change(screen.getByPlaceholderText('随心输入'), { target: { value: 'new draft' } });
  unmount();
  expect(mocks.saveDraft).toHaveBeenCalledWith('task', { text: 'new draft', attachments: [attachment] }, 1);
  expect(mocks.holdDraftAttachments).not.toHaveBeenCalledWith('task', editorId, []);
  await act(async () => acknowledge());
  expect(mocks.holdDraftAttachments).toHaveBeenLastCalledWith('task', editorId, []);
});

it('FR05：过大的草稿分段读回', async () => {
  const text = '草稿'.repeat(30_000);
  mocks.draftBody.mockImplementation((_: string, off: number) => serveInTwo({ text })('', '', off));
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, revision: 4, truncated: true, bytes: 180_000 } }));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value).toBe(text));
});

it('SR05：展开全文后条目推进到新修订，界面采用新内容；迟到的旧全文不写回', async () => {
  const entries = (s: string) => Array.from({ length: 50 }, (_, k) => ({ id: String(k), subject: `任务 ${k} ` + 'x'.repeat(600), status: k === 0 ? s : 'pending' }));
  const h = holdInit();
  const v1 = item('todo_list', { entries: entries('pending').slice(0, 3), truncated: true });
  h.setInitial(snapshot({ seq: 2, items: [{ ...v1, revision: 1 }] }));
  let resolveOld!: (v: any) => void;
  mocks.itemBody.mockImplementationOnce((_t: string, _i: string, _o: number, rev: number) => Promise.resolve({ chunk: JSON.stringify({ entries: entries('pending') }), next: 1, done: true, revision: rev }));
  render(<AgentTaskView taskId="task" />);
  await act(async () => { h.fire(2); await new Promise(r => setTimeout(r, 120)); });
  fireEvent.click(await screen.findByRole('button', { name: /展开全文/ }));
  await waitFor(() => expect(document.querySelectorAll('.agent-todo-row')).toHaveLength(50));
  // 修订 2：第一项已完成；已展开的条目按新修订重取，旧修订的迟到结果不覆盖
  mocks.itemBody.mockImplementation((_t: string, _i: string, _o: number, rev: number) => rev === 2
    ? Promise.resolve({ chunk: JSON.stringify({ entries: entries('completed') }), next: 1, done: true, revision: 2 })
    : new Promise(r => { resolveOld = r; }));
  mocks.snapshot.mockResolvedValue(snapshot({ seq: 3, items: [{ ...item('todo_list', { entries: entries('completed').slice(0, 3), truncated: true }), revision: 2 }] }));
  await act(async () => { h.fire(3); await new Promise(r => setTimeout(r, 120)); });
  await waitFor(() => expect(document.querySelector('.agent-todo-row')?.className).toContain('completed'));
  expect(mocks.itemBody).toHaveBeenLastCalledWith('task', 'long', 0, 2);
  expect(document.querySelectorAll('.agent-todo-row')).toHaveLength(50);
  resolveOld?.({ chunk: JSON.stringify({ entries: entries('pending') }), next: 1, done: true, revision: 1 });
  await act(async () => {});
  expect(document.querySelector('.agent-todo-row')?.className).toContain('completed');
});

it('SR02：草稿保存被拒时提示一次并保留本地内容', async () => {
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.saveDraft.mockRejectedValue(new Error('草稿超过 256 KB，未保存；请拆分或改用附件'));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  // 前一个用例卸载时留下的草稿保存定时器可能在此触发，先等它结束再计数
  await new Promise(r => setTimeout(r, 500)); mocks.toast.mockClear();
  fireEvent.change(input, { target: { value: '很长的草稿' } });
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('草稿未保存')), { timeout: 2000 });
  fireEvent.change(input, { target: { value: '很长的草稿2' } });
  await new Promise(r => setTimeout(r, 600));
  expect(mocks.toast.mock.calls.filter(c => String(c[0]).includes('草稿未保存'))).toHaveLength(1);
  expect(input.value).toBe('很长的草稿2');
});

it('SR02：受损的旧草稿明确提示，不静默显示为空', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, revision: 3, damaged: true, bytes: 300000 } }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByPlaceholderText('随心输入');
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('草稿不完整')));
});

it('SR02：分段读回的草稿若仍是旧版本截断记录，同样提示，不显示为空', async () => {
  const legacy = { truncated: true, bytes: 262155, sha256: 'ab', head: '{"text":"DDD' };
  mocks.draftBody.mockResolvedValue({ chunk: JSON.stringify(legacy), next: 1, done: true, revision: 1 });
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, truncated: true, bytes: 70000, revision: 1 } }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByPlaceholderText('随心输入');
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('草稿不完整')));
});

it('T01：快照修订 1、实际读回修订 2，首次编辑按修订 2 保存', async () => {
  mocks.draftBody.mockResolvedValue({ chunk: JSON.stringify({ text: '修订二的草稿' }), next: 1, done: true, revision: 2 });
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, truncated: true, bytes: 70000, revision: 1 } }));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value).toBe('修订二的草稿'));
  fireEvent.change(input, { target: { value: '修订二的草稿＋改' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled(), { timeout: 2000 });
  expect(mocks.saveDraft.mock.calls[0][2]).toBe(2);
});

it('T01：分段读取中途草稿更新，重读到修订 2 后首次编辑按修订 2 保存', async () => {
  mocks.draftBody.mockImplementation((_t: string, off: number, rev?: number) => {
    if (off === 0 && rev === undefined && mocks.draftBody.mock.calls.length === 1) return Promise.resolve({ chunk: '{"text":"旧', next: 5, done: false, revision: 1 });
    if (rev === 1) return Promise.reject(new Error('草稿已更新，请重新读取'));
    return Promise.resolve({ chunk: JSON.stringify({ text: '新内容' }), next: 1, done: true, revision: 2 });
  });
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, truncated: true, bytes: 70000, revision: 1 } }));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(input.value).toBe('新内容'));
  fireEvent.change(input, { target: { value: '新内容2' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled(), { timeout: 2000 });
  expect(mocks.saveDraft.mock.calls[0][2]).toBe(2);
});

it('T01：读取期间已编辑，保留本地内容；真实冲突按修订比较，不被静默覆盖并提示', async () => {
  let resolveBody!: (v: any) => void;
  mocks.draftBody.mockImplementation(() => new Promise(r => { resolveBody = r; }));
  mocks.saveDraft.mockResolvedValueOnce({ ok: false, revision: 2 });
  mocks.snapshot.mockResolvedValue(snapshot({ draft: { draft: null, truncated: true, bytes: 70000, revision: 1 } }));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(mocks.draftBody).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: '我先写的' } });
  await act(async () => resolveBody({ chunk: JSON.stringify({ text: '别处的' }), next: 1, done: true, revision: 2 }));
  expect(input.value).toBe('我先写的');
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled(), { timeout: 2000 });
  expect(mocks.saveDraft.mock.calls[0][2]).toBe(1);
  expect(await screen.findByText('草稿已在别处更新')).toBeTruthy();
  expect(input.value).toBe('我先写的');
});

for (const [name, body] of [
  ['超过保存上限、按结构截短', { name: 'ExitPlanMode', plan: 'P'.repeat(3000), storedTruncated: true, bytes: 1_300_000, sha256: 'ab' }],
  ['旧版本的通用截断记录', { truncated: true, bytes: 1_228_912, sha256: 'ab', head: '{"name":"ExitPlanMode"' }],
] as const) it(`T02：计划正文不完整（${name}），连续两次复制都不写剪贴板并提示失败`, async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mocks.itemBody.mockImplementation(serveInTwo(body));
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('proposed_plan', { name: 'ExitPlanMode', plan: 'P'.repeat(2000), truncated: true, bytes: 1_300_000 })] }));
  render(<AgentTaskView taskId="task" />);
  const copy = await screen.findByRole('button', { name: '复制' });
  for (let k = 0; k < 2; k++) { fireEvent.click(copy); await new Promise(r => setTimeout(r, 30)); }
  fireEvent.click(screen.getByRole('button', { name: '下载' })); await new Promise(r => setTimeout(r, 30));
  expect(writeText).not.toHaveBeenCalled();
  expect(mocks.toast.mock.calls.some(c => String(c[0]).includes('已复制'))).toBe(false);
  expect(mocks.toast.mock.calls.filter(c => /保存上限|只保留了开头/.test(String(c[0]))).length).toBeGreaterThanOrEqual(3);
});

describe('复核 2354：工作过程正文的完整性', () => {
  const reasoning = { itemId: 'r1', turnId: 't1', ordinal: 1, revision: 1, type: 'reasoning', terminal: 'completed', createdAt: '', updatedAt: '', payload: { text: 'REASON_' + 'r'.repeat(2000), truncated: true, bytes: 1_300_000 } };
  const turns = [{ turn_id: 't1', status: 'completed', accepted_at: '2026-11-18T00:00:00Z', started_at: '2026-11-18T00:00:00Z', ended_at: '2026-11-18T00:00:05Z', error_code: null }];
  const open = async () => {
    mocks.snapshot.mockResolvedValue(snapshot({ items: [reasoning], turns }));
    render(<AgentTaskView taskId="task" />);
    fireEvent.click(await screen.findByRole('button', { name: /用时/ }));
    fireEvent.click(await screen.findByRole('button', { name: /展开全文/ }));
  };
  it('U02：读回完整原文（artifact）后显示尾部、不显示不完整提示', async () => {
    const full = 'REASON_' + 'r'.repeat(40_000) + '_REASON_TAIL';
    mocks.itemBody.mockImplementation(serveInTwo({ text: full }));
    await open();
    expect(await screen.findByText(/_REASON_TAIL/)).toBeTruthy();
    expect(screen.queryByText(/无法恢复/)).toBeNull();
    expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull();
  });
  it('U02：读回的仍是不完整正文（超过保存上限的旧记录）时明确提示后面的内容无法恢复', async () => {
    mocks.itemBody.mockImplementation(serveInTwo({ text: 'REASON_' + 'r'.repeat(8000), storedTruncated: true, bytes: 1_300_000, sha256: 'ab' }));
    await open();
    expect(await screen.findByText(/只保留了开头部分，后面的内容无法恢复/)).toBeTruthy();
  });
  it('U02：读取失败时保留“展开全文”入口并提示失败', async () => {
    mocks.itemBody.mockRejectedValue(new Error('原文文件丢失，无法读取全文'));
    await open();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('原文文件丢失')));
    expect(screen.getByRole('button', { name: /展开全文/ })).toBeTruthy();
  });
});

it('M14 A38/A42: a host reference appends at the current draft selection, preserves existing text, saves only the draft and never submits',async()=>{
 mocks.snapshot.mockResolvedValue(snapshot({projectId:'p'}));render(<AgentTaskView taskId="task"/>);const input=await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'prefix tail'}});input.setSelectionRange(7,7);await act(async()=>agentComposerTargets.current!.insert('[原邮件引用]'));expect(input.value).toBe('prefix [原邮件引用]tail');await waitFor(()=>expect(mocks.saveDraft).toHaveBeenCalledWith('task',expect.objectContaining({text:input.value}),expect.any(Number)));expect(mocks.submit).not.toHaveBeenCalled();
});

it('M14 A38: publishes an editable reference destination only after reading the saved draft', async () => {
  let ready!: (value:unknown) => void;
  mocks.draftBody.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  mocks.snapshot.mockResolvedValue(snapshot({projectId:'p',draft:{revision:2,truncated:true}}));
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  expect(agentComposerTargets.current).toBeNull();
  await act(async () => ready({chunk:JSON.stringify({text:'本地草稿',attachments:[]}),done:true,next:1,revision:2}));
  expect(agentComposerTargets.current).toMatchObject({taskId:'task',projectId:'p'});
  input.setSelectionRange(input.value.length,input.value.length);
  await act(async () => agentComposerTargets.current!.insert('[邮件引用]'));
  expect(input.value).toBe('本地草稿[邮件引用]');
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith('task',{text:input.value,attachments:[]},2));
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('A67 keeps successful merge verification visible when the child list is collapsed', () => {
  const value = {
    childrenTotal: 2, counts: { running: 0, waiting: 0, queued: 0, completed: 2, pending: 1 },
    children: [
      { childTaskId: 'merged', title: '已合并子任务', profileName: 'Codex', workspaceMode: 'worktree', access: 'write', state: 'delivered', merged: true, pendingMerge: false, elapsedSeconds: null, attempts: 1 },
      { childTaskId: 'pending', title: '待合并子任务', profileName: 'Claude', workspaceMode: 'worktree', access: 'write', state: 'delivered', merged: false, pendingMerge: true, elapsedSeconds: null, attempts: 1 },
    ],
  } as Relations;
  const { container } = render(<AgentChildSummary taskId="task" value={value} readOnly={false} reload={vi.fn()} />);
  const details = container.querySelector('details')!;
  const summary = details.querySelector('summary')!;
  expect(within(summary).getByText('合并核对通过 · 1 项')).toBeTruthy();
  fireEvent.click(summary);
  expect(details.open).toBe(false);
  expect(within(summary).getByText('合并核对通过 · 1 项')).toBeTruthy();
});

it('M14 A29/A74: the native child process drawer and family card open independently and Escape closes the drawer', async () => {
  const turnId = 'native-turn';
  const subagent = {...item('subagent',{name:'spawnAgent',status:'completed'}),turnId};
  mocks.snapshot.mockResolvedValue(snapshot({
    items:[subagent],
    turns:[{turn_id:turnId,status:'completed',accepted_at:'2026-11-18T00:00:00Z',started_at:'2026-11-18T00:00:00Z',ended_at:'2026-11-18T00:00:05Z'}],
  }));
  const api = mocks as typeof mocks & {relations?: ReturnType<typeof vi.fn>; nativeHistory?: ReturnType<typeof vi.fn>};
  api.relations = vi.fn().mockResolvedValue({taskTitle:'t',children:[],childrenTotal:1,counts:{running:0,waiting:0,queued:0,completed:1,pending:0}});
  api.nativeHistory = vi.fn().mockResolvedValue({items:[],states:[],total:0});
  try {
    render(<AgentTaskView taskId="task" />);
    const family = await screen.findByRole('button',{name:'任务关系 · 1'});
    fireEvent.click(family);
    expect(screen.getByRole('region',{name:'任务关系'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/用时/}));
    fireEvent.click(screen.getByText(/子 Agent/));
    fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
    expect(screen.getByRole('region',{name:'执行器原生子 Agent'})).toBeTruthy();
    expect(screen.queryByRole('region',{name:'任务关系'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'关闭过程'}));
    expect(family.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(family);
    expect(screen.getByRole('region',{name:'任务关系'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
    fireEvent.keyDown(document,{key:'Escape',isComposing:true});
    expect(screen.getByRole('region',{name:'执行器原生子 Agent'})).toBeTruthy();
    fireEvent.keyDown(document,{key:'Escape'});
    expect(screen.queryByRole('region',{name:'执行器原生子 Agent'})).toBeNull();
    expect(family.getAttribute('aria-expanded')).toBe('false');
  } finally {
    delete api.relations;
    delete api.nativeHistory;
  }
});

it('M14 A29: the native lifecycle keeps the owning-run stop action after the launch tool returns', async () => {
  const turnId = 'native-turn';
  mocks.snapshot.mockResolvedValue(snapshot({
    items:[{...item('subagent',{name:'Agent',status:'completed',output:'Async agent launched'}),turnId}],
    turns:[{turn_id:turnId,status:'started',started_at:'2026-11-18T00:00:00Z'}],
  }));
  const api = mocks as typeof mocks & {nativeHistory?: ReturnType<typeof vi.fn>};
  api.nativeHistory = vi.fn().mockResolvedValue({items:[],states:['running'],total:0,stopRunId:'original-run'});
  try {
    render(<AgentTaskView taskId="task" />);
    fireEvent.click(await screen.findByText(/子 Agent/));
    fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
    const drawer=screen.getByRole('region',{name:'执行器原生子 Agent'});
    const stop=await within(drawer).findByRole('button',{name:'停止所属运行'});
    expect(drawer.textContent).toContain('工作中');
    expect(drawer.textContent).not.toContain('completed');
    fireEvent.click(stop);
    expect(api.stop).toHaveBeenCalledWith('task',false,'original-run');
  } finally {
    delete api.nativeHistory;
  }
});

it('G5 uses a read-only composer until the same archived task is restored',async()=>{
  const active = snapshot({items:[item('assistant_message',{text:'retained archived history'})]});
  mocks.snapshot.mockResolvedValue({...active,archivedAt:'2026-11-18T11:00:00Z'});
  mocks.unarchive.mockImplementation(async()=>{mocks.snapshot.mockResolvedValue({...active,seq:2});});
  render(<AgentTaskView taskId="task"/>);
  expect(await screen.findByText('retained archived history')).toBeTruthy();
  expect(screen.getByRole('textbox',{name:'已归档任务输入'})).toHaveProperty('disabled',true);
  expect(screen.queryByTitle('发送')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'恢复'}));
  await waitFor(()=>expect(mocks.unarchive).toHaveBeenCalledWith('task'));
  expect(await screen.findByPlaceholderText('随心输入')).toBeTruthy();
});

it('G2 discards a private attachment that finishes preparing after the user removes its chip',async()=>{
  mocks.snapshot.mockResolvedValue(snapshot());
  let finish!:(value:unknown)=>void;
  mocks.prepareAttachment.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<AgentTaskView taskId="task"/>);
  const input=await screen.findByPlaceholderText('随心输入');
  fireEvent.paste(input,{clipboardData:{files:[new File(['x'],'late.txt',{type:'text/plain'})]}});
  await screen.findByText('late.txt');
  fireEvent.click(screen.getByTitle('移除'));
  const prepared={id:'prepared',kind:'file',name:'late.txt',storedPath:'/fixture/private-copy',mime:'text/plain',size:1,image:false};
  await act(async()=>finish(prepared));
  expect(mocks.discardAttachment).toHaveBeenCalledWith('task',prepared);
  expect(screen.queryByText('late.txt')).toBeNull();
});

it('renders lists, bold text and routed links in an Agent reply', async () => {
  const text = '**可以打开**\n\n- [发布说明](docs/release.md)\n\n**不会打开**\n\n1. 普通文字';
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('assistant_message', { text })] }));
  render(<AgentTaskView taskId="task" />);
  const link = await screen.findByRole('link', { name: '发布说明' });
  expect(decodeURIComponent(link.dataset.agentLink!)).toBe('docs/release.md');
  expect(link.closest('ul')).toBeTruthy();
  expect(screen.getByText('可以打开').tagName).toBe('STRONG');
  expect(screen.getByText('不会打开').closest('ul')).toBeNull();
  expect(screen.getByText('普通文字').closest('ol')).toBeTruthy();
});

it('shows elapsed stop time and offers manual force stop only once ten seconds have elapsed', async () => {
  vi.useFakeTimers();
  try {
    const requestedAt = Date.now();
    const stopping = { runId: 'original-run', requestedAt, forceAt: requestedAt + 10_000, closing: false };
    mocks.snapshot.mockResolvedValue(snapshot({ status: 'working', stopping }));
    mocks.forceStop.mockResolvedValue(undefined);
    render(<AgentTaskView taskId="task" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('（已等待 0 秒）')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
    expect(screen.getByText('（已等待 9 秒）')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '强制停止' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText('（已等待 10 秒）')).toBeTruthy();
    expect(screen.getByText(/可能内存不足，强制停止会结束它的进程/)).toBeTruthy();
    expect(mocks.forceStop).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '强制停止' })); });
    expect(mocks.forceStop).toHaveBeenCalledExactlyOnceWith('task', 'original-run', requestedAt);
  } finally {
    vi.useRealTimers();
  }
});

it('T1/V22 renders only supported web links and the Chinese absolute path exception', async () => {
  const text = [
    'CHANGELOG.md、main.py、deploy.sh、docs/、file:///tmp/hidden.txt',
    'https://example.org/a 以及 www.example.com/path',
    '路径：/Users/demo/new.ts:12，另见（/tmp/one.sh）、【/tmp/two.py】。',
  ].join('\n\n');
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('assistant_message', { text })] }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByText(/CHANGELOG.md、main.py、deploy.sh、docs\/、file:\/\/\/tmp\/hidden.txt/);
  expect(screen.getAllByRole('link').map(link => decodeURIComponent(link.dataset.agentLink!))).toEqual([
    'https://example.org/a', 'http://www.example.com/path', '/Users/demo/new.ts:12', '/tmp/one.sh', '/tmp/two.py',
  ]);
});

it('A57 renders explicit local file URLs without linking bare or remote file URLs', async () => {
  const text = [
    '[文件协议](file:///tmp/source.ts:3:2)',
    '[本机地址](file://localhost/tmp/notes.txt#L4)',
    '裸地址 file:///tmp/plain.txt',
    '[远程文件](file://remote.invalid/share/private.txt)',
    '[危险地址](javascript:alert%281%29)',
  ].join('\n\n');
  mocks.snapshot.mockResolvedValue(snapshot({ items: [item('assistant_message', { text })] }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByText(/裸地址/);
  expect(screen.getAllByRole('link').map(link => decodeURIComponent(link.dataset.agentLink!))).toEqual([
    'file:///tmp/source.ts:3:2', 'file://localhost/tmp/notes.txt#L4',
  ]);
});

it('F04 chooses numbered answers then confirms with Enter and leaves composing digits alone', async () => {
  const req = { requestId:'question', revision:1, status:'pending', origin:{}, kind:'user_input', payload:{ params:{ questions:[
    {id:'q', question:'选择运行方式', options:[{label:'快速'},{label:'完整', description:'完整校验'}]},
  ] } } };
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[req] }));
  mocks.respond.mockResolvedValue(undefined);
  render(<AgentTaskView taskId="task" />);
  const form = await screen.findByLabelText('回答 Agent 的问题');
  fireEvent.keyDown(form, { key:'2', isComposing:true });
  expect((screen.getByRole('radio', {name:/完整校验/}) as HTMLInputElement).checked).toBe(false);
  fireEvent.keyDown(form, { key:'2' });
  expect((screen.getByRole('radio', {name:/完整校验/}) as HTMLInputElement).checked).toBe(true);
  expect(mocks.respond).not.toHaveBeenCalled();
  fireEvent.keyDown(form, { key:'Enter' });
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task','question',1,{answers:{q:{answers:['完整']}}}));
});

it('F03 shows the command directory and confirms keyboard selection against the same request revision', async () => {
  const request = { requestId:'permission', revision:4, status:'pending', origin:{}, kind:'command_approval', payload:{ params:{command:'pwd',cwd:'/w/nested'} } };
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[request] }));
  mocks.respond.mockResolvedValue(undefined);
  render(<AgentTaskView taskId="task" />);
  const dialog = await screen.findByRole('dialog');
  expect(screen.getByText('/w/nested')).toBeTruthy();
  fireEvent.keyDown(dialog, { key:'3' });
  expect(mocks.respond).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key:'Enter' });
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task','permission',4,{decision:'decline'}));
});

it('F02 offers send and delete for queued inputs', async () => {
  const queued = {turnId:'q', version:'v1', text:'排队内容', acceptedAt:'2026-11-18T00:00:00Z', editable:true, attachmentCount:1};
  let state = snapshot({queued:[queued], queuedTotal:1});
  mocks.snapshot.mockImplementation(async () => state);
  mocks.sendQueued.mockResolvedValue({status:'queued'});
  mocks.cancelQueued.mockImplementation(async () => {state = snapshot({seq:3});});
  render(<AgentTaskView taskId="task" />);
  const send = await screen.findByRole('button', {name:'立即发送'});
  expect(send.closest('.agent-queue')).toBeTruthy();
  expect(screen.queryByTitle('编辑排队消息')).toBeNull();
  fireEvent.click(send);
  await waitFor(() => expect(mocks.sendQueued).toHaveBeenCalledExactlyOnceWith('task','q','v1',1));
  await waitFor(() => expect((screen.getByTitle('删除排队消息') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTitle('删除排队消息'));
  await waitFor(() => expect(mocks.cancelQueued).toHaveBeenCalledExactlyOnceWith('task','q'));
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('hides a deleted queued message when its stored input remains in the snapshot', async () => {
  const text = '已删除的排队输入';
  mocks.snapshot.mockResolvedValue(snapshot({
    items: [{ itemId:'canceled-message', turnId:'canceled-turn', type:'user_message', ordinal:1, revision:1,
      payload:{ text, sourceKind:'user' }, terminal:'completed', createdAt:'2026-11-22T03:18:33Z', updatedAt:'2026-11-22T03:18:33Z' }],
    turns: [{ turn_id:'canceled-turn', status:'canceled', source_kind:'user', error_code:'USER_CANCELED',
      accepted_at:'2026-11-22T03:18:33Z', started_at:null, ended_at:'2026-11-22T03:18:40Z' }],
  }));
  render(<AgentTaskView taskId="task" />);
  await screen.findByPlaceholderText('随心输入');
  expect(screen.queryByText(text)).toBeNull();
});

it.each([false, true])('queues a normal follow-up and only promotes it from the queue (shortcut=%s)', async metaKey => {
  const queued = {turnId:'q', version:'v1', text:'补充指令', acceptedAt:'2026-11-22T00:00:00Z', editable:true, attachmentCount:0};
  const run = {runId:'run', generation:1, driverId:'codex-app-server', tier:'ask', busy:true, steer:true};
  let state = snapshot({status:'working', run});
  mocks.snapshot.mockImplementation(async () => state);
  mocks.submit.mockImplementation(async () => {
    state = snapshot({seq:2, status:'working', run, queued:[queued], queuedTotal:1});
    return {turnId:'q', status:'queued'};
  });
  mocks.sendQueued.mockImplementation(async () => {
    state = snapshot({seq:3, status:'working', run});
    return {status:'steered'};
  });
  render(<AgentTaskView taskId="task" />);
  const input = await screen.findByPlaceholderText('继续输入，本轮结束后发送');
  expect(screen.queryByRole('button', {name:'插话'})).toBeNull();
  fireEvent.change(input, {target:{value:'补充指令'}});
  fireEvent.keyDown(input, {key:'Enter', metaKey});
  const send = await screen.findByRole('button', {name:'插入当前轮'});
  expect(send.closest('.agent-queue')).toBeTruthy();
  expect(mocks.submit.mock.calls[0][1]).toMatchObject({text:'补充指令', mode:'queue'});
  expect(mocks.sendQueued).not.toHaveBeenCalled();
  fireEvent.click(send);
  await waitFor(() => expect(mocks.sendQueued).toHaveBeenCalledExactlyOnceWith('task','q','v1',1));
  await waitFor(() => expect(screen.queryByRole('button', {name:'插入当前轮'})).toBeNull());
});

it('F14 folds long user messages and restores only a proven unsent input to an empty composer', async () => {
  const body = '原文' + '长'.repeat(700) + '末尾';
  const unsent = {turn_id:'q', source_kind:'user', status:'failed', started_at:null, run_id:null, native_turn_id:null};
  mocks.snapshot.mockResolvedValue(snapshot({ items:[{...item('user_message',{text:body}), turnId:'q'}], turns:[unsent] }));
  mocks.readUserInput.mockImplementation(serveInTwo({text:body,attachments:[]}));
  mocks.retryFailedInput.mockResolvedValue({turnId:'r'});
  render(<AgentTaskView taskId="task" />);
  fireEvent.click(await screen.findByRole('button',{name:'显示全文'}));
  expect(screen.getByText(body)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'放回输入框'}));
  const composer = screen.getByPlaceholderText('随心输入') as HTMLTextAreaElement;
  await waitFor(() => expect(composer.value).toBe(body));
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'重试'}));
  await waitFor(() => expect(mocks.retryFailedInput).toHaveBeenCalledExactlyOnceWith('task','q',1));
});

it('V23 keeps the complete mail review and its editing controls in the timeline, then approves only the renewed review', async () => {
  const request = {
    requestId:'mail', kind:'host_business', status:'pending', revision:1, origin:{},
    payload:{
      businessKind:'mail_send', phase:'waiting_user', title:'需要批准：发送邮件',
      options:[{label:'批准发送',value:'allow'},{label:'手动修改',value:'edit'},{label:'让 Agent 按我的说明修改',value:'agentedit'}],
      review:{fromAddress:'sender@example.invalid',draftRevision:1,attachments:[],priorUnknownExecutionIds:['unknown-1'],
        content:{to:['qa@example.invalid'],cc:[],bcc:['audit@example.invalid'],subject:'发布检查',text:'第一版正文',html:'<img src="https://fixture.invalid/logo.png">'}},
    },
  };
  let state = snapshot({ requests:[request] });
  mocks.snapshot.mockImplementation(async () => state);
  mocks.businessReview.mockResolvedValue({ displayReceiptId:'display-receipt' });
  mocks.respond.mockImplementation(async (_task, _id, _rev, reply) => {
    if (reply.choice === 'edit') {
      state = snapshot({seq:2, requests:[{...request, revision:2, payload:{...request.payload, review:{
        ...request.payload.review, draftRevision:2, content:{...request.payload.review.content, text:reply.edits.text},
      }}}]});
    }
  });
  render(<AgentTaskView taskId="task"/>);
  const card = await screen.findByRole('region', {name:'邮件审阅'});
  const panel = within(screen.getByRole('dialog'));
  expect(card.closest('.agent-timeline')).toBeTruthy();
  expect(card.closest('.agent-bottom')).toBeNull();
  expect(panel.queryByText('第一版正文')).toBeNull();
  await within(card).findByText('第一版正文');
  expect(within(card).getByText('audit@example.invalid')).toBeTruthy();
  expect(card.querySelector('img')).toBeNull();

  fireEvent.click(panel.getByRole('option',{name:'手动修改'}));
  fireEvent.click(panel.getByRole('button',{name:'确认'}));
  const text = within(card).getByRole('textbox',{name:'正文'});
  expect((panel.getByRole('option',{name:'批准发送'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(text,{target:{value:'确认过的新版正文'}});
  fireEvent.click(within(card).getByRole('button',{name:'保存修改并重新审阅'}));
  await waitFor(() => expect(document.querySelector('.agent-mail-body')?.textContent).toBe('确认过的新版正文'));
  expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task','mail',1,expect.objectContaining({choice:'edit',edits:expect.objectContaining({text:'确认过的新版正文'})}));
  expect((panel.getByRole('option',{name:'批准发送'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole('checkbox',{name:/我已核实/}));
  fireEvent.click(panel.getByRole('option',{name:'批准发送'}));
  fireEvent.click(panel.getByRole('button',{name:'确认'}));
  await waitFor(() => expect(mocks.respond).toHaveBeenLastCalledWith('task','mail',2,{choice:'allow',displayReceiptId:'display-receipt',reviewedUnknownExecutionIds:['unknown-1']}));
});

it('V24 reads the displayed revision, labels pages and explains only choices supplied by the host', async () => {
  const request = {requestId:'browser', kind:'host_business', status:'pending', revision:4, origin:{}, targetTaskTitle:'接口文档任务', detailTruncated:true, payload:{}};
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[request] }));
  mocks.requestBody.mockImplementation(serveInTwo({
    businessKind:'browser_access',phase:'waiting_user',
    review:{targetTaskId:'private-task-id',mode:'observe',pages:[{id:'page1',url:'https://fixture.invalid/api'},{id:'page2',url:'https://fixture.invalid/guide'}]},
    options:[{label:'允许观察',value:'observe'}],
  }));
  mocks.respond.mockResolvedValue(undefined);
  render(<AgentTaskView taskId="task"/>);
  await screen.findByText('需要授权：访问任务「接口文档任务」的网页');
  expect(mocks.requestBody.mock.calls.map(call => call[3])).toEqual([4,4]);
  expect(screen.getByText('https://fixture.invalid/api')).toBeTruthy();
  expect(screen.getByText('https://fixture.invalid/guide')).toBeTruthy();
  expect(screen.getByText(/运行结束或你撤销后/)).toBeTruthy();
  expect(screen.getByText(/只读，可查看页面/)).toBeTruthy();
  expect(screen.queryByRole('option',{name:'允许控制'})).toBeNull();
  expect(screen.queryByText(/private-task-id/)).toBeNull();
  fireEvent.click(screen.getByRole('option',{name:'允许观察'}));
  expect(mocks.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'确认'}));
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task','browser',4,{choice:'observe'}));
});

it('V24 keeps an approved pending binding visible and revocable without offering another approval', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[{
    requestId:'browser', kind:'host_business', status:'approved_pending_bind', revision:2, origin:{}, targetTaskTitle:'接口文档任务',
    payload:{businessKind:'browser_access',phase:'approved_pending_bind',review:{pages:[{url:'https://fixture.invalid/api'}]},options:[{label:'允许控制',value:'control'}]},
  }] }));
  mocks.respond.mockResolvedValue(undefined);
  render(<AgentTaskView taskId="task"/>);
  expect(await screen.findByText(/目前尚无可用权限/)).toBeTruthy();
  expect(screen.queryByRole('option',{name:'允许控制'})).toBeNull();
  fireEvent.click(screen.getByRole('option',{name:'撤销授权'}));
  fireEvent.click(screen.getByRole('button',{name:'确认'}));
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task','browser',2,{choice:'deny'}));
});

it('F14 pauses autosave on a conflict and keeps local edits until replacing text and attachments is confirmed', async () => {
  const other = { id:'remote', name:'另一份.txt', kind:'path', relativePath:'另一份.txt', size:3, mime:'text/plain', image:false };
  mocks.snapshot.mockResolvedValue(snapshot());
  const taskId = 'draft-conflict-replacement';
  mocks.saveDraft.mockImplementation(async (task, draft) => task === taskId && draft.text === '本地未保存草稿'
    ? {ok:false,revision:2,draftTruncated:true} : {ok:true,revision:3});
  const draftWrites = () => mocks.saveDraft.mock.calls.filter(call => call[0] === taskId);
  mocks.draftBody.mockResolvedValue({chunk:JSON.stringify({text:'另一份正文',attachments:[other]}),next:1,done:true,revision:2});
  render(<AgentTaskView taskId={taskId}/>);
  const editor = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  fireEvent.change(editor,{target:{value:'本地未保存草稿'}});
  const useOther = await screen.findByRole('button',{name:'用另一份'});
  fireEvent.change(editor,{target:{value:'冲突后继续编辑'}});
  fireEvent.click(useOther);
  expect(editor.value).toBe('冲突后继续编辑');
  expect(mocks.draftBody).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog',{name:'用另一份草稿？'})).getByRole('button',{name:'取消'}));
  expect(editor.value).toBe('冲突后继续编辑');
  expect(draftWrites()).toHaveLength(1);
  fireEvent.click(useOther);
  fireEvent.click(screen.getByRole('button',{name:'确认替换'}));
  await screen.findByText('另一份.txt');
  expect(editor.value).toBe('另一份正文');
  expect(mocks.draftBody).toHaveBeenCalledExactlyOnceWith(taskId,0,2);
  fireEvent.change(editor,{target:{value:'基于另一份继续修改'}});
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenLastCalledWith(taskId,{text:'基于另一份继续修改',attachments:[other]},2));
});

it('F14 requires another decision if keeping the local draft encounters a newer revision', async () => {
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.saveDraft.mockResolvedValueOnce({ok:false,revision:2}).mockResolvedValueOnce({ok:false,revision:3}).mockResolvedValue({ok:true,revision:4});
  render(<AgentTaskView taskId="task"/>);
  const editor = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  fireEvent.change(editor,{target:{value:'保住本地正文'}});
  const keep = await screen.findByRole('button',{name:'保留当前'});
  fireEvent.click(keep);
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(2));
  expect(editor.value).toBe('保住本地正文');
  expect(screen.getByText('草稿已在别处更新')).toBeTruthy();
  await waitFor(() => expect((keep as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(keep);
  await waitFor(() => expect(screen.queryByText('草稿已在别处更新')).toBeNull());
  expect(mocks.saveDraft.mock.calls.map(call=>call[2])).toEqual([0,2,3]);
  expect(editor.value).toBe('保住本地正文');
});

it('V03 combines completed reads and commands on one row, with process prose between tool rows', async () => {
  const row=(ordinal:number,type:string,payload:unknown,terminal:string|null='completed')=>({...item(type,payload),itemId:'work-'+ordinal,ordinal,turnId:'t',terminal});
  mocks.snapshot.mockResolvedValue(snapshot({
    items:[
      row(1,'file_search',{status:'completed',input:{file_path:'alpha.ts'}}),
      row(2,'file_search',{status:'completed',input:{file_path:'beta.ts'}}),
      row(3,'file_search',{status:'completed',input:{file_path:'gamma.ts'}}),
      row(4,'command_execution',{status:'completed',command:'git status'}),
      row(5,'assistant_message',{phase:'commentary',text:'我已经找到 **入口**。'}),
      row(6,'command_execution',{status:'running',command:'pnpm test'},null),
    ],
    turns:[{turn_id:'t',status:'started',accepted_at:'2026-11-18T11:00:00Z',started_at:'2026-11-18T11:00:00Z'}],status:'working',
  }));
  render(<AgentTaskView taskId="task"/>);
  const grouped = await screen.findByText('读取了 3 个文件，运行了 1 条命令');
  const paragraph = screen.getByText('入口').closest('.agent-assistant')!;
  expect(paragraph).toBeTruthy();
  expect(paragraph.querySelector('svg')).toBeNull();
  const details = grouped.closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(grouped.closest('summary')!);
  expect(within(details).getByText('运行了 git status')).toBeTruthy();
  const runningCommand = screen.getByText('正在运行 1 条命令').closest('summary')!;
  const runningDetails = runningCommand.closest('details')!;
  expect(paragraph.nextElementSibling?.contains(runningCommand)).toBe(true);
  expect(runningDetails.open).toBe(false);
  fireEvent.click(runningCommand);
  expect(runningDetails.open).toBe(true);
  expect((await within(runningDetails).findByLabelText('完整命令')).textContent).toBe('pnpm test');
  fireEvent.click(runningCommand);
  expect(runningDetails.open).toBe(false);
});

it('folds a single completed command independently from its turn and final reply', async () => {
  const turnId = 'single-command';
  const start = '2026-11-24T00:00:00Z', end = '2026-11-24T00:00:03Z';
  const items = [
    item('user_message', { text: '看一下目录' }),
    item('command_execution', { command: 'pwd', status: 'completed', output: '/fixture/work' }),
    item('assistant_message', { text: '目录已确认' }),
  ].map((entry, ordinal) => ({ ...entry, ordinal, turnId, itemId: `single-${ordinal}` }));
  mocks.snapshot.mockResolvedValue(snapshot({ items, status: 'completed', turns: [
    { turn_id: turnId, status: 'completed', accepted_at: start, started_at: start, ended_at: end },
  ] }));
  render(<AgentTaskView taskId="task" />);
  const reply = await screen.findByText('目录已确认');
  const turn = reply.closest('.agent-turn')!;
  const clock = screen.getByRole('button', { name: '用时 3 秒' });
  expect(turn.querySelector('.agent-work-divider')).toBeNull();
  expect(screen.queryByText('运行了 1 条命令')).toBeNull();
  fireEvent.click(clock);
  expect(turn.querySelectorAll('.agent-work-divider')).toHaveLength(1);
  const command = screen.getByText('运行了 1 条命令').closest('summary')!;
  const details = command.closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(command);
  expect(details.open).toBe(true);
  expect((await within(details).findByLabelText('完整命令')).textContent).toBe('pwd');
  expect(within(details).getByLabelText('命令输出').textContent).toBe('/fixture/work');
  fireEvent.click(clock);
  expect(screen.queryByText('运行了 1 条命令')).toBeNull();
  expect(screen.getByText('目录已确认')).toBe(reply);
});

it('keeps the complete script and output in separately labeled areas of an expanded command',async()=>{
 const command='printf "first\\n"\nprintf "second\\n"';
 const output='first\nsecond\n';
 mocks.snapshot.mockResolvedValue(snapshot({
  status:'working',turns:[{turn_id:'command-detail',status:'started'}],
  items:[{...item('command_execution',{command,output,exitCode:2,status:'failed'}),turnId:'command-detail',terminal:'failed'}],
 }));
 render(<AgentTaskView taskId="task"/>);
 const summary=await screen.findByText('1 条命令运行失败');
 expect(screen.queryByLabelText('完整命令')).toBeNull();
 fireEvent.click(summary.closest('summary')!);
 expect((await screen.findByLabelText('完整命令')).textContent).toBe(command);
 expect(screen.getByLabelText('命令输出').textContent).toBe(output);
 expect(screen.getByText('退出码 2')).toBeTruthy();
 fireEvent.click(summary.closest('summary')!);
 await waitFor(()=>expect(screen.queryByLabelText('命令输出')).toBeNull());
});

it('V19 marks failure, opens error details, and separately calls out unknown delivery without offering a resend', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({
    items:[{...item('error',{message:'执行器断开',code:'DISCONNECTED'}),turnId:'a'},{...item('user_message',{text:'一条输入'}),itemId:'unknown',turnId:'b',ordinal:2}],
    turns:[{turn_id:'a',status:'failed'},{turn_id:'b',status:'unknown'}],status:'failed',
  }));
  render(<AgentTaskView taskId="task"/>);
  expect(await screen.findByText('工作 0 秒后失败')).toBeTruthy();
  const summary=screen.getByText('查看错误详情');
  expect(summary.closest('details')?.open).toBe(false);
  fireEvent.click(summary);
  expect(screen.getByText('执行器断开')).toBeTruthy();
  const note=screen.getByRole('note');
  expect(within(note).getByText('接收未知')).toBeTruthy();
  expect(within(note).queryByRole('button')).toBeNull();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('F14 refuses to replace the draft if the other version changes after the confirmation opens', async () => {
  const taskId = 'draft-conflict-stale-replacement';
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.saveDraft.mockImplementation(async (task) => task === taskId ? {ok:false,revision:2} : {ok:true,revision:1});
  mocks.draftBody.mockRejectedValue(Error('草稿已更新，请重新读取'));
  render(<AgentTaskView taskId={taskId}/>);
  const editor = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  fireEvent.change(editor,{target:{value:'不应丢失的本地修改'}});
  const useOther = await screen.findByRole('button',{name:'用另一份'});
  fireEvent.click(useOther);
  mocks.snapshot.mockResolvedValue(snapshot({draft:{revision:3,draft:{text:'刚更新的另一份'}}}));
  fireEvent.click(screen.getByRole('button',{name:'确认替换'}));
  await waitFor(() => expect(screen.queryByRole('dialog',{name:'用另一份草稿？'})).toBeNull());
  expect(editor.value).toBe('不应丢失的本地修改');
  expect(screen.getByText('草稿已在别处更新')).toBeTruthy();
  expect(mocks.draftBody.mock.calls.every(call => call[2]===2)).toBe(true);
  mocks.draftBody.mockResolvedValue({chunk:JSON.stringify({text:'刚更新的另一份'}),next:1,done:true,revision:3});
  fireEvent.click(useOther);
  fireEvent.click(screen.getByRole('button',{name:'确认替换'}));
  await waitFor(() => expect(editor.value).toBe('刚更新的另一份'));
  expect(mocks.draftBody).toHaveBeenLastCalledWith(taskId,0,3);
});

it('A60 shows an unconfirmed command result, retaining its partial output after the turn stops', async () => {
  const started = '2026-11-18T10:00:00Z', ended = '2026-11-18T10:00:12Z';
  mocks.snapshot.mockResolvedValue(snapshot({ status:'stopped',
    items:[{...item('command_execution',{command:'ls',status:'running',output:'partial output'}),turnId:'ended',terminal:'unconfirmed'}],
    turns:[{turn_id:'ended',status:'interrupted',started_at:started,ended_at:ended}],
  }));
  render(<AgentTaskView taskId="task"/>);
  const label = await screen.findByText('1 条命令未收到结果');
  expect(screen.queryByText('正在运行 ls')).toBeNull();
  fireEvent.click(label.closest('summary')!);
  expect((await screen.findByLabelText('命令输出')).textContent).toContain('partial output');
});

it('shows a restored draft image and a sent image with separate preview sources', async () => {
  let urlNumber = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:http://localhost/picture-' + ++urlNumber; }
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  imageRead.mockResolvedValue({ mime: 'image/png', base64: 'YWJj', totalBytes: 3, next: 3, revision: 'r' });
  const pending = { id: 'draft-shot', name: '待发送.png', image: true, kind: 'path', mime: 'image/png', relativePath: 'pending.png' };
  const sent = { name: '历史图片.png', image: true, kind: 'file' };
  mocks.snapshot.mockResolvedValue(snapshot({
    draft: { revision: 1, draft: { text: '', attachments: [pending] } },
    items: [{ ...item('user_message', { text: '旧消息', attachments: [sent, { name: 'notes.txt', kind: 'file' }] }), turnId: 'older' }],
  }));
  render(<AgentTaskView taskId="task" />);
  const sentImage = await screen.findByRole('img', { name: sent.name });
  fireEvent.load(sentImage);
  fireEvent.click(screen.getByRole('button', { name: '预览图片 ' + sent.name }));
  const dialog = await screen.findByRole('dialog', { name: '图片预览' });
  expect(within(dialog).getByRole('img', { name: sent.name })).toHaveProperty('src', sentImage.getAttribute('src'));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect(screen.getByText('notes.txt')).toBeTruthy();

  await screen.findByRole('img', { name: pending.name });
  expect(imageRead).toHaveBeenCalledWith('task', { kind: 'draft', attachmentId: pending.id }, 0, undefined);
  expect(imageRead).toHaveBeenCalledWith('task', { kind: 'message', turnId: 'older', index: 0 }, 0, undefined);
  fireEvent.click(screen.getByRole('button', { name: '移除 ' + pending.name }));
  expect(screen.queryByRole('img', { name: pending.name })).toBeNull();
  expect(screen.getByRole('img', { name: sent.name })).toBeTruthy();
});

describe.each([
  {status:'started', taskStatus:'working', stopping:true, title:'正在停止…'},
  {status:'interrupted', taskStatus:'stopped', stopping:false, title:'你在 12 秒后停止了'},
  {status:'failed', taskStatus:'failed', stopping:false, title:'工作 12 秒后失败'},
])('E1 $title', ({status, taskStatus, stopping, title}) => {
  it.each([true, false])('follows the user message and replaces the generic title (with tools: %s)', async withTools => {
    const started = '2026-11-18T10:00:00Z', ended = '2026-11-18T10:00:12Z';
    const row = (ordinal:number, type:string, payload:unknown) => ({...item(type,payload),ordinal,itemId:'e1-'+ordinal,turnId:'e1'});
    const items = [row(1,'user_message',{text:'试一下这轮操作'})];
    if (withTools) {
      items.push(row(2,'command_execution',{command:'读第一份',status:'completed'}));
      items.push(row(3,'todo_list',{entries:[]}));
      items.push(row(4,'command_execution',{command:'读第二份',status:'completed'}));
    }
    const requestedAt = Date.now();
    mocks.snapshot.mockResolvedValue(snapshot({
      items, turns:[{turn_id:'e1',status,started_at:started,ended_at:stopping?null:ended}],
      status:taskStatus, ...(stopping ? {stopping:{runId:'e1-run',requestedAt,forceAt:requestedAt+10000,closing:false}} : {}),
    }));
    render(<AgentTaskView taskId="task"/>);
    const user = await screen.findByText('试一下这轮操作');
    const turn = user.closest<HTMLElement>('.agent-turn')!;
    const heading = within(turn).getByText(title);
    expect(user.closest('.agent-user')?.nextElementSibling?.contains(heading)).toBe(true);
    expect(within(turn).getAllByText(title)).toHaveLength(1);
    expect(within(turn).queryByText(/^(已工作|工作中) \d+/)).toBeNull();
    if (status === 'failed') expect(heading.closest('.agent-turn-failed')).toBeTruthy();
    if (withTools) {
      const control = within(turn).getByRole('button',{name:title});
      const commands = within(turn).getAllByText('运行了 1 条命令');
      expect(commands).toHaveLength(2);
      fireEvent.click(commands[1].closest('summary')!);
      expect((await within(turn).findByLabelText('完整命令')).textContent).toContain('读第二份');
      fireEvent.click(control);
      expect(within(turn).queryByText('运行了 1 条命令')).toBeNull();
    } else {
      expect(within(turn).queryByRole('button',{name:title})).toBeNull();
    }
  });
});

it('A69 blocks a known executor command the current executor has not published instead of sending it as text (D06-65)', async () => {
  const run = { runId:'r', generation:1, driverId:'codex-app-server', tier:'ask', busy:false, steer:false, goal:true, catalog:{ commands:['goal','compact','review'], skills:[] } };
  mocks.snapshot.mockResolvedValue(snapshot({ run }));
  mocks.command.mockResolvedValue({ ok:true });
  const { container } = render(<AgentTaskView taskId="task" />);
  const composer = await screen.findByPlaceholderText('随心输入') as HTMLTextAreaElement;
  const submit = () => fireEvent.click(container.querySelector('.agent-composer button[type="submit"]')!);
  fireEvent.change(composer, { target:{ value:'/init' } });
  submit();
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('/init')));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.command).not.toHaveBeenCalled();
  expect(composer.value).toBe('/init');
  // A published command still goes through the native command path, and ordinary text starting with a slash is not blocked.
  fireEvent.change(composer, { target:{ value:'/review' } });
  submit();
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('task','review',undefined));
  mocks.submit.mockResolvedValue({ status:'accepted', turnId:'t' });
  fireEvent.change(composer, { target:{ value:'/tmp 满了' } });
  submit();
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('task', expect.objectContaining({ text:'/tmp 满了' })));
});

it('A69 shows an unknown goal state when the executor reply could not be recognised, with clear available (D06-66)', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ selection:{ driverId:'claude-sdk', profileId:'p', tier:'ask' }, goalUnknown:{ kind:'set', objective:'修完断言' } }));
  mocks.goal.mockResolvedValue({ ok:true });
  render(<AgentTaskView taskId="task" />);
  const row = await screen.findByTestId('agent-goal-unknown');
  expect(row.textContent).toContain('修完断言');
  expect(row.textContent).toContain('状态未知');
  fireEvent.click(within(row).getByRole('button',{ name:'清除' }));
  await waitFor(() => expect(mocks.goal).toHaveBeenCalledWith('task',{ kind:'clear' }));
});

it('A41 marks a mail review whose draft was changed after creation as 已修改, like the confirmed prototype (D06-75)', async () => {
  const review = (draftRevision:number) => ({ requestId:'mail', kind:'host_business', status:'pending', revision:1, origin:{},
    payload:{ businessKind:'mail_send', phase:'waiting_user', title:'需要批准：发送邮件',
      options:[{label:'批准发送',value:'allow'},{label:'拒绝',value:'deny'}],
      review:{fromAddress:'sender@example.invalid',draftRevision,attachments:[],priorUnknownExecutionIds:[],
        content:{to:['qa@example.invalid'],cc:[],bcc:[],subject:'主题',text:'正文',html:null}} } });
  mocks.businessReview.mockResolvedValue({ displayReceiptId:'display-receipt' });
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[review(1)] }));
  const first = render(<AgentTaskView taskId="task"/>);
  const original = await screen.findByRole('region', {name:'邮件审阅'});
  expect(within(original).queryByText('已修改')).toBeNull();
  first.unmount();
  mocks.snapshot.mockResolvedValue(snapshot({ requests:[review(3)] }));
  render(<AgentTaskView taskId="task"/>);
  const changed = await screen.findByRole('region', {name:'邮件审阅'});
  expect(within(changed).getByText('已修改')).toBeTruthy();
  expect(within(changed).getByText(/第 3 版/)).toBeTruthy();
});

// 2026-11-20 对齐 T3：请求面板在输入框上方，输入框与模型／档位入口始终保留（A72）。
it('A72 keeps the composer, model and tier while a host business request waits; sending is a normal message', async () => {
  const business = { requestId: 'business', kind: 'host_business', origin: {}, revision: 1, status: 'pending', payload: { title: '需要批准：写入合成记录', phase: 'waiting_user' } };
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'waiting', requests: [business] }));
  mocks.respond.mockReset(); mocks.submit.mockReset().mockResolvedValue({ turnId: 't1', duplicate: false, status: 'accepted' });
  render(<AgentTaskView taskId="task" />);
  await screen.findByRole('dialog', { name: '待处理请求' });
  expect(screen.getByLabelText('权限档位')).toBeTruthy();
  const box = document.querySelector('.agent-composer textarea') as HTMLTextAreaElement;
  expect(box.placeholder).toContain('待批准的请求会继续保留');
  fireEvent.change(box, { target: { value: '先说明一下情况' } });
  fireEvent.submit(box.closest('form')!);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0][1]).toMatchObject({ text: '先说明一下情况' });
  expect(mocks.respond).not.toHaveBeenCalled();
});

it('A72 sending text while an own Codex command approval waits declines it and steers the sentence into the turn', async () => {
  const now = Date.now();
  const turnId = 'approval-turn';
  const start = new Date(now - 12_000).toISOString();
  const command = { requestId: 'command', kind: 'command_approval', origin: { turnId }, revision: 3, status: 'pending', payload: { params: { command: 'rm -rf build', availableDecisions: ['accept', 'decline'] } } };
  mocks.snapshot.mockResolvedValue(snapshot({
    status: 'waiting', requests: [command], run: { busy: true, steer: true },
    items: [{ ...item('user_message', { text: '清理合成目录' }), turnId }],
    turns: [{ turn_id: turnId, status: 'started', accepted_at: start, started_at: start, ended_at: null, native_wait_since: now - 7_000 }],
  }));
  mocks.respond.mockReset().mockResolvedValue(undefined); mocks.submit.mockReset().mockResolvedValue({ turnId: 't1', duplicate: false, status: 'accepted' });
  render(<AgentTaskView taskId="task" />);
  await screen.findByRole('dialog', { name: '待处理请求' });
  expect(screen.queryByText(/等待用户处理|用户处理耗时/)).toBeNull();
  const box = document.querySelector('.agent-composer textarea') as HTMLTextAreaElement;
  expect(box.placeholder).toBe('发送文字即拒绝这次请求并说明原因');
  expect(document.querySelector('.agent-request-reason')).toBeNull();
  fireEvent.change(box, { target: { value: '不要删 build，改用 clean 脚本' } });
  fireEvent.submit(box.closest('form')!);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.respond).toHaveBeenCalledExactlyOnceWith('task', 'command', 3, { decision: 'decline' });
  expect(mocks.submit.mock.calls[0][1]).toMatchObject({ text: '不要删 build，改用 clean 脚本', mode: 'steer' });
});

it('A72 for Claude the reason goes into the denial itself and is not sent twice', async () => {
  const command = { requestId: 'command', kind: 'command_approval', origin: {}, revision: 2, status: 'pending', payload: { input: { command: 'rm -rf build' } } };
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'waiting', selection: { driverId: 'claude-sdk', profileId: 'p', tier: 'ask' }, requests: [command], run: { busy: true, steer: false } }));
  mocks.respond.mockReset().mockResolvedValue(undefined); mocks.submit.mockReset();
  render(<AgentTaskView taskId="task" />);
  await screen.findByRole('dialog', { name: '待处理请求' });
  const box = document.querySelector('.agent-composer textarea') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: '改用 clean 脚本' } });
  fireEvent.submit(box.closest('form')!);
  await waitFor(() => expect(mocks.respond).toHaveBeenCalledTimes(1));
  expect(mocks.respond).toHaveBeenCalledWith('task', 'command', 2, { behavior: 'deny', message: '改用 clean 脚本' });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('A52 closing the terminal drawer returns focus to the composer instead of leaving it on the page body (D06-78)', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'idle' }));
  const { panelsFor } = await import('./workspace-panels-store');
  render(<AgentTaskView taskId="task" />);
  const box = await waitFor(() => { const t = document.querySelector('.agent-composer textarea') as HTMLTextAreaElement; expect(t).toBeTruthy(); return t; });
  act(() => { panelsFor({ kind: 'task', taskId: 'task' }).drawer = true; });
  const close = await screen.findByRole('button', { name: 'mock-close-terminal' });
  close.focus();
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByTestId('mock-terminal')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(box));
});

it('A52 closing the terminal does not steal focus the user already moved elsewhere', async () => {
  mocks.snapshot.mockResolvedValue(snapshot({ status: 'idle' }));
  const { panelsFor } = await import('./workspace-panels-store');
  render(<><input aria-label="elsewhere" /><AgentTaskView taskId="task" /></>);
  await waitFor(() => expect(document.querySelector('.agent-composer textarea')).toBeTruthy());
  act(() => { panelsFor({ kind: 'task', taskId: 'task' }).drawer = true; });
  await screen.findByTestId('mock-terminal');
  const other = screen.getByLabelText('elsewhere'); other.focus();
  act(() => { panelsFor({ kind: 'task', taskId: 'task' }).drawer = false; });
  await waitFor(() => expect(screen.queryByTestId('mock-terminal')).toBeNull());
  expect(document.activeElement).toBe(other);
});
