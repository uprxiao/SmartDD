// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import type { AgentImportPreview } from '@shared/agent-transfer';
import { AgentEditor } from './agent-editor';
import { AgentExportDialog, AgentImportDialog } from './transfer-dialogs';
const api=vi.hoisted(()=>({save:vi.fn<(...args:any[])=>Promise<any>>(),check:vi.fn<(...args:any[])=>Promise<any>>(),saveProvider:vi.fn(),export:vi.fn<(...args:any[])=>Promise<any>>(),choose:vi.fn<(...args:any[])=>Promise<any>>(),unlock:vi.fn<(...args:any[])=>Promise<any>>(),commit:vi.fn<(...args:any[])=>Promise<any>>(),dispose:vi.fn<(...args:any[])=>Promise<any>>() }));
vi.mock('@renderer/lib/ipc',()=>({rpc:{agents:{save:api.save,checkProviderModel:api.check,saveProvider:api.saveProvider},agentTransfer:{export:api.export,chooseImport:api.choose,unlock:api.unlock,commit:api.commit,dispose:api.dispose}},events:{on:()=>()=>{}}}));
beforeEach(()=>{vi.clearAllMocks();api.save.mockResolvedValue({});api.check.mockResolvedValue({});api.export.mockResolvedValue({ok:true,value:{path:'/synthetic/export.json'}});api.choose.mockResolvedValue({ok:true,value:null});api.unlock.mockResolvedValue({ok:false,message:'口令不正确'});api.commit.mockResolvedValue({ok:true,value:{providerIds:['new-p'],agentIds:['new-a'],skipped:[]}});api.dispose.mockResolvedValue(undefined);});
afterEach(()=>cleanup());
function tool(kind:'claude'|'codex',login:CodeAgentTool['login']='none'):CodeAgentTool{return {id:kind,kind,executable:'/synthetic/bin/'+kind,version:kind==='claude'?'2.1.322':'0.167.1',installed:true,login};}
function provider(changes:Partial<ProviderView>={}):ProviderView{return {id:'p',name:'Private Provider',preset:null,endpoints:{responses:'https://synthetic.example.invalid/v1',anthropic:'https://synthetic.example.invalid/anthropic'},authType:'bearer',hasKey:true,identityRevision:1,models:[{id:'a',name:'Model A',contextWindow:128000,offline:false,availability:{claude:'available',codex:'available'}},{id:'b',name:'Model B',contextWindow:null,offline:false,availability:{claude:'untested',codex:'untested'}},{id:'bad',name:'Unavailable Model',contextWindow:null,offline:false,availability:{claude:'unavailable',codex:'unavailable'}},{id:'gone',name:'Offline Model',contextWindow:null,offline:true,availability:{claude:'available',codex:'available'}}],recommended:{claude:'a',codex:'a'},refreshedAt:1,...changes};}
function config(changes:Partial<RunConfigView>={}):RunConfigView{return {id:'c',name:'My Agent',toolId:'claude',kind:'claude',source:'provider',providerId:'p',models:['a','b'],defaultModel:'b',homeVisible:true,isDefault:false,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null,...changes};}
function callbacks(){return {onClose:vi.fn(),onSaved:vi.fn(),onEditExisting:vi.fn(),onAddProvider:vi.fn(),onToolPath:vi.fn(),onRedetect:vi.fn(),onRefresh:vi.fn(async()=>{})};}
function edit(extra:Partial<Parameters<typeof AgentEditor>[0]>={}){const props={configs:[] as RunConfigView[],providers:[provider()],tools:[tool('claude'),tool('codex')],...callbacks(),...extra};return {props,...render(<AgentEditor {...props}/>)};}
const modelRow=(id:string)=>document.querySelector(`[data-model="${id}"]`)! as HTMLElement;
const createButton=()=>screen.getByRole('button',{name:'创建'});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const preview=(changes:Partial<AgentImportPreview>={}):AgentImportPreview=>({token:'token-new',encrypted:false,providers:[{ref:'p',name:'X',finalName:'X（导入）',needsKey:true,endpoints:{responses:'https://synthetic.example.invalid/v1'}}],agents:[{ref:'c',name:'Agent X',finalName:'Agent X（导入）',kind:'codex',source:'provider',toolInstalled:true}],skipped:[],...changes});

it('explains the native plugin restriction only for a Codex Provider selection',()=>{
 edit({tools:[tool('codex','subscription'),tool('claude','subscription')],initial:config({toolId:'codex',kind:'codex'})});
 expect(screen.getByText('第三方 Provider 下 Codex 原生插件不可用')).toBeTruthy();
 expect(screen.getByText(/插件自带的 Skill／MCP 可在“技能”页发现并纳管/)).toBeTruthy();
 cleanup();edit({initial:config()});expect(screen.queryByText('第三方 Provider 下 Codex 原生插件不可用')).toBeNull();
 cleanup();edit({tools:[tool('codex','subscription')],initial:config({toolId:'codex',kind:'codex',source:'login',providerId:null})});expect(screen.queryByText('第三方 Provider 下 Codex 原生插件不可用')).toBeNull();
});

it('supports normal Code Agent → Provider → multi-model/default/name flow and sends only the saved configuration',async()=>{
 const {props}=edit();expect(document.querySelectorAll('[data-step]')).toHaveLength(3);
 fireEvent.click(screen.getByRole('radio',{name:/^Codex/}));fireEvent.click(within(screen.getByRole('radiogroup',{name:'订阅或供应商'})).getByRole('radio',{name:/Private Provider/}));
 fireEvent.click(within(modelRow('b')).getByRole('checkbox'));fireEvent.click(within(modelRow('b')).getByRole('button',{name:'设为默认'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Chosen Codex'}});fireEvent.click(screen.getByRole('switch',{name:'在首页显示'}));fireEvent.click(createButton());
 await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1));expect(api.save.mock.calls[0]).toEqual([{name:'Chosen Codex',toolId:'codex',source:'provider',providerId:'p',models:['b','a'],defaultModel:'b',homeVisible:false,isDefault:false,nameCustomized:true},undefined]);await waitFor(()=>expect(props.onClose).toHaveBeenCalledOnce());expect(api.saveProvider).not.toHaveBeenCalled();
});
it('lists available+untested models but hides unavailable/offline models, and the last unchecked model prevents saving',()=>{
 edit();expect(within(screen.getByRole('group',{name:'模型'})).queryByText('Unavailable Model')).toBeNull();expect(screen.queryByText('Offline Model')).toBeNull();expect(screen.getByText('Model B')).toBeTruthy();
 fireEvent.click(within(modelRow('a')).getByRole('checkbox'));expect((createButton() as HTMLButtonElement).disabled).toBe(true);fireEvent.click(createButton());expect(api.save).not.toHaveBeenCalled();
});
it('default deselection falls back to the first still selected model',async()=>{
 edit({initial:config()});fireEvent.click(within(modelRow('b')).getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(api.save).toHaveBeenCalledOnce());expect(api.save.mock.calls[0][0]).toMatchObject({models:['a'],defaultModel:'a'});
});
it('refresh removes newly unusable selected/default models and never silently adds an unselected recommendation',async()=>{
 const {props,rerender}=edit({initial:config()});const fresh=provider();fresh.models=fresh.models.map(m=>m.id==='b'?{...m,availability:{claude:'unavailable',codex:'available'}}:m);fresh.recommended.claude='bad';rerender(<AgentEditor {...props} providers={[fresh]}/>);
 expect(screen.queryByText('Model B')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(api.save).toHaveBeenCalledOnce());expect(api.save.mock.calls[0][0]).toMatchObject({models:['a'],defaultModel:'a'});
});
it.each(['gone','bad','absent'])('new selection ignores unusable recommended %s and falls back to a usable model',recommended=>{
 const p=provider({recommended:{claude:recommended,codex:recommended}});edit({providers:[p]});expect((within(modelRow('a')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);expect((createButton() as HTMLButtonElement).disabled).toBe(false);
});
it('both existing login and Provider combinations direct to their existing editor without creating duplicates',()=>{
 const login=config({id:'login',name:'Existing Login',source:'login',providerId:null,models:[],defaultModel:null}),paired=config({id:'paired',name:'Existing Paired'});const {props}=edit({configs:[login,paired],tools:[tool('claude','api'),tool('codex')]});
 fireEvent.click(within(document.querySelector('[data-existing="login"]') as HTMLElement).getByRole('button',{name:'编辑它'}));fireEvent.click(within(document.querySelector('[data-existing="paired"]') as HTMLElement).getByRole('button',{name:'编辑它'}));expect(props.onEditExisting).toHaveBeenNthCalledWith(1,login);expect(props.onEditExisting).toHaveBeenNthCalledWith(2,paired);expect(api.save).not.toHaveBeenCalled();expect((createButton() as HTMLButtonElement).disabled).toBe(true);
});
it('API login uses native source and no Provider/models, while no-login cannot accidentally create a native config',async()=>{
 const rendered=edit({tools:[tool('claude','api')],providers:[]});expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Claude Code · API');fireEvent.click(createButton());await waitFor(()=>expect(api.save).toHaveBeenCalledOnce());expect(api.save.mock.calls[0][0]).toMatchObject({source:'login',providerId:null,models:[],defaultModel:null});rendered.unmount();api.save.mockClear();
 edit({tools:[tool('claude')],providers:[]});expect((createButton() as HTMLButtonElement).disabled).toBe(true);expect(within(screen.getByRole('radiogroup',{name:'订阅或供应商'})).queryByRole('radio')).toBeNull();fireEvent.click(createButton());expect(api.save).not.toHaveBeenCalled();
});
it('new Provider action only delegates the chosen Code Agent and never creates a Provider/Agent implicitly',()=>{
 const {props}=edit();fireEvent.click(screen.getByRole('radio',{name:/^Codex/}));fireEvent.click(screen.getByRole('button',{name:'添加供应商'}));expect(props.onAddProvider).toHaveBeenCalledExactlyOnceWith('codex');expect(api.saveProvider).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();
});
it('editing keeps the Code Agent fixed and a default agent cannot be hidden',()=>{
 edit({initial:config({isDefault:true})});expect((screen.getByRole('radio',{name:/^Codex/}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('switch',{name:'在首页显示'}) as HTMLButtonElement).disabled).toBe(true);
});
it('saving errors preserve name/models and keep the editor open; busy prevents repeated submission',async()=>{
 const pending=deferred<any>();api.save.mockReturnValue(pending.promise);const {props}=edit();fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Keep This Name'}});fireEvent.click(within(modelRow('b')).getByRole('checkbox'));fireEvent.click(createButton());fireEvent.click(screen.getByRole('button',{name:'正在保存…'}));expect(api.save).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve(Promise.reject(new Error("Error invoking remote method 'agents.save': Error: 保存失败"))));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('保存失败'));expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Keep This Name');expect((within(modelRow('b')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);expect(props.onSaved).not.toHaveBeenCalled();expect(props.onClose).not.toHaveBeenCalled();
});
it('single model check uses exact Provider/tool/model and errors do not discard current choices',async()=>{
 api.check.mockRejectedValue(new Error('可用性测试失败'));const {props}=edit();fireEvent.click(within(modelRow('b')).getByRole('checkbox'));fireEvent.click(within(modelRow('b')).getByRole('button',{name:'测试'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('可用性测试失败'));expect(api.check).toHaveBeenCalledExactlyOnceWith('p','claude','b');expect((within(modelRow('b')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);expect(props.onRefresh).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();
});
it('duplicate names block submit without overwriting the other agent',()=>{
 edit({configs:[config({id:'other',name:'Existing',toolId:'codex',kind:'codex'})]});fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Existing'}});expect((createButton() as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText('已有同名智能体，请修改名称。')).toBeTruthy();expect(api.save).not.toHaveBeenCalled();
});
it('export defaults exclude Key/native login and automatically lock the dependency Provider checkbox',async()=>{
 const close=vi.fn(),done=vi.fn();render(<AgentExportDialog providers={[provider()]} configs={[config(),config({id:'native',name:'Native Login',source:'login',providerId:null})]} onClose={close} onDone={done}/>);expect(screen.queryByText('Native Login')).toBeNull();const p=screen.getByRole('checkbox',{name:/Private Provider/}) as HTMLInputElement;expect(p.checked).toBe(true);expect(p.disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'导出'}));await waitFor(()=>expect(api.export).toHaveBeenCalledOnce());expect(api.export.mock.calls[0][0]).toEqual({agentIds:['c'],providerIds:[],includeKeys:false});await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();
});
it('export requires an 8-character matching passphrase only when including Keys and native chooser cancel keeps dialog open',async()=>{
 const close=vi.fn(),done=vi.fn();api.export.mockResolvedValue({ok:true,value:null});render(<AgentExportDialog providers={[provider()]} configs={[config()]} onClose={close} onDone={done}/>);fireEvent.click(screen.getByRole('checkbox',{name:/包含 Key/}));fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getByRole('alert').textContent).toContain('8');expect(api.export).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('口令（至少 8 个字符）'),{target:{value:'PUBLIC-8'}});fireEvent.change(screen.getByLabelText('再次输入'),{target:{value:'DIFFERENT'}});fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getByRole('alert').textContent).toContain('不一致');expect(api.export).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('再次输入'),{target:{value:'PUBLIC-8'}});fireEvent.click(screen.getByRole('button',{name:'导出'}));await waitFor(()=>expect(api.export).toHaveBeenCalledOnce());expect(api.export.mock.calls[0][0]).toMatchObject({includeKeys:true,password:'PUBLIC-8',confirmation:'PUBLIC-8'});expect(close).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
});
it('export busy suppresses duplicates and failure keeps selected fields/password',async()=>{
 const pending=deferred<any>();api.export.mockReturnValue(pending.promise);render(<AgentExportDialog providers={[provider()]} configs={[config()]} onClose={vi.fn()} onDone={vi.fn()}/>);fireEvent.click(screen.getByRole('checkbox',{name:/包含 Key/}));fireEvent.change(screen.getByLabelText('口令（至少 8 个字符）'),{target:{value:'PUBLIC-8'}});fireEvent.change(screen.getByLabelText('再次输入'),{target:{value:'PUBLIC-8'}});fireEvent.click(screen.getByRole('button',{name:'导出'}));fireEvent.click(screen.getByRole('button',{name:'正在导出…'}));expect(api.export).toHaveBeenCalledOnce();await act(async()=>pending.resolve({ok:false,code:'FILE_IO_FAILED',message:'保存文件失败'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('保存文件失败'));expect((screen.getByLabelText('再次输入') as HTMLInputElement).value).toBe('PUBLIC-8');
});
it('import native chooser cancel keeps empty state; encrypted input cannot unlock without a password or commit before preview',async()=>{
 const close=vi.fn(),done=vi.fn();render(<AgentImportDialog onClose={close} onDone={done}/>);fireEvent.click(screen.getByRole('button',{name:'选择配置文件…'}));await waitFor(()=>expect(api.choose).toHaveBeenCalledOnce());expect((screen.getByRole('button',{name:'导入'}) as HTMLButtonElement).disabled).toBe(true);expect(close).not.toHaveBeenCalled();
 api.choose.mockResolvedValue({ok:true,value:{token:'encrypted-1',encrypted:true,preview:null}});fireEvent.click(screen.getByRole('button',{name:'选择配置文件…'}));await waitFor(()=>expect(screen.getByLabelText('配置口令')).toBeTruthy());expect((screen.getByRole('button',{name:'解锁并预览'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'导入'}) as HTMLButtonElement).disabled).toBe(true);expect(api.unlock).not.toHaveBeenCalled();expect(api.commit).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
});
it('import wrong password retains file; corrected unlock clears password and displays only safe preview; commit failure preserves it',async()=>{
 const close=vi.fn(),done=vi.fn();api.choose.mockResolvedValue({ok:true,value:{token:'encrypted-1',encrypted:true,preview:null}});render(<AgentImportDialog onClose={close} onDone={done}/>);fireEvent.click(screen.getByRole('button',{name:'选择配置文件…'}));await waitFor(()=>expect(screen.getByLabelText('配置口令')).toBeTruthy());fireEvent.change(screen.getByLabelText('配置口令'),{target:{value:'WRONG_PUBLIC'}});fireEvent.click(screen.getByRole('button',{name:'解锁并预览'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('口令不正确'));expect((screen.getByLabelText('配置口令') as HTMLInputElement).value).toBe('WRONG_PUBLIC');
 const safe=preview({token:'encrypted-1',encrypted:true});(safe as any).credentials={key:'PUBLIC_NEVER_RENDER'};api.unlock.mockResolvedValue({ok:true,value:safe});fireEvent.change(screen.getByLabelText('配置口令'),{target:{value:'PUBLIC-8'}});fireEvent.click(screen.getByRole('button',{name:'解锁并预览'}));await waitFor(()=>expect(screen.getByText('X（导入）')).toBeTruthy());expect(document.body.textContent).not.toContain('PUBLIC_NEVER_RENDER');expect(screen.queryByLabelText('配置口令')).toBeNull();api.commit.mockResolvedValue({ok:false,code:'COMMIT_FAILED',message:'导入失败'});fireEvent.click(screen.getByRole('button',{name:'导入'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('导入失败'));expect(screen.getByText('X（导入）')).toBeTruthy();expect(close).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();expect(api.unlock.mock.calls[1]).toEqual(['encrypted-1','PUBLIC-8']);
});
it('import busy prevents duplicate commit; success reports once and unmount disposes owner pending state',async()=>{
 const close=vi.fn(),done=vi.fn(),pending=deferred<any>();api.choose.mockResolvedValue({ok:true,value:{token:'token-new',encrypted:false,preview:preview()}});api.commit.mockReturnValue(pending.promise);const rendered=render(<AgentImportDialog onClose={close} onDone={done}/>);fireEvent.click(screen.getByRole('button',{name:'选择配置文件…'}));await waitFor(()=>expect(screen.getByText('Agent X（导入）')).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'导入'}));fireEvent.click(screen.getByRole('button',{name:'正在处理…'}));expect(api.commit).toHaveBeenCalledExactlyOnceWith('token-new');await act(async()=>pending.resolve({ok:true,value:{providerIds:['p'],agentIds:['a'],skipped:[]}}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();rendered.unmount();expect(api.dispose).toHaveBeenCalledOnce();
});

it('all combinations already used explains edit-existing or add Provider instead of an empty third step',()=>{
 const used=config({toolId:'claude',providerId:'p'}),native=config({id:'login',toolId:'claude',source:'login',providerId:null});
 const {props}=edit({configs:[used,native]});
 expect(screen.getByText(/当前 Code Agent 的组合已经全部有智能体/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'添加新供应商'}));expect(props.onAddProvider).toHaveBeenCalledExactlyOnceWith('claude');
 expect((createButton() as HTMLButtonElement).disabled).toBe(true);expect(api.save).not.toHaveBeenCalled();
});

it('T092 API option identifies inherited environment variable without exposing its value',()=>{
 const PUBLIC='T092_PUBLIC_VALUE_MUST_NOT_RENDER';
 const supplied=Object.assign(tool('claude','api'),{
   loginSourceEnv:'ANTHROPIC_API_KEY',
   rawStatus:{value:PUBLIC}, // unknown/untrusted extra field must never render
 });
 edit({tools:[supplied],providers:[]});
 const source=within(screen.getByRole('radiogroup',{name:'订阅或供应商'}));
 expect(source.getByRole('radio',{name:/API/})).toBeTruthy();
 expect(source.getByText(/来自环境变量 ANTHROPIC_API_KEY/)).toBeTruthy();
 expect(document.body.textContent).not.toContain(PUBLIC);
 expect(api.save).not.toHaveBeenCalled();
});
