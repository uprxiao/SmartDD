// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigation } from '@renderer/core/navigation';
import { SidebarProjects } from './sidebar-projects';

const m = vi.hoisted(() => ({
  setArchived: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
  refresh: vi.fn(),
  projects: vi.fn(),
  tasksFor: vi.fn(),
  project: { id: 'p1', name: 'AIS', archivedAt: null as string | null },
  detail: { id: 'p1', name: 'AIS', archivedAt: null, dirs: [{ id: 'd1', path: '/private/ais', isDefault: true }], databases: [], servers: [] },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/lib/hooks/useProjects', () => ({
  useProjectList: () => ({ data: m.projects() }),
  useProject: (id: string | null) => ({ data: id ? m.detail : undefined }),
  useRefreshProjects: () => m.refresh,
}));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { projects: { setArchived: m.setArchived, delete: m.remove, deletePreview:m.preview } }, events: { on: () => () => undefined } }));
vi.mock('@renderer/core/agent-tasks-store', () => ({ agentTasksStore: { of: m.tasksFor, refresh: m.refresh } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.setArchived.mockResolvedValue(undefined);
  m.remove.mockResolvedValue(undefined);
  m.preview.mockResolvedValue({taskCount:0,archivedCount:0,paths:[],worktrees:[],blockers:[],confirmation:null});
  m.refresh.mockResolvedValue(undefined);
  m.projects.mockReturnValue([m.project]);
  m.tasksFor.mockReset().mockReturnValue([]);
});
afterEach(() => {
  cleanup();
  navigation.closeProject('p1');
  navigation.closeProject('p2');
  navigation.newTask();
});

const openMenu = async () => { fireEvent.click(screen.getByTestId('sidebar-project-more')); return screen.findByTestId('sidebar-project-delete'); };

it('clicking the project name toggles its sessions and retains the active task and collapsed state', async () => {
  m.projects.mockReturnValue([m.project, { id: 'p2', name: 'Other', archivedAt: null }]);
  m.tasksFor.mockImplementation((projectId: string) => [{
    projectId,
    taskId: `task-${projectId}`,
    title: projectId === 'p1' ? 'AIS session' : 'Other session',
    status: 'completed',
  }]);
  const user = userEvent.setup();
  const sidebar = render(<SidebarProjects />);
  const aisRow = () => within(screen.getByText('AIS').closest<HTMLElement>('[data-testid="sidebar-project"]')!);
  await user.click(screen.getByRole('button', { name: 'AIS session' }));

  const toggle = aisRow().getByRole('button', { name: 'tasks.collapseProject', expanded: true });
  await user.click(aisRow().getByText('AIS'));
  expect(aisRow().getByRole('button', { name: 'tasks.expandProject', expanded: false })).toBe(toggle);
  expect(screen.queryByRole('button', { name: 'AIS session' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Other session' })).toBeTruthy();
  expect(navigation.currentViewId).toBe('agentTask');
  expect(navigation.currentAgentTaskId).toBe('task-p1');

  sidebar.unmount();
  render(<SidebarProjects />);
  expect(screen.queryByRole('button', { name: 'AIS session' })).toBeNull();
  const reopenedToggle = aisRow().getByRole('button', { name: 'tasks.expandProject', expanded: false });
  reopenedToggle.focus();
  await user.keyboard('{Enter}');
  expect(reopenedToggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'AIS session', current: 'page' })).toBeTruthy();
});

it('opens the project menu and starts a project draft from their own buttons while the project is collapsed', async () => {
  const user = userEvent.setup();
  render(<SidebarProjects />);
  const toggle = screen.getByTestId('sidebar-project-toggle');
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  await user.click(screen.getByTestId('sidebar-project-more'));
  expect(await screen.findByTestId('sidebar-project-edit')).toBeTruthy();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByTestId('project-detail-popup')).toBeNull());

  await user.click(screen.getByTestId('sidebar-project-new-task'));
  expect(navigation.homePreset?.projectId).toBe('p1');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

describe('sidebar project menu', () => {
  it('names the entry that opens the project page as project settings', async () => {
    render(<SidebarProjects />);
    await openMenu();
    expect(screen.getByTestId('sidebar-project-edit').textContent).toBe('m6.projectResources');
  });
  it('archives the project from the menu', async () => {
    render(<SidebarProjects />);
    await openMenu();
    fireEvent.click(screen.getByTestId('sidebar-project-archive'));
    await waitFor(() => expect(m.setArchived).toHaveBeenCalledWith('p1', true));
    expect(m.refresh).toHaveBeenCalled();
  });
  it('deletes only after the confirm dialog is accepted', async () => {
    render(<SidebarProjects />);
    fireEvent.click(await openMenu());
    const title = await screen.findByText('projects.confirm.projectTitle');
    expect(m.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/将删除 0 个 Agent 任务/)).toBeTruthy());
    const confirm = screen.getAllByRole('button', { name: '删除项目' }).find((b) => title.closest('[role="dialog"]')?.contains(b));
    fireEvent.click(confirm!);
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith('p1', { deleteSecrets: true }));
  });
});

it('G1 shows the precise delete inventory and sends the checked confirmation', async () => {
  m.preview.mockResolvedValueOnce({taskCount:3,archivedCount:1,paths:['/private/ais'],worktrees:['/private/fixture/worktree'],blockers:[],confirmation:'listed-records'});
  render(<SidebarProjects />);
  fireEvent.click(await openMenu());
  expect(await screen.findByText(/将删除 3 个 Agent 任务/)).toBeTruthy();
  expect(screen.getByText('/private/fixture/worktree')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'删除项目'}));
  await waitFor(()=>expect(m.remove).toHaveBeenCalledWith('p1',{deleteSecrets:true,agentTaskDeletionConfirmation:'listed-records'}));
});

it('G1 names the blocker without offering destructive confirmation', async () => {
  m.preview.mockResolvedValueOnce({taskCount:1,archivedCount:0,paths:[],worktrees:[],blockers:[{taskId:'busy',title:'写入任务',reasons:['有待处理请求']}],confirmation:'busy'});
  render(<SidebarProjects />);
  fireEvent.click(await openMenu());
  expect(await screen.findByText('项目暂时无法删除')).toBeTruthy();
  expect(screen.getByText('写入任务')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'删除项目'})).toBeNull();
  expect(m.remove).not.toHaveBeenCalled();
});
