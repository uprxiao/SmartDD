// @vitest-environment jsdom
// M14-A45 长内容全文与复制、A43 草稿初始化竞态（复核 2127 FR04／FR05）：组件层回归，不代替打包 App 验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), profiles: vi.fn(), submit: vi.fn(), saveDraft: vi.fn(), on: vi.fn(), archive:vi.fn(), unarchive:vi.fn(), discardAttachment:vi.fn(), prepareAttachment: vi.fn(), itemBody: vi.fn(), draftBody: vi.fn(), businessReview: vi.fn(), requestBody: vi.fn(), respond: vi.fn(), readUserInput: vi.fn(), editQueued: vi.fn(), sendQueued: vi.fn(), cancelQueued: vi.fn(), retryFailedInput: vi.fn(), forceStop: vi.fn(), toast: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: mocks }, events: { on: mocks.on } }));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { refresh: vi.fn() } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { newTask: vi.fn(), openAgentTask:vi.fn(), setAgentTaskReadOnly:vi.fn() } }));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({ useAppSettingsKey: () => ({ value: { fullConfirmed: true }, update: vi.fn() }) }));
vi.mock('@renderer/features/agents/ui', () => ({ AgentDialog: ({title,children,footer}: {title:string;children:React.ReactNode;footer:React.ReactNode}) => <div role="dialog" aria-label={title}>{children}{footer}</div> }));
vi.mock('./agent-terminal', () => ({ AgentTerminalDrawer: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.toast, error: mocks.toast, message: mocks.toast, success: mocks.toast } }));
import {agentComposerTargets} from './composer-target';
import { AgentTaskView } from './agent-task-view';

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.mockResolvedValue([]);
  mocks.discardAttachment.mockResolvedValue(undefined);
  mocks.saveDraft.mockReset().mockResolvedValue({ ok: true, revision: 1 });
  mocks.on.mockImplementation(() => () => {});
  mocks.prepareAttachment.mockResolvedValue({ id: 'prepared', kind: 'path', name: 'note.txt', mime: 'text/plain', size: 1, image: false, relativePath: 'note.txt' });
  (window as any).electronAPI = { pathForFile: () => '/w/note.txt' };
  HTMLElement.prototype.scrollTo = vi.fn();
});
const snapshot = (extra: any = {}) => ({ taskId: 'task', title: 't', cwd: '/w', projectId: null, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' }, selectionRevision: 1, draft: null, items: [], turns: [], requests: [], queued: [], queuedTotal: 0, run: null, goal: null, goalPending: null, status: 'idle', seq: 1, hasOlder: false, ...extra });
const item = (type: string, payload: any) => ({ itemId: 'long', turnId: null, ordinal: 1, revision: 1, type, terminal: 'completed', createdAt: '', updatedAt: '', payload });
/** 把完整正文按两段返回，模拟按字节分段读取。 */
const serveInTwo = (payload: unknown) => { const t = JSON.stringify(payload), mid = Math.floor(t.length / 2); return (_: string, __: string, off: number) => Promise.resolve(off === 0 ? { chunk: t.slice(0, mid), next: 1, done: false } : { chunk: t.slice(mid), next: 2, done: true }); };

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
  fireEvent.click(await screen.findByRole('option', { name: /批准/ }));
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

it('F02 edits the exact queued input, then sends and removes it without using the composer', async () => {
  const queued = {turnId:'q', version:'v1', text:'旧预览', acceptedAt:'2026-11-18T00:00:00Z', editable:true, attachmentCount:1};
  let state = snapshot({queued:[queued], queuedTotal:1});
  mocks.snapshot.mockImplementation(async () => state);
  mocks.readUserInput.mockImplementation(serveInTwo({text:'全文与附件'}));
  mocks.editQueued.mockImplementation(async () => { state = snapshot({seq:2, queued:[{...queued,text:'修改后',version:'v2'}],queuedTotal:1}); });
  mocks.sendQueued.mockResolvedValue({status:'queued'});
  mocks.cancelQueued.mockImplementation(async () => {state = snapshot({seq:3});});
  render(<AgentTaskView taskId="task" />);
  const edit = await screen.findByTitle('编辑排队消息');
  expect(edit.closest('.agent-bottom')).toBeTruthy();
  fireEvent.click(edit);
  const editor = await screen.findByRole('textbox', {name:'编辑排队消息'});
  expect((editor as HTMLTextAreaElement).value).toBe('全文与附件');
  fireEvent.change(editor, {target:{value:'修改后'}});
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await screen.findByText('修改后');
  expect(mocks.editQueued).toHaveBeenCalledExactlyOnceWith('task','q','v1','修改后');
  await waitFor(() => expect((screen.getByTitle('立即发送') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTitle('立即发送'));
  await waitFor(() => expect(mocks.sendQueued).toHaveBeenCalledExactlyOnceWith('task','q','v2',1));
  await waitFor(() => expect((screen.getByTitle('删除排队消息') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTitle('删除排队消息'));
  await waitFor(() => expect(mocks.cancelQueued).toHaveBeenCalledExactlyOnceWith('task','q'));
  expect(mocks.submit).not.toHaveBeenCalled();
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
  expect(paragraph.nextElementSibling?.textContent).toContain('正在运行 pnpm test');
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
      expect(within(turn).getByText('运行了 读第二份')).toBeTruthy();
      fireEvent.click(control);
      expect(within(turn).queryByText('运行了 读第一份')).toBeNull();
      expect(within(turn).queryByText('运行了 读第二份')).toBeNull();
    } else {
      expect(within(turn).queryByRole('button',{name:title})).toBeNull();
    }
  });
});
