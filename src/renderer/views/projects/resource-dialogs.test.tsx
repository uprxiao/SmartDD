// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseView } from '@shared/projects';
import '@renderer/lib/i18n';
import { DatabaseDialog } from './resource-dialogs';

const { create, update, close } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), close: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { databases: { create, update } } }));
vi.mock('@renderer/core/navigation', () => ({ navigation: {} }));
vi.mock('@renderer/lib/hooks/useProjects', () => ({ useRefreshProjects: () => async () => {} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('requires an explicit environment and saves the selected preset', async () => {
  const user = userEvent.setup();
  render(<DatabaseDialog open onOpenChange={close} projectId="project" />);
  const environment = screen.getByRole('combobox', { name: '环境' });
  expect(environment.textContent).toContain('请选择环境');
  expect(screen.getByRole('button', { name: '添加' })).toHaveProperty('disabled', true);
  await user.click(environment);
  for (const label of ['开发', '测试', '生产', '自定义']) {
    expect(screen.getByRole('option', { name: label })).toBeTruthy();
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
  expect(update).toHaveBeenCalledExactlyOnceWith('old-db', expect.objectContaining({ env: 'UAT' }));
});
