// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransferDraft, TransferPreview } from '@shared/project-transfer';
import { ProjectTransfer } from './project-transfer';

const mocks = vi.hoisted(() => ({
  api: Object.fromEntries(['describeExport', 'export', 'chooseImport', 'unlock', 'pickDirectory', 'pickRules', 'validateDraft', 'commit', 'getResult', 'dispose', 'revealExport'].map(n => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>,
  projects: vi.fn(), profiles: vi.fn(), openProject: vi.fn(), newTask: vi.fn(),
}));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { projectTransfer: mocks.api } }));
vi.mock('@renderer/lib/hooks/useProjects', () => ({ useRefreshProjects: () => mocks.projects }));
vi.mock('@renderer/lib/hooks/useAiProfiles', () => ({ useRefreshAiProfiles: () => mocks.profiles, useAiProfiles: () => ({ data: [{ id: 'profile-a', name: 'AI A', runner: 'claude' }, { id: 'profile-b', name: 'AI B', runner: 'codex' }] }) }));
vi.mock('@renderer/core/navigation', () => ({ navigation: { openProject: mocks.openProject, newTask: mocks.newTask } }));
const ok = (value: unknown) => ({ ok: true, value });
const preview = (): TransferPreview => ({ token: 'preview', project: { name: '迁移项目', aliases: [], description: '', rulesPath: null }, suggestedName: '迁移项目', directories: [{ ref: 'dir', label: '主目录', sourcePath: '/source', isDefault: true }], resources: [], capabilities: [], profiles: ['a', 'b'].map(ref => ({ ref, name: `AI ${ref}`, runner: 'claude', executable: '/missing/claude', env: [] })), counts: { directories: 1, databases: 0, servers: 0, profiles: 2 } });
const result = { requestId: 'request', projectId: 'new-project', name: '迁移项目', profileIds: [], counts: { directories: 1, databases: 0, servers: 0, profiles: 0 }, warnings: [] };
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const field = (name: string) => screen.getByLabelText(name, { exact: true }) as HTMLInputElement;
async function unlock() {
  fireEvent.click(screen.getByRole('button', { name: /选择项目文件/ }));
  await screen.findByLabelText('导入口令');
  fireEvent.change(field('导入口令'), { target: { value: '12345678' } }); fireEvent.click(button('解锁并预览'));
  await screen.findByLabelText('导入后的项目名称');
}
async function pick() { fireEvent.click(button('选择本机目录：主目录')); await waitFor(() => expect(button('导入项目').disabled).toBe(false)); }
beforeEach(() => {
  vi.resetAllMocks(); HTMLElement.prototype.scrollTo = vi.fn();
  mocks.projects.mockResolvedValue(undefined); mocks.profiles.mockResolvedValue(undefined);
  mocks.api.chooseImport.mockResolvedValue(ok({ fileToken: 'file', fileName: 'sample.willyou' }));
  mocks.api.unlock.mockResolvedValue(ok(preview())); mocks.api.pickDirectory.mockResolvedValue(ok('/picked'));
  mocks.api.validateDraft.mockImplementation(async (_token, d: TransferDraft) => ok({ valid: d.directories.every(row => row.mode === 'source' || row.localPath), issues: [], profiles: d.selectedProfileRefs.map(ref => ({ ref, available: false, command: 'claude' })), counts: { ...result.counts, profiles: d.selectedProfileRefs.length }, directories: d.directories.map(row => ({ ref: row.ref, path: row.mode === 'source' ? '/source' : row.localPath, status: { available: !!row.localPath || row.mode === 'source' }, issue: row.localPath || row.mode === 'source' ? null : '请选择本机代码文件夹后继续' })) }));
  mocks.api.describeExport.mockImplementation(async (_id, selected: string[]) => ok({ project: preview().project, directories: preview().directories, resources: [], capabilities: [], profiles: [], counts: { ...result.counts, profiles: selected.length }, missing: [] }));
  mocks.api.commit.mockResolvedValue(ok(result)); mocks.api.dispose.mockResolvedValue(ok(undefined));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('M8 real transfer form interactions', () => {
  it('E02/E03/E05 preserves password on native cancellation and exports the selected AI only', async () => {
    mocks.api.export.mockResolvedValue(ok(null)); render(<ProjectTransfer mode="export" projectId="p" onClose={vi.fn()} />);
    await screen.findByText('迁移项目');
    fireEvent.change(field('设置导出口令'), { target: { value: '1234567' } }); fireEvent.change(field('再次输入口令'), { target: { value: '1234567' } }); expect(button('加密并导出').disabled).toBe(true);
    fireEvent.change(field('设置导出口令'), { target: { value: ' 中文口令1234 ' } }); expect(button('加密并导出').disabled).toBe(true);
    fireEvent.change(field('再次输入口令'), { target: { value: ' 中文口令1234 ' } });
    fireEvent.click(field('导出 AI 配置：AI B'));
    await waitFor(() => expect(button('加密并导出').disabled).toBe(false)); fireEvent.click(button('加密并导出'));
    await screen.findByLabelText('设置导出口令'); expect(field('设置导出口令').value).toBe(' 中文口令1234 ');
    expect(mocks.api.export).toHaveBeenCalledWith({ projectId: 'p', profileIds: ['profile-b'], emptyPasswordRefs: [], passphrase: ' 中文口令1234 ', confirmation: ' 中文口令1234 ' });
    expect(screen.queryByText('项目已导出')).toBeNull();
  });
  it('E06 clears passwords on write failure and permits a new successful export', async () => {
    mocks.api.export.mockResolvedValueOnce({ ok: false, code: 'FILE_IO_FAILED', message: '无法保存项目文件' }).mockResolvedValueOnce(ok({ path: '/new.willyou', fileName: 'new.willyou' }));
    render(<ProjectTransfer mode="export" projectId="p" onClose={vi.fn()} />); await screen.findByText('迁移项目');
    const submit = async () => { fireEvent.change(field('设置导出口令'), { target: { value: '12345678' } }); fireEvent.change(field('再次输入口令'), { target: { value: '12345678' } }); fireEvent.click(button('加密并导出')); };
    await submit(); await screen.findByText('无法保存项目文件'); expect(field('设置导出口令').value).toBe(''); expect(field('再次输入口令').value).toBe('');
    await submit(); await screen.findByText('项目已导出'); expect(screen.getByText('/new.willyou')).toBeTruthy();
  });
  it('I01/I02 clears a wrong password and retries without creating any project', async () => {
    mocks.api.unlock.mockResolvedValueOnce({ ok: false, code: 'UNLOCK_FAILED', message: '口令不正确，或文件已经损坏' }).mockResolvedValueOnce(ok(preview()));
    render(<ProjectTransfer mode="import" onClose={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: /选择项目文件/ })); await screen.findByLabelText('导入口令');
    expect(screen.queryByText('迁移项目')).toBeNull();
    fireEvent.change(field('导入口令'), { target: { value: 'wrong' } }); fireEvent.click(button('解锁并预览'));
    await screen.findByText('口令不正确，或文件已经损坏'); expect(field('导入口令').value).toBe('');
    fireEvent.change(field('导入口令'), { target: { value: '12345678' } }); fireEvent.click(button('解锁并预览'));
    await screen.findByLabelText('导入后的项目名称'); expect(mocks.api.commit).not.toHaveBeenCalled();
  });
  it('I04 rejects invalid files at selection and permits a valid replacement without an empty project', async () => {
    mocks.api.chooseImport.mockResolvedValueOnce({ ok: false, code: 'MALFORMED', message: '文件格式无效' })
      .mockResolvedValueOnce({ ok: false, code: 'UNSUPPORTED_VERSION', message: '文件版本不支持' })
      .mockResolvedValueOnce(ok({ fileToken: 'replacement', fileName: 'valid.willyou' }));
    render(<ProjectTransfer mode="import" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /选择项目文件/ })); await screen.findByText('文件格式无效');
    expect(screen.queryByLabelText('导入口令')).toBeNull(); expect(mocks.api.unlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /选择项目文件/ })); await screen.findByText('文件版本不支持');
    await unlock(); expect(screen.queryByText('文件版本不支持')).toBeNull(); expect(mocks.api.commit).not.toHaveBeenCalled();
    expect(mocks.api.unlock).toHaveBeenCalledWith('replacement', '12345678');
  });
  it('D02/D09 keeps local directory drafts and collapses the AI section when all choices are cleared', async () => {
    render(<ProjectTransfer mode="import" onClose={vi.fn()} />); await unlock();
    expect(field('选择本机目录方式：主目录').checked).toBe(true); expect(field('导入目录：主目录').value).toBe(''); expect(button('导入项目').disabled).toBe(true);
    expect(field('导入文件中的 AI 配置').checked).toBe(false); expect(screen.queryByLabelText('导入 AI 配置：AI a')).toBeNull();
    await pick(); fireEvent.click(field('使用原代码位置：主目录')); expect(field('导入目录：主目录').disabled).toBe(true);
    fireEvent.click(field('选择本机目录方式：主目录')); expect(field('导入目录：主目录').value).toBe('/picked');
    fireEvent.click(field('导入文件中的 AI 配置')); expect(field('导入 AI 配置：AI a').checked).toBe(true); expect(field('导入 AI 配置：AI b').checked).toBe(true);
    fireEvent.click(field('导入 AI 配置：AI a')); expect(screen.queryByLabelText('导入 AI 命令：AI a')).toBeNull();
    fireEvent.click(field('导入 AI 配置：AI b')); expect(field('导入文件中的 AI 配置').checked).toBe(false); expect(screen.queryByLabelText('导入 AI 配置：AI a')).toBeNull();
    fireEvent.click(field('导入文件中的 AI 配置')); fireEvent.click(field('导入文件中的 AI 配置')); expect(screen.queryByLabelText('导入 AI 配置：AI a')).toBeNull();
  });
  it('D08 keeps an empty AI checkbox visible and disables the unavailable original directory', async () => {
    const p = preview(); p.profiles = []; p.directories[0].sourcePath = ''; p.counts.profiles = 0; mocks.api.unlock.mockResolvedValue(ok(p));
    render(<ProjectTransfer mode="import" onClose={vi.fn()} />); await unlock();
    expect(field('导入文件中的 AI 配置').disabled).toBe(true); expect(field('导入文件中的 AI 配置').checked).toBe(false); expect(field('使用原代码位置：主目录').disabled).toBe(true);
    await pick(); fireEvent.click(button('导入项目')); await screen.findByText('项目已导入'); fireEvent.click(button('新建任务')); expect(mocks.newTask).toHaveBeenCalledWith('new-project');
  });
  it('D04 refreshes a stale usable-directory status after commit rejection and keeps selections for retry', async () => {
    render(<ProjectTransfer mode="import" onClose={vi.fn()} />); await unlock(); await pick();
    fireEvent.click(field('导入文件中的 AI 配置'));
    await waitFor(() => expect(button('导入项目').disabled).toBe(false));
    mocks.api.commit.mockResolvedValueOnce({ ok: false, code: 'INVALID_DRAFT', message: '目标目录已经不可用' }).mockResolvedValueOnce(ok(result));
    mocks.api.validateDraft.mockResolvedValueOnce(ok({ valid: false, issues: [{ field: 'directories', message: '目录不存在' }], profiles: [], counts: result.counts, directories: [{ ref: 'dir', path: '/picked', status: { available: false }, issue: '目录不存在，请重新选择' }] }));
    fireEvent.click(button('导入项目'));
    await screen.findByText('目标目录已经不可用');
    expect(screen.getByText('目录不存在，请重新选择')).toBeTruthy();
    expect(button('导入项目').disabled).toBe(true);
    expect(field('导入目录：主目录').value).toBe('/picked');
    expect(field('导入文件中的 AI 配置').checked).toBe(true);
    await pick(); fireEvent.click(button('导入项目')); await screen.findByText('项目已导入');
    expect(mocks.api.commit.mock.calls[1][2].selectedProfileRefs).toEqual(['a', 'b']);
  });
  it('F04 blocks repeated submit and closure while saving, and recovers a lost commit response', async () => {
    let resolve!: (r: unknown) => void; mocks.api.commit.mockReturnValue(new Promise(r => { resolve = r; })); mocks.api.getResult.mockResolvedValue(ok(result)); mocks.projects.mockRejectedValue(Error('cache failure'));
    const close = vi.fn(); render(<ProjectTransfer mode="import" onClose={close} />); await unlock(); await pick();
    const submit = button('导入项目'); fireEvent.click(submit); fireEvent.click(submit); fireEvent.click(button('关闭项目迁移'));
    expect(mocks.api.commit).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled(); expect(button('关闭项目迁移').disabled).toBe(true);
    await act(async () => resolve({ ok: false, code: 'COMMIT_FAILED', message: '响应丢失' })); await screen.findByText('项目已导入'); expect(mocks.api.getResult).toHaveBeenCalledTimes(1);
  });
  it('F06 preserves edits when the confirmation is dismissed and disposes previews only after leaving', async () => {
    const user = userEvent.setup(), close = vi.fn(), mounted = render(<ProjectTransfer mode="import" onClose={close} />);
    await unlock(); await pick(); fireEvent.change(field('导入后的项目名称'), { target: { value: '保留草稿' } }); fireEvent.click(field('导入文件中的 AI 配置'));
    await user.click(button('取消')); const confirm = await screen.findByRole('dialog', { name: '放弃这次导入？' });
    expect(within(confirm).getByRole('button', { name: '放弃并关闭' })).toBeTruthy(); await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '放弃这次导入？' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button('取消')));
    expect(field('导入后的项目名称').value).toBe('保留草稿'); expect(field('导入目录：主目录').value).toBe('/picked'); expect(field('导入文件中的 AI 配置').checked).toBe(true);
    expect(close).not.toHaveBeenCalled(); expect(mocks.api.dispose).not.toHaveBeenCalled();
    await user.click(button('取消')); await user.click(button('放弃并关闭')); expect(close).toHaveBeenCalledTimes(1);
    mounted.unmount(); expect(mocks.api.dispose).toHaveBeenCalledWith('preview'); expect(mocks.api.commit).not.toHaveBeenCalled();
  });
  it('F06 restores the persistent menu trigger after discarding a dialog opened by a removed menu item', async () => {
    function Entry() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [menu, setMenu] = useState(false), [open, setOpen] = useState(false);
      return <><button>首页</button><button ref={trigger} onClick={() => setMenu(true)}>项目菜单</button>
        {menu && <button onClick={() => { setMenu(false); setOpen(true); }}>导出此项目</button>}
        {open && <ProjectTransfer mode="export" projectId="p" returnFocus={trigger.current} onClose={() => setOpen(false)} />}</>;
    }
    const user = userEvent.setup(); render(<Entry />);
    await user.click(button('项目菜单')); await user.click(button('导出此项目'));
    await screen.findByText('迁移项目'); expect(screen.queryByRole('button', { name: '导出此项目' })).toBeNull();
    await user.type(field('设置导出口令'), '12345678');
    await user.click(button('取消')); await user.click(button('放弃并关闭'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button('项目菜单')));
    expect(mocks.api.export).not.toHaveBeenCalled();
  });
  it('F06 backdrop dismissal preserves the draft until explicitly discarded and is blocked while saving', async () => {
    const user = userEvent.setup(), close = vi.fn();
    render(<ProjectTransfer mode="import" onClose={close} />); await unlock(); await pick();
    const backdrop = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dialog-overlay"]')).at(-1)!;
    await user.click(backdrop()); await screen.findByRole('dialog', { name: '放弃这次导入？' });
    await user.click(backdrop());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '放弃这次导入？' })).toBeNull());
    expect(field('导入目录：主目录').value).toBe('/picked'); expect(close).not.toHaveBeenCalled();
    let resolve!: (r: unknown) => void; mocks.api.commit.mockReturnValue(new Promise(r => { resolve = r; }));
    await user.click(button('导入项目')); await user.click(backdrop()); await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog', { name: '放弃这次导入？' })).toBeNull();
    await act(async () => resolve(ok(result))); await screen.findByText('项目已导入');
  });
  it('I07 returns to file selection after expiry and releases a late decrypt result after unmount', async () => {
    mocks.api.validateDraft.mockResolvedValue({ ok: false, code: 'PREVIEW_EXPIRED', message: '导入预览已失效' });
    const first = render(<ProjectTransfer mode="import" onClose={vi.fn()} />); await unlock(); await screen.findByText('导入预览已失效'); expect(screen.getByRole('button', { name: /选择项目文件/ })).toBeTruthy(); first.unmount();
    let resolve!: (r: unknown) => void; mocks.api.unlock.mockReturnValue(new Promise(r => { resolve = r; })); mocks.api.dispose.mockClear();
    const second = render(<ProjectTransfer mode="import" onClose={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: /选择项目文件/ })); await screen.findByLabelText('导入口令');
    fireEvent.change(field('导入口令'), { target: { value: '12345678' } }); fireEvent.click(button('解锁并预览')); second.unmount();
    await act(async () => resolve(ok(preview()))); expect(mocks.api.dispose).toHaveBeenCalledWith('file'); expect(mocks.api.dispose).toHaveBeenCalledWith('preview');
  });
});
