// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseView, ServerView } from '@shared/projects';
import '@renderer/lib/i18n';
import { DatabaseDialog, ServerDialog } from './resource-dialogs';

const { databases, servers, close } = vi.hoisted(() => ({
  databases: { create: vi.fn(), update: vi.fn() },
  servers: { create: vi.fn(), update: vi.fn() },
  close: vi.fn(),
}));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { databases, servers } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: {} }));
vi.mock('@renderer/lib/hooks/useProjects', () => ({ useRefreshProjects: () => async () => {} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([
  ['database', DatabaseDialog, databases.create],
  ['server', ServerDialog, servers.create],
] as const)('requires an explicit environment and saves the selected preset for a %s', async (_resource, Dialog, create) => {
  const user = userEvent.setup();
  render(<Dialog open onOpenChange={close} projectId="project" />);
  const environment = screen.getByRole('combobox', { name: '环境' });
  expect(environment.textContent).toContain('请选择环境');
  expect(screen.getByRole('button', { name: '添加' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '测试连接' })).toHaveProperty('disabled', true);
  environment.focus();
  await user.keyboard('{ArrowDown}');
  for (const label of ['开发', '测试', '生产', '自定义']) {
    expect(await screen.findByRole('option', { name: label })).toBeTruthy();
  }
  await user.click(screen.getByRole('option', { name: '生产' }));
  expect(environment.textContent).toContain('生产');
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  expect(create).toHaveBeenCalledExactlyOnceWith('project', expect.objectContaining({ env: 'prod' }));
});

it('shows and preserves a previously saved custom environment', () => {
  const db: DatabaseView = {
    id: 'old-db', projectId: 'project', env: 'UAT', label: 'Archive', aliases: [], vendor: 'postgres',
    host: 'archive.example', port: 5432, database: 'archive', schema: null, username: 'fixture',
    hasPassword: false, accessLevel: 'readonly', isDefault: false, note: '', lastTest: null,
  };
  render(<DatabaseDialog open onOpenChange={close} projectId="project" db={db} />);
  expect(screen.getByRole('combobox', { name: '环境' }).textContent).toContain('自定义');
  expect(screen.getByLabelText('自定义环境')).toHaveProperty('value', 'UAT');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(databases.update).toHaveBeenCalledExactlyOnceWith('old-db', expect.objectContaining({ env: 'UAT' }));
});

it.each([
  ['dev', '开发'],
  ['UAT', '自定义'],
])('loads saved server environment %s and preserves it when editing', (env, label) => {
  const server: ServerView = {
    id: 'old-server', projectId: 'project', env, label: 'Fixture', aliases: ['fixture'],
    host: 'server.example', port: 22, username: 'fixture', authType: 'password',
    privateKeyPath: null, defaultRoot: false, sudoPolicy: 'none', appRoot: null, logsPath: null,
    note: '', hasPassword: true, hasPassphrase: false, hasSudoPassword: false, lastTest: null,
  };
  render(<ServerDialog open onOpenChange={close} projectId="project" server={server} />);
  expect(within(screen.getByRole('combobox', { name: '环境' })).getByText(label)).toBeTruthy();
  if (label === '自定义') expect(screen.getByLabelText('自定义环境')).toHaveProperty('value', env);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(servers.update).toHaveBeenCalledExactlyOnceWith('old-server', expect.objectContaining({
    env, aliases: ['fixture'], password: undefined,
  }));
});
