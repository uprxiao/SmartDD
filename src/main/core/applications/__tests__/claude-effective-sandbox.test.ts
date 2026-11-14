import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {planClaudeCliSandbox,inspectClaudeCliSandbox,verifyClaudeCliSandbox,readClaudeManagedPolicy,type ClaudePolicyInput} from '../claude-effective-sandbox';
import type {TaskLaunchInput,NativeLaunchContext} from '../native-launch-context';
import {planAgentLaunch} from '../../ai/agent-launch-plan';
import type {CodeAgentTool,ProviderView,RunConfigView} from '@shared/ai-agents';
const base=(settings:unknown):ClaudePolicyInput=>({version:'2.1.322',runner:'claude',cwd:'/private/project',args:['--permission-mode','default','--setting-sources','user'],settings,source:{hash:'a'.repeat(64),regular:true,stable:true},managed:{known:true,empty:true,hash:'b'.repeat(64)}});
const on=()=>({sandbox:{enabled:true,autoAllowBashIfSandboxed:false,filesystem:{denyRead:['/private/parent-denied']},network:{allowedDomains:[],allowLocalBinding:false}}});
const roots:string[]=[];afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
describe('finite Claude effective sandbox policy',()=>{
 it('accepts the production model environment and revokes changed subagent models before fork',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-claude-source-');roots.push(root);const cwd=join(root,'project');mkdirSync(cwd);
  const tool:CodeAgentTool={id:'tool',kind:'claude',executable:'/synthetic/claude',installed:true,login:'none',version:'2.1.322'};
  const config:RunConfigView={id:'config',name:'public fixture',toolId:tool.id,kind:'claude',source:'provider',providerId:'provider',models:['selected'],defaultModel:'selected',homeVisible:true,isDefault:true,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null};
  const provider:ProviderView={id:'provider',name:'public fixture',preset:null,endpoints:{anthropic:'http://127.0.0.1:9'},authType:'bearer',hasKey:true,identityRevision:1,models:[{id:'selected',name:'selected',offline:false,contextWindow:null,availability:{claude:'available',codex:'untested'}}],recommended:{},refreshedAt:null};
  const launch=planAgentLaunch({config,tool,provider,key:'PUBLIC_MODEL_FIXTURE_ONLY',permission:'ask',cwd,userData:root,runId:'11111111-1111-4111-a111-111111111111'});
  const stateRoot=launch.claudeRoot!;mkdirSync(stateRoot,{recursive:true,mode:0o700});for(const file of launch.files)writeFileSync(file.path,JSON.stringify(file.value),{mode:0o600});
  const input={cwd,stateRoot,profile:launch.profile,environment:{...launch.profile.env}} as unknown as TaskLaunchInput,native={version:'2.1.322'} as NativeLaunchContext,probe=()=>({known:true,empty:true,hash:'b'.repeat(64)});
  expect(input.environment.CLAUDE_CODE_SUBAGENT_MODEL).toBe('selected');
  const policy=await inspectClaudeCliSandbox(input,native,probe);expect(policy).toMatchObject({available:true,kind:'unchanged'});verifyClaudeCliSandbox(policy);
  input.environment.CLAUDE_CODE_SUBAGENT_MODEL='different';expect(()=>verifyClaudeCliSandbox(policy)).toThrow('启动前已变化');expect((await inspectClaudeCliSandbox(input,native,probe)).available).toBe(false);
  input.environment.CLAUDE_CODE_SUBAGENT_MODEL='selected';
  for(const args of [launch.profile.args.filter((value,index,all)=>value!=='--model'&&all[index-1]!=='--model'),[...launch.profile.args,'--model','selected']])expect((await inspectClaudeCliSandbox({...input,profile:{...launch.profile,args}},native,probe)).available).toBe(false);
  delete input.environment.CLAUDE_CODE_SUBAGENT_MODEL;expect(()=>verifyClaudeCliSandbox(policy)).toThrow('启动前已变化');
 });
 it.each([{}, {modelPicker:{options:[{model:'private-model',label:'model'}]}}, {sandbox:{}}, {sandbox:{autoAllowBashIfSandboxed:false}}, {sandbox:{enabled:false}}])('honors the official default-off source without changing it: %j',settings=>{
  const input=base(settings),before=structuredClone(input),result=planClaudeCliSandbox(input);expect(result).toMatchObject({available:true,runner:'claude-code',kind:'unchanged'});expect(input).toEqual(before);
 });
 it('preserves the original deny/domain source and approval arguments while allowing a precise Unix overlay',()=>{
  const input=base(on()),before=structuredClone(input),result=planClaudeCliSandbox(input);expect(result).toMatchObject({available:true,kind:'allow-unix'});expect(input).toEqual(before);expect(JSON.stringify(result)).not.toContain('parent-denied');
  const changed=base(on());changed.source.hash='c'.repeat(64);expect(planClaudeCliSandbox(changed).digest).not.toBe(result.digest);
 });
 it.each([null,{sandbox:null},{sandbox:{enabled:'true'}},{sandbox:{enabled:true}},{sandbox:{enabled:true,autoAllowBashIfSandboxed:true}},{sandbox:{enabled:true,autoAllowBashIfSandboxed:false,network:{allowUnixSockets:[]}}},{sandbox:{enabled:true,autoAllowBashIfSandboxed:false,network:{allowUnixSockets:['/previous.sock']}}},{sandbox:{enabled:true,autoAllowBashIfSandboxed:false,network:{allowAllUnixSockets:true}}},{sandbox:{enabled:true,autoAllowBashIfSandboxed:false,excludedCommands:['*']}}])('refuses unverified policy values and merges: %j',settings=>{expect(planClaudeCliSandbox(base(settings)).available).toBe(false);});
 it.each([['--permission-mode','default','--setting-sources','user,project,local'],['--permission-mode','default','--settings','/other.json'],['--permission-mode','default','--setting-sources=user'],['--permission-mode','default','--setting-sources','user','--settings={}'],['--permission-mode','auto','--setting-sources','user']])('refuses unverified source/permission flags without rewriting them: %j',(...args)=>{expect(planClaudeCliSandbox({...base({}),args}).available).toBe(false);});
 it('refuses settings env or authentication helpers that could change the proved source',()=>{
  for(const settings of [{env:{ANTHROPIC_BASE_URL:'https://api.anthropic.com'}},{apiKeyHelper:'/never-execute'},{headersHelper:'/never-execute'}])expect(planClaudeCliSandbox(base(settings)).available).toBe(false);
 });
 it('treats denied managed-path observation as unknown, not an absent policy',()=>{
  const result=readClaudeManagedPolicy('/private/isolated',{username:'fixture-user',exists:()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});}});expect(result).toMatchObject({known:false,empty:false});
 });
 it('does not infer safety from an unknown managed source, mutated file, wrong runner or future version',()=>{
  for(const change of [{managed:{known:false,empty:true,hash:'b'.repeat(64)}},{managed:{known:true,empty:false,hash:'b'.repeat(64)}},{source:{hash:'a'.repeat(64),regular:false,stable:true}},{source:{hash:'a'.repeat(64),regular:true,stable:false}},{runner:'codex'},{version:'2.1.324'}])expect(planClaudeCliSandbox({...base({}),...change}).available).toBe(false);
 });
 it('keeps full-access native argv unchanged when the source is off and does not guess enabled-sandbox behavior',()=>{
  const args=['--permission-mode','bypassPermissions','--setting-sources','user'];expect(planClaudeCliSandbox({...base({}),args})).toMatchObject({available:true,kind:'unchanged'});expect(planClaudeCliSandbox({...base(on()),args}).available).toBe(false);
 });
 it('reads an exact private source and rechecks both it and managed proof before fork',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-claude-source-');roots.push(root);const stateRoot=join(root,'agents','claude','a'.repeat(32));mkdirSync(stateRoot,{recursive:true,mode:0o700});const file=join(stateRoot,'settings.json'),text=JSON.stringify({modelPicker:{options:[]}});writeFileSync(file,text,{mode:0o600});let managed={known:true,empty:true,hash:'b'.repeat(64)};
  const input={cwd:'/private/project',stateRoot,profile:{runner:'claude',args:base({}).args},environment:{CLAUDE_CONFIG_DIR:stateRoot,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_BASE_URL:'http://127.0.0.1:9'}} as unknown as TaskLaunchInput,native={version:'2.1.322'} as NativeLaunchContext;
  const result=await inspectClaudeCliSandbox(input,native,()=>managed);expect(result).toMatchObject({available:true,kind:'unchanged'});verifyClaudeCliSandbox(result);expect(readFileSync(file,'utf8')).toBe(text);
  input.environment._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL='1';expect(()=>verifyClaudeCliSandbox(result)).toThrow('启动前已变化');delete input.environment._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL;
  managed={...managed,empty:false};expect(()=>verifyClaudeCliSandbox(result)).toThrow('启动前已变化');managed={...managed,empty:true};writeFileSync(file,JSON.stringify(on()));expect(()=>verifyClaudeCliSandbox(result)).toThrow('启动前已变化');
 });
 it('checks per-user MDM by the native account name independently of isolated HOME',()=>{
  const path='/Library/Managed Preferences/fixture-user/com.anthropic.claudecode.plist',visited:string[]=[];
  expect(readClaudeManagedPolicy('/private/isolated/agents/claude/'+ 'a'.repeat(32),{username:'fixture-user',exists:p=>{visited.push(p);return p===path;}})).toMatchObject({known:true,empty:false});expect(visited).toContain(path);
  expect(readClaudeManagedPolicy('/private/isolated',{username:'../unverified',exists:()=>false})).toMatchObject({known:false,empty:false});
 });
 it('revokes the inspected proof when an account-specific MDM policy appears before fork',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-claude-source-');roots.push(root);const stateRoot=join(root,'agents','claude','a'.repeat(32));mkdirSync(stateRoot,{recursive:true,mode:0o700});writeFileSync(join(stateRoot,'settings.json'),'{}',{mode:0o600});let present=false;
  const probe=(path:string)=>readClaudeManagedPolicy(path,{username:'fixture-user',exists:p=>present&&p==='/Library/Managed Preferences/fixture-user/com.anthropic.claudecode.plist'});
  const input={cwd:'/private/project',stateRoot,profile:{runner:'claude',args:base({}).args},environment:{CLAUDE_CONFIG_DIR:stateRoot,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_BASE_URL:'http://127.0.0.1:9'}} as unknown as TaskLaunchInput,result=await inspectClaudeCliSandbox(input,{version:'2.1.322'} as NativeLaunchContext,probe);expect(result.available).toBe(true);verifyClaudeCliSandbox(result);present=true;expect(()=>verifyClaudeCliSandbox(result)).toThrow('启动前已变化');
 });
 it('refuses symlink sources and environment overrides instead of executing or following them',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-claude-source-');roots.push(root);const stateRoot=join(root,'agents','claude','a'.repeat(32));mkdirSync(stateRoot,{recursive:true,mode:0o700});const target=join(root,'outside.json');writeFileSync(target,'{}');symlinkSync(target,join(stateRoot,'settings.json'));const input={cwd:'/private/project',stateRoot,profile:{runner:'claude',args:base({}).args},environment:{CLAUDE_CONFIG_DIR:stateRoot,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_BASE_URL:'http://127.0.0.1:9'}} as unknown as TaskLaunchInput,native={version:'2.1.322'} as NativeLaunchContext;
  expect((await inspectClaudeCliSandbox(input,native,()=>({known:true,empty:true,hash:'b'.repeat(64)}))).available).toBe(false);
  expect((await inspectClaudeCliSandbox({...input,environment:{...input.environment,CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'1'}},native)).available).toBe(false);
  expect((await inspectClaudeCliSandbox({...input,environment:{...input.environment,ANTHROPIC_BASE_URL:'https://api.anthropic.com'}},native)).available).toBe(false);expect(readFileSync(target,'utf8')).toBe('{}');
 });
});
