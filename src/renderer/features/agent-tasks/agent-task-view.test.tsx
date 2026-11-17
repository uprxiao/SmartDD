// @vitest-environment jsdom
// M14-A45 长内容全文与复制、A43 草稿初始化竞态（复核 2127 FR04／FR05）：组件层回归，不代替打包 App 验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), on: vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn(), draftBody: vi.fn(), toast: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: mocks }, events: { on: mocks.on } }));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: () => null }));
vi.mock('./agent-terminal', () => ({ AgentTerminalDrawer: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import {agentComposerTargets} from './composer-target';
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
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('草稿已在别处更新')));
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
    fireEvent.click(await screen.findByRole('button', { name: /已工作/ }));
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
