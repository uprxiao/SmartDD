// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentModelPicker } from './agent-model-picker';
vi.mock('@renderer/core/navigation', () => ({ navigation: { openSettings: vi.fn() } }));
afterEach(cleanup);
const profiles = [{ profileId: 'a', name: 'Codex account', kind: 'codex', source: 'login', models: ['m1'], available: true, extensionSupport: 'partial' }, { profileId: 'b', name: 'Claude account', kind: 'claude', source: 'login', models: ['m2'], available: true }];
const open = () => fireEvent.click(screen.getByRole('button', { name: '选择智能体与模型' }));

it('a live goal disables all other profiles and leaves the current profile model selectable', () => {
  render(<AgentModelPicker profiles={profiles} profileId="a" locked onPick={() => {}} onExtensions={() => {}} />); open();
  expect((screen.getByRole('button', { name: 'Claude account' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'm1' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(/清除目标后才能切换；/)).toBeTruthy();
});

it('the rail uses each profile extension preference and picks the target profile/model', async () => {
  const choose = vi.fn(), extensions = vi.fn();
  render(<AgentModelPicker profiles={profiles} profileId="a" extensions={{ a: true, b: false }} onPick={choose} onExtensions={extensions} />); open();
  fireEvent.click(screen.getByRole('button', { name: 'Claude account' }));
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('switch')); expect(extensions).toHaveBeenCalledWith('b', true);
  fireEvent.click(screen.getByRole('button', { name: 'm2' })); await waitFor(() => expect(choose).toHaveBeenCalledWith('b', 'm2'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('a rejected selection keeps the menu open; IME composition does not trigger model shortcuts', async () => {
  const choose = vi.fn(() => false);
  render(<AgentModelPicker profiles={profiles} profileId="a" onPick={choose} onExtensions={() => {}} />); open();
  fireEvent.keyDown(document, { key: '1', metaKey: true, isComposing: true }); expect(choose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'm1' })); await waitFor(() => expect(choose).toHaveBeenCalled());
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('reasoning controls exist only for the actual published model and keep the picker open', () => {
  const effort = vi.fn();
  render(<AgentModelPicker profiles={profiles} profileId="a" model="m1" nativeModels={[{ id: 'm1', name: 'm1', efforts: ['low', 'high'] }]} onEffort={effort} onPick={() => {}} onExtensions={() => {}} />); open();
  fireEvent.click(screen.getByRole('button', { name: 'high' })); expect(effort).toHaveBeenCalledWith('high');
  expect(screen.getByRole('dialog')).toBeTruthy();
});
