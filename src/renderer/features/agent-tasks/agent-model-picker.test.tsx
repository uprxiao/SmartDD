// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentModelPicker } from './agent-model-picker';
vi.mock('@renderer/core/navigation', () => ({ navigation: { openSettings: vi.fn() } }));
const catalog = vi.hoisted(() => vi.fn());
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: { modelCatalog: catalog } } }));
afterEach(cleanup);
function render(element: ReactElement) {
  return renderView(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{gcTime:0}}})}>{element}</QueryClientProvider>);
}
const profiles = [{ profileId: 'a', name: 'Codex account', kind: 'codex', source: 'login', models: ['m1'], available: true, extensionSupport: 'partial' }, { profileId: 'b', name: 'Claude account', kind: 'claude', source: 'login', models: ['m2'], available: true }];
const open = () => fireEvent.click(screen.getByRole('button', { name: '选择智能体与模型' }));

it('distinguishes loading and failure, retries and reveals reasoning for the native default', async () => {
  const scope = { kind: 'task' as const, taskId: 't' };
  const loading = { status: 'loading', models: [] };
  const ready = { status: 'ready', models: [{ id:'sol', name:'GPT-6.2 Sol', isDefault:true, efforts:['medium','high'] }] };
  catalog.mockResolvedValueOnce(loading).mockResolvedValueOnce({status:'unavailable',models:[]}).mockResolvedValue(ready);
  render(<AgentModelPicker profiles={profiles} profileId="a" scope={scope} onPick={() => {}} onExtensions={() => {}} />);
  open();
  expect(await screen.findByText('正在读取模型目录…')).toBeTruthy();
  expect(screen.queryByText('执行器尚未公布可用选项')).toBeNull();
  fireEvent.click(await screen.findByRole('button', {name:'重新读取'}));
  expect(await screen.findByRole('button', {name:'GPT-6.2 Sol'})).toBeTruthy();
  expect(screen.getByRole('button', {name:'中等'})).toBeTruthy();
  expect(catalog).toHaveBeenCalledWith(scope,'a','retry');
  open(); open();
  expect(screen.getByRole('button', {name:'GPT-6.2 Sol'})).toBeTruthy();
});

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
  fireEvent.click(screen.getByRole('button', { name: 'm2' })); await waitFor(() => expect(choose).toHaveBeenCalledWith('b', 'm2', null));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('a rejected selection keeps the menu open; IME composition does not trigger model shortcuts', async () => {
  const choose = vi.fn(() => false);
  render(<AgentModelPicker profiles={profiles} profileId="a" onPick={choose} onExtensions={() => {}} />); open();
  fireEvent.keyDown(document, { key: '1', metaKey: true, isComposing: true }); expect(choose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'm1' })); await waitFor(() => expect(choose).toHaveBeenCalled());
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('keeps the model menu open to save model and reasoning together', async () => {
  const choose = vi.fn();
  render(<AgentModelPicker profiles={profiles} profileId="a" nativeModels={[{ id: 'm1', name: 'm1', efforts: ['low', 'high'], defaultEffort:'low' }]} onPick={choose} onExtensions={() => {}} />); open();
  fireEvent.click(screen.getByRole('button', { name: 'm1' }));
  expect(choose).toHaveBeenNthCalledWith(1, 'a', 'm1', 'low');
  fireEvent.click(await screen.findByRole('button', { name: 'high' }));
  await waitFor(() => expect(choose).toHaveBeenNthCalledWith(2, 'a', 'm1', 'high'));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it.each([undefined, { model: 'gpt-6.2-sol', effort: 'high' }, { model: null, effort: null }])(
  'previews the subscription model and effort when switching from Claude (%j)', async (saved) => {
    const choose = vi.fn();
    const subscriptionProfiles = [{ ...profiles[0], codexSubscription: true }, profiles[1]];
    catalog.mockResolvedValue({ status: 'refreshing', models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'low' }] });
    render(<AgentModelPicker profiles={subscriptionProfiles} profileId="b" scope={{ kind: 'task', taskId: 'from-claude' }}
      profileChoices={saved ? { a: saved } : undefined} onPick={choose} onExtensions={() => {}} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Codex account' }));
    await screen.findByRole('button', { name: 'GPT-6.2-Sol' });
    const model = saved?.model === null ? '执行器默认' : 'GPT-6.2-Sol';
    const effort = saved ? saved.effort ?? null : 'medium';
    expect(screen.getByRole('button', { name: model }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: effort === 'medium' ? '中等' : effort ?? '默认' }).getAttribute('aria-pressed')).toBe('true');
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: model }));
    await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith('a', saved?.model === null ? null : 'gpt-6.2-sol', effort));
  },
);
