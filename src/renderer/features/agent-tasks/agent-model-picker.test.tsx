// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentModelPicker } from './agent-model-picker';
import { providerModelOptions } from '@shared/agent-model-choice';
import type { ProviderView } from '@shared/ai-agents';
vi.mock('@renderer/core/navigation', () => ({ navigation: { openSettings: vi.fn() } }));
const catalog = vi.hoisted(() => vi.fn());
vi.mock('@renderer/lib/ipc', () => ({ rpc: { agentTasks: { modelCatalog: catalog } } }));
afterEach(cleanup);
function render(element: ReactElement) {
  return renderView(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{gcTime:0}}})}>{element}</QueryClientProvider>);
}
const profiles = [{ profileId: 'a', name: 'Codex account', kind: 'codex', source: 'login', models: ['m1'], available: true, extensionSupport: 'partial' }, { profileId: 'b', name: 'Claude account', kind: 'claude', source: 'login', models: ['m2'], available: true }];
const open = () => fireEvent.click(screen.getByRole('button', { name: '选择智能体与模型' }));

it('anchors the popup to the trigger using its rendered width', () => {
  let popupWidth = 480;
  const triggerRight = window.innerWidth - 60;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('agent-model-picker')) return new DOMRect(triggerRight - 180, 500, 180, 28);
    if (this.classList.contains('agent-picker')) return new DOMRect(0, 0, popupWidth, 340);
    return new DOMRect();
  });
  try {
    render(<AgentModelPicker profiles={profiles} profileId="a" onPick={() => {}} onExtensions={() => {}} />);
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.left).toBe(`${triggerRight - popupWidth}px`);
    popupWidth = 420;
    fireEvent(window, new Event('resize'));
    expect(dialog.style.left).toBe(`${triggerRight - popupWidth}px`);
  } finally {
    bounds.mockRestore();
  }
});

it('M16 A20/A52 places a schedule modal picker below a top anchor and above the modal overlay',()=>{
  const bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(this.classList.contains('agent-model-picker'))return new DOMRect(window.innerWidth-330,110,290,28);
    if(this.classList.contains('agent-picker'))return new DOMRect(0,0,480,380);
    return new DOMRect();
  });
  try{
    render(<AgentModelPicker profiles={profiles} profileId="a" modalOverlay onPick={()=>{}} onExtensions={()=>{}}/>);open();
    const dialog=screen.getByRole('dialog');
    expect(dialog.classList.contains('agent-picker-modal')).toBe(true);
    expect(dialog.style.top).toBe('148px');
    expect(dialog.style.bottom).toBe('');
    expect(Number.parseInt(dialog.style.maxHeight,10)).toBeLessThanOrEqual(window.innerHeight-148-12);
  }finally{bounds.mockRestore();}
});
it('M16 A52 keeps the ordinary bottom-anchored composer picker above the trigger',()=>{
  const y=window.innerHeight-45,bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(this.classList.contains('agent-model-picker'))return new DOMRect(300,y,180,28);
    if(this.classList.contains('agent-picker'))return new DOMRect(0,0,480,380);
    return new DOMRect();
  });
  try{
    render(<AgentModelPicker profiles={profiles} profileId="a" onPick={()=>{}} onExtensions={()=>{}}/>);open();
    const dialog=screen.getByRole('dialog');
    expect(dialog.classList.contains('agent-picker-modal')).toBe(false);
    expect(dialog.style.bottom).toBe('55px');
    expect(dialog.style.top).toBe('');
  }finally{bounds.mockRestore();}
});
it('M16 A52 bounds the picker to available height and repositions after a narrow form scrolls',()=>{
  const old=Object.getOwnPropertyDescriptor(window,'innerHeight');
  Object.defineProperty(window,'innerHeight',{configurable:true,value:420});
  let top=170;
  const bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(this.classList.contains('agent-model-picker'))return new DOMRect(300,top,180,28);
    if(this.classList.contains('agent-picker'))return new DOMRect(0,0,480,380);
    return new DOMRect();
  });
  try{
    render(<AgentModelPicker profiles={profiles} profileId="a" modalOverlay onPick={()=>{}} onExtensions={()=>{}}/>);open();
    const dialog=screen.getByRole('dialog');
    expect(dialog.style.top).toBe('208px');expect(dialog.style.maxHeight).toBe('200px');
    top=315;fireEvent(window,new Event('scroll'));
    expect(dialog.style.top).toBe('');expect(dialog.style.bottom).toBe('115px');expect(dialog.style.maxHeight).toBe('293px');
  }finally{
    bounds.mockRestore();
    if(old)Object.defineProperty(window,'innerHeight',old);else Reflect.deleteProperty(window,'innerHeight');
  }
});
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
  fireEvent.click(screen.getByRole('button', { name: 'm2' })); await waitFor(() => expect(choose).toHaveBeenCalledWith('b', 'm2', undefined));
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
  expect(choose).toHaveBeenNthCalledWith(1, 'a', 'm1', undefined);
  fireEvent.click(await screen.findByRole('button', { name: '高' }));
  await waitFor(() => expect(choose).toHaveBeenNthCalledWith(2, 'a', 'm1', 'high'));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('keeps the applied Antigravity effort in the collapsed task picker using its own probed catalog', async () => {
  const model = 'gemini-4-neon';
  const scope = { kind: 'task' as const, taskId: 'antigravity-catalog-effort' };
  const installed = [
    { profileId: 'ag', name: 'Antigravity·MH', kind: 'antigravity', source: 'provider', models: ['gemini-4-carbon', model],
      defaultModel: 'gemini-4-carbon', provider: { name: 'Model Hub', catalog: 'ultracloud' }, available: true },
    { profileId: 'another', name: 'Another Antigravity profile', kind: 'antigravity', source: 'provider', models: [model], defaultModel: model, available: true },
  ];
  catalog.mockImplementation(async (_scope, profileId) => ({ status: 'ready', models: [
    { id: model, name: model, efforts: profileId === 'ag' ? ['low', 'medium'] : ['high'], defaultEffort: profileId === 'ag' ? 'low' : 'high' },
  ] }));
  render(<AgentModelPicker profiles={installed} profileId="ag" model={model} effort="medium" scope={scope} onPick={() => {}} onExtensions={() => {}} />);
  open();
  expect((await screen.findByRole('button', { name: '中等' })).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Another Antigravity profile' }));
  await screen.findByRole('button', { name: '高' });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = screen.getByRole('button', { name: '选择智能体与模型' });
  expect(trigger.textContent).toBe('Antigravity·MH · gemini-4-neon · 中等');
  expect(trigger.querySelector('[data-agent-icon] > svg image')?.getAttribute('href')).toContain('antigravity.png');
  expect(trigger.querySelector('.m13-agent-badge image')?.getAttribute('href')).toContain('model-hub.svg');
});

it('uses the saved Codex subscription name in the collapsed picker even without a known effort', () => {
  const config = { ...profiles[0], name: '我的 Codex 订阅', codexSubscription: true };
  render(<AgentModelPicker profiles={[config]} profileId={config.profileId} onPick={() => {}} onExtensions={() => {}} />);
  expect(screen.getByRole('button', { name: '选择智能体与模型' }).textContent).toBe('我的 Codex 订阅 · 执行器默认');
});

it('reads the Claude catalog before opening a native session and applies the offered Opus alias and effort together', async () => {
  const choose = vi.fn();
  const local = { ...profiles[1], models: [], claudeSubscription: true };
  const scope = { kind: 'task' as const, taskId: 'preview-claude' };
  catalog.mockResolvedValue({status:'ready',models:[
    { id:'opus', resolvedId:'claude-opus-5-5', name:'Claude Opus 5.5', efforts:['low','medium','high'] },
    { id:'sonnet', resolvedId:'claude-sonnet-5-5', name:'Sonnet', efforts:['high'] },
  ]});
  render(<AgentModelPicker profiles={[profiles[0], local]} profileId="a" scope={scope} onPick={choose} onExtensions={() => {}} />);
  open();
  fireEvent.click(screen.getByRole('button', {name:local.name}));
  const opus = await screen.findByRole('button', { name:'Claude Opus 5.5' });
  expect(opus.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name:'中等' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', {name:'Sonnet'})).toBeTruthy();
  expect(catalog).toHaveBeenCalledWith(scope, 'b');
  expect(choose).not.toHaveBeenCalled();
  fireEvent.click(opus);
  await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith('b','opus','medium'));
});

it('dismisses the task picker as soon as a different executor is chosen', async () => {
  let complete!: (result: boolean) => void;
  const onPick = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  render(<AgentModelPicker profiles={profiles} profileId="a" scope={{ kind: 'task', taskId: 'switch-while-closing' }} onPick={onPick} onExtensions={() => {}} />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Claude account' }));
  fireEvent.click(screen.getByRole('button', { name: 'm2' }));
  expect(onPick).toHaveBeenCalledWith('b', 'm2', undefined);
  expect(screen.queryByRole('dialog', { name: '选择智能体与模型' })).toBeNull();
  await act(async () => complete(true));
});

it('leaves Claude on executor default when the current catalog excludes medium on Opus', async () => {
  const local = { ...profiles[1], models: [], claudeSubscription:true };
  catalog.mockResolvedValue({status:'ready',models:[
    {id:'opus', resolvedId:'claude-opus-5-5', name:'Opus', efforts:['high']},
    {id:'sonnet', name:'Sonnet', efforts:['medium']},
  ]});
  render(<AgentModelPicker profiles={[profiles[0], local]} profileId="a" scope={{kind:'task',taskId:'restricted-claude'}} onPick={() => {}} onExtensions={() => {}} />);
  open();
  fireEvent.click(screen.getByRole('button', {name:local.name}));
  await screen.findByText(/Claude.*目录.*中等.*执行器默认/);
  expect(screen.getByRole('button', {name:'执行器默认'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button',{name:'中等'})).toBeNull();
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
    expect(screen.getByRole('button', { name: effort === 'medium' ? '中等' : effort === 'high' ? '高' : '默认' }).getAttribute('aria-pressed')).toBe('true');
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: model }));
    await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith('a', saved?.model === null ? null : 'gpt-6.2-sol', saved ? undefined : effort));
  },
);

it('shows the official DeepSeek Claude levels before a session starts', async () => {
  const model = 'deepseek-flash';
  const provider: ProviderView = {
    id: 'ds', name: 'DeepSeek', preset: 'deepseek', endpoints: { anthropic: 'https://api.deepseek.com/anthropic' },
    authType: 'bearer', hasKey: true, identityRevision: 1, recommended: {}, refreshedAt: null,
    models: [{ id: model, name: model, contextWindow: null, offline: false, availability: { claude: 'available', codex: 'available' } }],
  };
  const config = { profileId: 'ds-claude', name: 'Claude Code · DeepSeek', kind: 'claude', source: 'provider', models: [model], defaultModel: model, available: true };
  const pick = vi.fn();
  render(<AgentModelPicker profiles={[{ ...config, modelOptions: providerModelOptions(provider, config) }]} profileId={config.profileId} onPick={pick} onExtensions={() => {}} />);
  open();
  expect(screen.getByRole('button', { name: '默认（高）' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '低' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '高' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '中等' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '最高' }));
  await waitFor(() => expect(pick).toHaveBeenCalledWith(config.profileId, null, 'max'));
});

it('reserves the Model Hub Claude choices for its declared route and leaves its unspecified default to the supplier', () => {
  const config = {
    profileId: 'hub-claude', name: 'Claude Code · Model Hub', kind: 'claude', source: 'provider', available: true,
    models: ['known', 'unverified'], defaultModel: 'known',
    modelOptions: [{ id: 'known', name: 'Known', efforts: ['low', 'medium'] }],
  };
  const nativeModels = config.models.map(id => ({ id, name: id, efforts: ['max'], defaultEffort: 'max' }));
  const pick = vi.fn();
  render(<AgentModelPicker profiles={[config]} profileId={config.profileId} nativeModels={nativeModels} onPick={pick} onExtensions={() => {}} />);
  open();
  expect(screen.getByRole('button', { name: '默认' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '中等' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '最高' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'unverified' }));
  expect(pick).toHaveBeenCalledWith(config.profileId, 'unverified', undefined);
});

it('shows the bound provider with the executor and offers only the selected model’s reasoning levels', () => {
  const providerProfiles = [...profiles, {
    profileId: 'gateway', kind: 'codex', source: 'provider', available: true, name: '我的工作配置',
    provider: { name: 'Model Hub', catalog: 'ultracloud' }, models: ['gpt-6.1-sol', 'other'],
    modelOptions: [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' }],
  }];
  render(<AgentModelPicker profiles={providerProfiles} profileId="gateway" model="gpt-6.1-sol" effort="none" onPick={() => {}} onExtensions={() => {}} />);
  const trigger = screen.getByRole('button', { name: '选择智能体与模型' });
  expect(trigger.textContent).toBe('我的工作配置 · gpt-6.1-sol · 中等');
  expect(trigger.querySelector('.m13-agent-badge image')?.getAttribute('href')).toContain('model-hub');
  open();
  expect(screen.getByRole('button', { name: '我的工作配置 · Codex · Model Hub' }).querySelector('.m13-agent-badge')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Codex account' }).querySelector('.m13-agent-badge')).toBeNull();
  expect(screen.getByRole('button', { name: '默认（中等）' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'none' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'ultra' })).toBeNull();
});
