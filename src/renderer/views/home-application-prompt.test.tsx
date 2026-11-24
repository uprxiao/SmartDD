// @vitest-environment jsdom
import {act,cleanup,fireEvent,render as renderView,screen,waitFor} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {HomeView} from './home-view';
import {navigation} from '@renderer/core/navigation';
const m=vi.hoisted(()=>({update:vi.fn(),subscribed:false,projects:[{id:'p1',name:'Original project'}],profiles:[{id:'profile',name:'Private profile',runner:'codex',isDefault:true}] as {id:string;name:string;runner:string;isDefault:boolean;checking?:boolean;check?:{status:string}|null}[],draft:{projectId:'p1',dirId:'dir1',aiProfileId:'profile'},project:{id:'p1',name:'Original project',dirs:[{id:'dir1',path:'/private/fixture',label:'Fixture',isDefault:true,status:{available:true}}]}}));
const agent=vi.hoisted(()=>({store:{refresh:vi.fn()},create:vi.fn(),submit:vi.fn(),modelCatalog:vi.fn(),homeSkillCatalog:vi.fn(),prepareAttachment:vi.fn(),claudeLogin:null as 'local' | 'api' | null}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@renderer/lib/hooks/useProjects',()=>({useProjectList:()=>({data:m.projects}),useProject:()=>({data:m.project})}));
vi.mock('@renderer/lib/hooks/useAgents',()=>({useAgents:()=>({data:{configs:m.profiles.map(p=>({...p,kind:p.runner,toolId:p.runner,source:'login',providerId:null,models:[],defaultModel:null,homeVisible:true,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null})),providers:[],tools:[...(m.subscribed?[{id:"codex",login:"subscription"}]:[]),...(agent.claudeLogin?[{id:"claude",login:agent.claudeLogin}]:[])]}})}));
vi.mock('@renderer/lib/hooks/useAppSettingsKey',()=>({useAppSettingsKey:(key:string)=>({value:key==='agentPermissions'?{selected:'ask',fullConfirmed:false}:m.draft,update:m.update})}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:agent.store}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{agentTasks:agent}}));
vi.mock('./voice-controls',()=>({VoiceButton:()=>null}));
vi.mock('./capabilities',()=>({CapabilityLaunchPreview:()=>null}));
vi.mock('./projects/project-dialogs',()=>({ProjectDialog:()=>null}));
vi.mock('@renderer/lib/profile-health',()=>({ProfileHealthMark:()=>null}));
function render(element: React.ReactElement) {
  const client = new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}});
  return renderView(element, {wrapper: ({children}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>});
}
beforeEach(()=>{vi.clearAllMocks();m.subscribed=false;agent.modelCatalog.mockResolvedValue({status:"loading",models:[]});navigation.homeInputDrafts.clear();navigation.homePreset=null;navigation.pluginPromptRequest=null;navigation.currentProjectId=null;navigation.currentViewId='home';m.projects.splice(0,m.projects.length,{id:'p1',name:'Original project'});m.profiles=[{id:'profile',name:'Private profile',runner:'codex',isDefault:true}];m.draft.aiProfileId='profile';});
afterEach(()=>{cleanup();localStorage.removeItem('willyou-m14-home-selection');agent.create.mockReset();agent.submit.mockReset();agent.claudeLogin=null;});
it('combines selected executor Skills and WillYou-managed Skills before the first message', async () => {
  agent.homeSkillCatalog.mockResolvedValue({
    managed: [{ name: 'source-driven-ui-test' }],
    native: [{ name: 'source-driven-ui-test' }, { name: 'format-doc' }],
  });
  render(<HomeView />);
  const input = screen.getByTestId('home-input');
  fireEvent.change(input, { target: { value: '$' } });
  expect(await screen.findByRole('option', { name: /format-doc.*执行器/ })).toBeTruthy();
  expect(agent.homeSkillCatalog).toHaveBeenCalledWith('p1', 'dir1', 'profile', true);
  expect(screen.getAllByRole('option', { name: /source-driven-ui-test/ })).toHaveLength(1);
  fireEvent.change(input, { target: { value: '$source' } });
  expect(screen.queryByRole('option', { name: /format-doc/ })).toBeNull();
  expect(screen.getByRole('option', { name: /source-driven-ui-test/ })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveProperty('value', '$source-driven-ui-test ');
  expect(agent.create).not.toHaveBeenCalled();
});

it('opens the attachment picker from + and passes the chosen file to the first message', async () => {
  const file = new File(['fixture'], 'notes.txt', { type: 'text/plain' });
  const attachment = { id: 'attachment', kind: 'path', name: file.name, relativePath: file.name, image: false };
  agent.prepareAttachment.mockResolvedValue(attachment);
  agent.create.mockResolvedValue({ taskId: 'attached-task' });
  agent.submit.mockResolvedValue({});
  vi.stubGlobal('electronAPI', { pathForFile: () => '/private/fixture/notes.txt' });
  const openPicker = vi.spyOn(HTMLInputElement.prototype, 'click');
  try {
    const { container } = render(<HomeView />);
    fireEvent.click(screen.getByRole('button', { name: 'm6.addContext' }));
    const addAttachment = await screen.findByRole('menuitem', { name: 'home.addAttachments' });
    expect(screen.getAllByRole('menuitem')).toEqual([addAttachment]);
    fireEvent.click(addAttachment);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(openPicker).toHaveBeenCalledOnce();
    expect(openPicker.mock.contexts[0]).toBe(picker);
    expect(picker.multiple).toBe(true);
    fireEvent.change(picker, { target: { files: [file] } });
    await screen.findByRole('button', { name: '移除 ' + file.name });
    expect(agent.create).not.toHaveBeenCalled();
    expect(agent.prepareAttachment).toHaveBeenCalledWith(null, '/private/fixture', {
      name: file.name, mime: 'text/plain', sourcePath: '/private/fixture/notes.txt',
    });
    fireEvent.change(screen.getByTestId('home-input'), { target: { value: '请读附件' } });
    fireEvent.click(screen.getByTestId('home-launch'));
    await waitFor(() => expect(agent.submit).toHaveBeenCalledWith('attached-task',
      expect.objectContaining({ text: '请读附件', attachments: [attachment] })));
  } finally {
    openPicker.mockRestore();
    vi.unstubAllGlobals();
  }
});

describe('application example handoff to the real home composer',()=>{
 it.each([false,true])('M13 appends one exact plugin example without submitting, Home already mounted=%s',async alreadyMounted=>{
  navigation.setHomeInput('p1','unsent prefix');let view:ReturnType<typeof render>;
  if(alreadyMounted){view=render(<HomeView/>);await waitFor(()=>expect(screen.getByTestId('home-input')).toHaveProperty('value','unsent prefix'));}
  act(()=>navigation.preparePluginTask('  exact plugin example\nsecond line'));
  if(!alreadyMounted)view=render(<HomeView/>);
  await waitFor(()=>expect(screen.getByTestId('home-input')).toHaveProperty('value','unsent prefix\n  exact plugin example\nsecond line'));
  expect(navigation.pluginPromptRequest).toBeNull();expect(agent.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
  view!.rerender(<HomeView/>);expect(screen.getByTestId('home-input')).toHaveProperty('value','unsent prefix\n  exact plugin example\nsecond line');
 });
 it('preserves unsent input across actual composer unmount and appends a later summary once',async()=>{
  const view=render(<HomeView/>);const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'unsubmitted original text'}});view.unmount();
  act(()=>navigation.prepareApplicationTask('p1','selected summary\n  exact second line'));render(<HomeView/>);const restored=await screen.findByTestId('home-input');
  await waitFor(()=>expect(restored).toHaveProperty('value','unsubmitted original text\nselected summary\n  exact second line'));expect(agent.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
 });
 it('keeps separate projects unsent input isolated across summary navigation and clears a deleted projects draft',async()=>{
  m.projects.push({id:'p2',name:'Second project'});const view=render(<HomeView/>);const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'project A private unsent'}});view.unmount();
  act(()=>navigation.prepareApplicationTask('p2','project B selected summary'));const second=render(<HomeView/>);const b=await screen.findByTestId('home-input');await waitFor(()=>expect(b).toHaveProperty('value','project B selected summary'));second.unmount();
  act(()=>navigation.newTask('p1'));render(<HomeView/>);await waitFor(()=>expect(screen.getByTestId('home-input')).toHaveProperty('value','project A private unsent'));expect(navigation.homeInput('p2')).toBe('project B selected summary');act(()=>navigation.closeProject('p2'));expect(navigation.homeInput('p2')).toBe('');expect(agent.create).not.toHaveBeenCalled();
 });
 it('appends an explicit example to existing editable input,focuses it,and starts no task',async()=>{render(<HomeView/>);const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'existing-prefix'}});act(()=>navigation.prepareApplicationTask('p1','approved example'));await waitFor(()=>expect(input).toHaveProperty('value','existing-prefix\napproved example'));expect(document.activeElement).toBe(input);expect(navigation.homePreset?.applicationPrompt).toBeUndefined();expect(agent.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
 it('consumes one handoff once across rerenders while preserving later user edits',async()=>{act(()=>navigation.prepareApplicationTask('p1','first example'));const view=render(<HomeView/>);const input=await screen.findByTestId('home-input');await waitFor(()=>expect(input).toHaveProperty('value','first example'));fireEvent.change(input,{target:{value:'first example plus user words'}});view.rerender(<HomeView/>);expect(input).toHaveProperty('value','first example plus user words');expect(agent.create).not.toHaveBeenCalled();});
 it('does not apply a missing project handoff to the existing project or launch a task',async()=>{act(()=>navigation.prepareApplicationTask('deleted-project','foreign example'));render(<HomeView/>);const input=await screen.findByTestId('home-input');expect(input).toHaveProperty('value','');expect(agent.create).not.toHaveBeenCalled();expect(navigation.homePreset?.applicationPrompt).toBe('foreign example');});
 it('blocks duplicate launch while the new task is being created and keeps the draft on rejection',async()=>{
  let reject!: (error:Error)=>void;
  agent.create.mockImplementationOnce(()=>new Promise((_,failure)=>{reject=failure;}));
  render(<HomeView/>);const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'preserve this input'}});
  const button=screen.getByTestId('home-launch');await waitFor(()=>expect(button).toHaveProperty('disabled',false));fireEvent.click(button);
  await waitFor(()=>expect(button).toHaveProperty('disabled',true));
  fireEvent.keyDown(input,{key:'Enter'});expect(agent.create).toHaveBeenCalledTimes(1);
  await act(async()=>reject(new Error('启动失败')));
  await waitFor(()=>expect(button).toHaveProperty('disabled',false));
  expect(input).toHaveProperty('value','preserve this input');expect(m.update).not.toHaveBeenCalled();
 });

});
describe('home composer profile default',()=>{
 const launchWith=async()=>{const button=screen.getByTestId('home-launch');await waitFor(()=>expect(button).toHaveProperty('disabled',false));fireEvent.click(button);await waitFor(()=>expect(agent.create).toHaveBeenCalled());return agent.create.mock.calls.at(-1)![0].profileId;};
 it('launches with the usable default even when the last task used another profile',async()=>{
  m.profiles.splice(0,m.profiles.length,{id:'cc-work',name:'CC-work',runner:'claude',isDefault:false,check:{status:'ok'}},{id:'codex',name:'Codex',runner:'codex',isDefault:true,check:{status:'ok'}});m.draft.aiProfileId='cc-work';agent.create.mockResolvedValue({taskId:'test-task'});
  render(<HomeView/>);await screen.findByTestId('home-input');expect(await launchWith()).toBe('codex');
 });
 it('keeps the selected available default on an authentication/preflight failure instead of silently switching accounts (M13 R1.0)',async()=>{
  m.profiles.splice(0,m.profiles.length,{id:'cc-work',name:'CC-work',runner:'claude',isDefault:false,check:{status:'ok'}},{id:'codex',name:'Codex',runner:'codex',isDefault:true,checking:true,check:null});m.draft.aiProfileId='cc-work';agent.create.mockResolvedValue({taskId:'test-task'});
  render(<HomeView/>);const input=await screen.findByTestId('home-input');
  m.profiles=[m.profiles[0],{id:'codex',name:'Codex',runner:'codex',isDefault:true,checking:false,check:{status:'failed'}}];fireEvent.change(input,{target:{value:'re-render after the health result'}});
  agent.create.mockRejectedValueOnce(new Error('供应商 Key 失效，请填写后再启动'));
  expect(await launchWith()).toBe('codex');
  await waitFor(()=>expect(screen.getByTestId('home-error').textContent).toContain('Key 失效'));
  expect(agent.create).toHaveBeenCalledTimes(1);
 });
});
describe('home composer Enter key',()=>{
 const ready=async()=>{const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'检查禅道'}});await waitFor(()=>expect(screen.getByTestId('home-launch')).toHaveProperty('disabled',false));return input;};
 it('sends on Enter and on Cmd+Enter',async()=>{
  agent.create.mockResolvedValue({taskId:'test-task'});render(<HomeView/>);const input=await ready();
  fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(agent.create).toHaveBeenCalledTimes(1));
  fireEvent.change(input,{target:{value:'第二条'}});fireEvent.keyDown(input,{key:'Enter',metaKey:true});await waitFor(()=>expect(agent.create).toHaveBeenCalledTimes(2));
 });
 it('keeps Shift+Enter and an input-method confirmation for editing',async()=>{
  render(<HomeView/>);const input=await ready();
  expect(fireEvent.keyDown(input,{key:'Enter',shiftKey:true})).toBe(true);
  expect(fireEvent.keyDown(input,{key:'Enter',isComposing:true})).toBe(true);
  expect(fireEvent.keyDown(input,{key:'Enter',keyCode:229})).toBe(true);
  await new Promise(r=>setTimeout(r,50));expect(agent.create).not.toHaveBeenCalled();
 });
});

describe('M14-A43 home first send',()=>{
  async function prepareHome() {
    render(<HomeView/>);
    const input=await screen.findByTestId('home-input');
    fireEvent.change(input,{target:{value:'first outgoing message'}});
    const launch=screen.getByTestId('home-launch');
    await waitFor(()=>expect(launch).toHaveProperty('disabled',false));
    return {input,launch};
  }

  it.each(['implicit', 'cold catalog', 'missing medium', 'unavailable', 'high', 'executor default', 'API'] as const)('launches Claude with the catalog-backed model for %s', async choice => {
    agent.claudeLogin = choice === 'API' ? 'api' : 'local';
    m.profiles = [{ id:'profile', name:'Claude Code · 本机登录', runner:'claude', isDefault:true }];
    agent.create.mockResolvedValue({taskId:'claude-task'});
    agent.submit.mockResolvedValue({turnId:'accepted'});
    const models = [{id:'opus', resolvedId:'claude-opus-5-5', name:'Claude Opus 5.5', efforts:choice === 'missing medium' ? ['high'] : ['medium','high']}];
    agent.modelCatalog.mockImplementation(async (_scope, _profile, mode) => {
      if (choice === 'unavailable') return {status:'unavailable',models:[]};
      if (choice === 'cold catalog' && mode !== 'wait') return {status:'loading',models:[]};
      return {status:'ready',models};
    });
    const {launch} = await prepareHome();
    if (choice === 'executor default' || choice === 'high') {
      fireEvent.click(screen.getByRole('button', {name:'选择智能体与模型'}));
      fireEvent.click(await screen.findByRole('button', {name:choice === 'high' ? '高' : '执行器默认'}));
    }
    fireEvent.click(launch);
    await waitFor(() => expect(agent.submit).toHaveBeenCalled());
    expect(agent.create.mock.calls[0][0]).toMatchObject(choice === 'implicit' || choice === 'cold catalog' || choice === 'high'
      ? {model:'opus',effort:choice === 'high' ? 'high' : 'medium'}
      : {model:undefined,effort:undefined});
    if (choice === 'cold catalog') expect(agent.modelCatalog).toHaveBeenCalledWith(expect.anything(),'profile','wait');
    if (choice === 'API') expect(agent.modelCatalog).not.toHaveBeenCalled();
  });

  it('persists and opens the first subscription message while discovery has no response', async () => {
    m.subscribed = true;
    agent.modelCatalog.mockImplementation(() => new Promise(() => {}));
    agent.create.mockResolvedValue({taskId:'cold-catalog-task'});
    agent.submit.mockResolvedValue({turnId:'accepted'});
    const {launch} = await prepareHome();
    fireEvent.click(launch);
    await waitFor(() => expect(agent.submit).toHaveBeenCalled());
    expect(agent.create.mock.calls[0][0]).toMatchObject({model:'gpt-6.2-sol',effort:'medium',initialCodexDefault:true});
    expect(navigation.currentViewId).toBe('agentTask');
    expect(agent.modelCatalog.mock.calls.some(args => args[2] === 'wait')).toBe(false);
  });

  it.each(['create','submit'] as const)('reuses the intent when the %s acknowledgement was lost', async phase=>{
    const {launch}=await prepareHome();
    agent.create.mockImplementation(async req=>({taskId:req.clientTaskId??'created-'+agent.create.mock.calls.length}));
    agent.submit.mockResolvedValue({turnId:'accepted'});
    agent[phase].mockRejectedValueOnce(new Error('acknowledgement lost'));
    fireEvent.click(launch);
    await waitFor(()=>expect(screen.getByTestId('home-error').textContent).toContain('acknowledgement lost'));
    fireEvent.click(launch);
    await waitFor(()=>expect(navigation.currentViewId).toBe('agentTask'));
    const [original,retry]=agent.create.mock.calls.map(([input])=>input.clientTaskId);
    expect(original).toMatch(/^[a-f0-9-]{36}$/);
    expect(retry).toBe(original);
    expect(agent.submit.mock.calls.every(([taskId])=>taskId===original)).toBe(true);
    if(phase==='submit') expect(agent.submit.mock.calls[1][1].clientInputId).toBe(agent.submit.mock.calls[0][1].clientInputId);
  });

  it.each([false,true])('keeps newer input when the first turn acknowledgement arrives, after navigation=%s',async switchTask=>{
    const {input,launch}=await prepareHome();
    agent.create.mockResolvedValue({taskId:'first-task'});
    let acknowledge!:()=>void;
    agent.submit.mockImplementation(()=>new Promise<void>(resolve=>{acknowledge=resolve;}));
    fireEvent.click(launch);
    await waitFor(()=>expect(agent.submit).toHaveBeenCalledTimes(1));
    fireEvent.change(input,{target:{value:'new unsent edit'}});
    if(switchTask)act(()=>navigation.openAgentTask('another-task'));
    await act(async()=>acknowledge());
    expect(navigation.homeInput('p1')).toBe('new unsent edit');
    expect(navigation.currentViewId).toBe(switchTask?'agentTask':'home');
    if(switchTask)expect(navigation.currentAgentTaskId).toBe('another-task');
  });
});

