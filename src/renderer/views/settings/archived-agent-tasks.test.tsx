// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArchivedAgentTasks } from './archived-agent-tasks';

const fixture=vi.hoisted(()=>({list:vi.fn(),restore:vi.fn(),open:vi.fn(),refresh:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{agentTasks:{listArchived:fixture.list,unarchive:fixture.restore}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{openAgentTask:fixture.open}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{refresh:fixture.refresh}}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
afterEach(cleanup);

it('G5 includes archived projects, opens read-only and restores without exposing deletion',async()=>{
  fixture.list.mockResolvedValue([{taskId:'archived',projectId:'p',projectName:'Archived project',projectArchived:true,title:'Older task',driverId:'codex-app-server',archivedAt:'2026-11-18T12:00:00Z'}]);
  fixture.restore.mockImplementation(async()=>fixture.list.mockResolvedValue([]));
  render(<QueryClientProvider client={new QueryClient()}><ArchivedAgentTasks/></QueryClientProvider>);
  expect(await screen.findByText('已归档项目')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Older task/}));
  expect(fixture.open).toHaveBeenCalledWith('archived',true);
  expect(screen.queryByRole('button',{name:/删除/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'恢复'}));
  expect(await screen.findByText('还没有已归档任务')).toBeTruthy();
  await waitFor(()=>expect(fixture.refresh).toHaveBeenCalledTimes(1));
});
