import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {codexProfileArgsForCli,codexRequirementsArgs,inspectCodexCliSandbox,planCodexCliSandbox,readCodexRequirements,verifyCodexCliSandbox,type CodexRequirementsProof} from '../codex-effective-sandbox';
import type {TaskLaunchInput,NativeLaunchContext} from '../native-launch-context';
const requirements:CodexRequirementsProof={version:'0.166.0',known:true,empty:true,hash:'a'.repeat(64)};
const plan=(config:Record<string,unknown>,args:string[]=[],proof=requirements)=>planCodexCliSandbox({version:'0.166.0',layers:[{source:'user',config,hash:'b'.repeat(64)}],args,requirements:proof});
const named=()=>({default_permissions:'userx',permissions:{userx:{extends:':workspace',filesystem:{deny_read:['/private/fixture-denied']},network:{enabled:true,allowed_domains:['allowed.example.test']}}},features:{network_proxy:true}});
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('M11 exact Codex policy inheritance and fail-closed CLI delivery',()=>{
 it.each([
  ['--disable','network_proxy'],['--disable=network_proxy'],
  ['--disable','network_proxy','--enable','network_proxy'],
  ['--enable','network_proxy','--disable','network_proxy'],
  ['--disable','network_proxy,plugins'],
 ])('does not enable a private network profile when native proxy switches cannot preserve the original network policy: %j',(...args)=>{
  expect(plan({sandbox_mode:'workspace-write'},args).available).toBe(false);
 });
 it.each(['read-only','workspace-write'] as const)('delivers explicit %s through the equivalent private policy while preserving original approval/profile args',mode=>{
  for(const selector of [['--sandbox',mode],['--sandbox='+mode],['-s',mode],['-s'+mode],['-s='+mode]]){
   const kept=['--profile','owned-profile','--model','owned-model','--ask-for-approval','never','-c','skills.config=[]'],args=[...kept,...selector],original=[...args];
   const policy=plan({sandbox_mode:mode==='read-only'?'workspace-write':'read-only'},args);
   expect(policy).toMatchObject({available:true,kind:'inherit',parent:mode==='read-only'?':read-only':':workspace'});
   expect(codexProfileArgsForCli(args,policy)).toEqual([...kept,'--disable','shell_snapshot']);expect(args).toEqual(original);
  }
 });
 it('leaves unverified argv alone and protects verified CLI runs without changing full-access or approval selectors',()=>{
  const args=['--sandbox','read-only','--ask-for-approval','never'];
  expect(codexProfileArgsForCli(args,{available:false,reason:'unverified',source:'test',digest:null})).toEqual(args);
  const full=['--sandbox','danger-full-access'];expect(codexProfileArgsForCli(full,plan({},full))).toEqual([...full,'--disable','shell_snapshot']);
  const automatic=['--approve-for-me'];expect(codexProfileArgsForCli(automatic,plan({},automatic))).toEqual([...automatic,'--disable','shell_snapshot']);
  expect(()=>codexProfileArgsForCli(args,plan({sandbox_mode:'workspace-write'}))).toThrow('不等价');
 });
 it('adds the run-local snapshot protection after original feature arguments without mutating the profile',()=>{
  const args=['--enable','shell_snapshot','-c','features.shell_snapshot=true','--ask-for-approval','on-request'],before=[...args];
  const policy=plan({sandbox_mode:'workspace-write'},args);
  expect(policy.available).toBe(true);
  expect(codexProfileArgsForCli(args,policy)).toEqual([...args,'--disable','shell_snapshot']);
  expect(args).toEqual(before);
 });
 it.each([
  ['--sandbox','read-only','--sandbox','workspace-write'],
  ['--sandbox','read-only','--approve-for-me'],
  ['--not-so-yolo','-sread-only'],
  ['--approve-for-me','--yolo'],
  ['--','--sandbox','read-only'],
 ])('does not turn a native-invalid selector combination into a runnable grant: %j',(...args)=>{
  expect(plan({},args).available).toBe(false);
 });
 it('honors native bypass precedence in either argv order and hashes approval argv without changing it',()=>{
  for(const args of [['--yolo','--sandbox','read-only'],['--sandbox','read-only','--yolo']])expect(plan({},args)).toMatchObject({available:true,kind:'unchanged'});
  expect(plan({sandbox_mode:'read-only'},['--ask-for-approval','never']).digest).not.toBe(plan({sandbox_mode:'read-only'},['--ask-for-approval','on-request']).digest);
 });
 it.each(['read-only','workspace-write'] as const)('maps only a simple explicit %s policy to its native baseline',mode=>{expect(plan({sandbox_mode:mode})).toMatchObject({available:true,kind:'inherit',parent:mode==='read-only'?':read-only':':workspace',networkProxy:true,enableNetwork:true});});
 it('keeps explicit full access unchanged instead of replacing its file or network policy',()=>{expect(plan({},['--dangerously-bypass-approvals-and-sandbox'])).toMatchObject({available:true,kind:'unchanged',parent:null,enableNetwork:false,networkProxy:false});});
 it('inherits the original named policy with deny-read and domain rules rather than reconstructing a baseline',()=>{const input=named(),before=structuredClone(input),result=plan(input);expect(result).toMatchObject({available:true,parent:'userx',source:'inherited-named-permissions',enableNetwork:false});expect(input).toEqual(before);expect(JSON.stringify(result)).not.toContain('/private/fixture-denied');expect(JSON.stringify(result)).not.toContain('allowed.example.test');const changed=named();changed.permissions.userx.filesystem.deny_read.push('/private/another');expect(plan(changed).digest).not.toBe(result.digest);});
 it('retains every parent when a named profile extends another named profile',()=>{expect(plan({default_permissions:'child',permissions:{child:{extends:'base',filesystem:{deny_read:['/private/child']}},base:{extends:':read-only',filesystem:{deny_read:['/private/base']}}}})).toMatchObject({available:true,parent:'child'});});
 it.each([
  ['implicit unknown default',{},[]],
  ['legacy extra writable roots',{sandbox_mode:'workspace-write',sandbox_workspace_write:{writable_roots:['/private/extra']}},[]],
  ['additional directory flag',{sandbox_mode:'workspace-write'},['--add-dir','/private/extra']],
  ['cwd override',{sandbox_mode:'workspace-write'},['--cd','/private/other']],
  ['mixed named and legacy',{...named(),sandbox_mode:'read-only'},[]],
  ['cyclic parent',{default_permissions:'x',permissions:{x:{extends:'y'},y:{extends:'x'}}},[]],
  ['missing parent',{default_permissions:'x',permissions:{x:{extends:'missing'}}},[]],
  ['unsupported full named baseline',{default_permissions:'x',permissions:{x:{extends:':unknown'}}},[]],
  ['network proxy disabled',{...named(),features:{network_proxy:false}},[]],
  ['native CLI flag disables proxy',named(),['--disable=network_proxy']],
  ['inactive allowlist would become active',{default_permissions:'x',permissions:{x:{extends:':workspace',network:{enabled:false,allowed_domains:['previously-blocked.test']}}}},[]],
  ['malformed native mode',{sandbox_mode:'workspace-write'},['--sandbox']],
  ['compact read-only override is preserved',{sandbox_mode:'workspace-write'},['-sread-only','--add-dir','/private/extra']],
 ] as [string,Record<string,unknown>,string[]][])('does not inject an unverified %s',(_label,config,args)=>{expect(plan(config,args).available).toBe(false);});
 it('uses CLI overrides in native precedence order and does not assume managed requirements are compatible',()=>{expect(plan({sandbox_mode:'workspace-write'},['-c','sandbox_mode="read-only"'])).toMatchObject({available:true,parent:':read-only'});for(const proof of [{...requirements,known:false},{...requirements,empty:false},{...requirements,version:'0.167.0'},{...requirements,hash:null}])expect(plan({sandbox_mode:'workspace-write'},[],proof).available).toBe(false);});
 it('refuses an unverified system-level security rule and keeps only public digests',()=>{expect(planCodexCliSandbox({version:'0.166.0',layers:[{source:'system',config:{sandbox_mode:'read-only'},hash:'b'.repeat(64)}],args:[],requirements}).available).toBe(false);const value=plan({sandbox_mode:'read-only',api_key:'CANARY_NOT_A_REAL_KEY'});expect(value.available).toBe(true);expect(JSON.stringify(value)).not.toContain('CANARY_NOT_A_REAL_KEY');});
 it('loads base, selected independent profile, project and CLI security input without rewriting any config',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m11-policy-');roots.push(root);const stateRoot=join(root,'codex'),cwd=join(root,'project');mkdirSync(stateRoot);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(join(cwd,'.codex'));
  const paths=[join(stateRoot,'config.toml'),join(stateRoot,'work.config.toml'),join(cwd,'.codex/config.toml')],texts=['sandbox_mode="workspace-write"\n','sandbox_mode="read-only"\n','approval_policy="never"\n'];paths.forEach((path,i)=>writeFileSync(path,texts[i]));
  const input={cwd,home:root,stateRoot,profile:{runner:'codex',args:['--profile','work']},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={command:'/public-fixture/codex',version:'0.166.0'} as NativeLaunchContext;
  expect(await inspectCodexCliSandbox(input,native,async()=>requirements)).toMatchObject({available:true,parent:':read-only'});paths.forEach((path,i)=>expect(readFileSync(path,'utf8')).toBe(texts[i]));
 });
 it.each(['add-project','change-user','remove-user','change-arguments'] as const)('rechecks actual inspected sources before fork: %s',async change=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-policy-fresh-');roots.push(root);const stateRoot=join(root,'codex'),cwd=join(root,'project');mkdirSync(stateRoot);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));
  const path=join(stateRoot,'config.toml');writeFileSync(path,'sandbox_mode="workspace-write"\n');
  const input={cwd,home:root,stateRoot,profile:{runner:'codex',args:[]},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={command:'/public-fixture/codex',version:'0.166.0'} as NativeLaunchContext;
  const policy=await inspectCodexCliSandbox(input,native,async()=>requirements);expect(policy.available).toBe(true);expect(()=>verifyCodexCliSandbox(policy)).not.toThrow();
  if(change==='add-project'){mkdirSync(join(cwd,'.codex'));writeFileSync(join(cwd,'.codex/config.toml'),'sandbox_mode="read-only"\n');}
  else if(change==='change-user')writeFileSync(path,'sandbox_mode="read-only"\n');
  else if(change==='remove-user')rmSync(path);
  else input.profile.args.push('-s','read-only');
  expect(()=>verifyCodexCliSandbox(policy)).toThrow(expect.objectContaining({code:'RESOURCE_STATE_CHANGED'}));
 });
 it('refuses source changes while native requirements inspection is pending',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-policy-await-');roots.push(root);const cwd=join(root,'project');mkdirSync(cwd);mkdirSync(join(cwd,'.git'));const path=join(root,'config.toml');writeFileSync(path,'sandbox_mode="workspace-write"\n');
  const input={cwd,home:root,stateRoot:root,profile:{runner:'codex',args:[]},signal:new AbortController().signal} as unknown as TaskLaunchInput;
  const policy=await inspectCodexCliSandbox(input,{command:'/public-fixture/codex',version:'0.166.0'} as NativeLaunchContext,async()=>{writeFileSync(path,'sandbox_mode="read-only"\n');return requirements;});expect(policy.available).toBe(false);
 });
 it('preserves raw overrides and native feature grouping without moving TUI selectors to startup print',()=>{
  expect(codexRequirementsArgs(['-c','model_provider="owned"','--disable','plugins','--enable=network_proxy','--config=features.plugins=true','-s','workspace-write','-a','on-request','--model','public'])).toEqual(['-c','model_provider="owned"','-c','features.plugins=true','-c','features.network_proxy=true','-c','features.plugins=false','app-server','--print-startup-config']);
  expect(codexRequirementsArgs(['--approve-for-me'])).toEqual(['-c','approvals_reviewer="auto_review"','-c','approval_policy="on-request"','-c','sandbox_mode="workspace-write"','app-server','--print-startup-config']);
  expect(codexRequirementsArgs(['-cmodel="a=b"','--config','model="last"'])).toEqual(['-c','model="a=b"','-c','model="last"','app-server','--print-startup-config']);
  for(const args of [['--profile','work'],['--profile=work'],['--model','-c','not-a-root-override'],['--','prompt'],['--unknown'],['--config'],['--enable','network_proxy,plugins'],['-c','sandbox_mode=workspace-write'],['-c','model="a"\nother=true']])expect(codexRequirementsArgs(args)).toBeNull();
 });
 it('accepts only a bounded native startup requirements snapshot, without executing unsupported profile arguments',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m11-policy-command-');roots.push(root);const command=join(root,'version-and-requirements-fixture');writeFileSync(command,'#!/bin/sh\nprintf \'%s\\n\' \'{"appServerVersion":"0.166.0","configRequirements":{"requirements":null}}\'\n',{mode:0o700});
  const input={cwd:root,environment:{PATH:'/usr/bin:/bin'},profile:{args:[]},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={command,version:'0.166.0'} as NativeLaunchContext;expect(await readCodexRequirements(input,native)).toMatchObject({known:true,empty:true});
  writeFileSync(command,'#!/bin/sh\nprintf \'%s\\n\' \'{"appServerVersion":"0.166.0","configRequirements":{"requirements":{"allowedSandboxModes":["read-only"]}}}\'\n',{mode:0o700});expect(await readCodexRequirements(input,native)).toMatchObject({known:true,empty:false});
 });
 it('sends the original root override to the actual metadata child and refuses unsupported sources before forking',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m13-requirements-argv-');roots.push(root);const command=join(root,'capture-argv');
  writeFileSync(command,'#!/bin/sh\nprintf \'%s\\n\' "$@" > argv.txt\nprintf \'%s\\n\' \'{"appServerVersion":"0.166.0","configRequirements":{"requirements":null}}\'\n',{mode:0o700});
  const input={cwd:root,environment:{PATH:'/usr/bin:/bin'},profile:{args:['-c','model_provider="public-local"','--disable','plugins','-s','workspace-write']},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={command,version:'0.166.0'} as NativeLaunchContext;
  expect(await readCodexRequirements(input,native)).toMatchObject({known:true,empty:true});
  const actual=readFileSync(join(root,'argv.txt'),'utf8');expect(actual).toBe('-c\nmodel_provider="public-local"\n-c\nfeatures.plugins=false\napp-server\n--print-startup-config\n');
  writeFileSync(join(root,'argv.txt'),'NO_FORK');
  for(const args of [['--profile','work'],['--unknown'],['--','untrusted prompt']]){
   input.profile.args=args;expect(await readCodexRequirements(input,native)).toMatchObject({known:false});expect(readFileSync(join(root,'argv.txt'),'utf8')).toBe('NO_FORK');
  }
 });
});
