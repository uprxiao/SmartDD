import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {inspectCodexCliSandbox,planCodexCliSandbox,readCodexRequirements,type CodexRequirementsProof} from '../codex-effective-sandbox';
import type {TaskLaunchInput,NativeLaunchContext} from '../native-launch-context';
const requirements:CodexRequirementsProof={version:'0.166.0',known:true,empty:true,hash:'a'.repeat(64)};
const plan=(config:Record<string,unknown>,args:string[]=[],proof=requirements)=>planCodexCliSandbox({version:'0.166.0',layers:[{source:'user',config,hash:'b'.repeat(64)}],args,requirements:proof});
const named=()=>({default_permissions:'userx',permissions:{userx:{extends:':workspace',filesystem:{deny_read:['/private/fixture-denied']},network:{enabled:true,allowed_domains:['allowed.example.test']}}},features:{network_proxy:true}});
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('M11 exact Codex policy inheritance and fail-closed CLI delivery',()=>{
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
  const input={cwd,home:root,stateRoot,profile:{runner:'codex',args:['--profile','work']},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={version:'0.166.0'} as NativeLaunchContext;
  expect(await inspectCodexCliSandbox(input,native,async()=>requirements)).toMatchObject({available:true,parent:':read-only'});paths.forEach((path,i)=>expect(readFileSync(path,'utf8')).toBe(texts[i]));
 });
 it('accepts only a bounded native startup requirements snapshot, without executing profile arguments',async()=>{
  const root=mkdtempSync('/private/tmp/willyou-m11-policy-command-');roots.push(root);const command=join(root,'version-and-requirements-fixture');writeFileSync(command,'#!/bin/sh\nprintf \'%s\\n\' \'{"appServerVersion":"0.166.0","configRequirements":{"requirements":null}}\'\n',{mode:0o700});
  const input={cwd:root,environment:{PATH:'/usr/bin:/bin'},profile:{args:['--malicious-not-executed']},signal:new AbortController().signal} as unknown as TaskLaunchInput,native={command,version:'0.166.0'} as NativeLaunchContext;expect(await readCodexRequirements(input,native)).toMatchObject({known:true,empty:true});
  writeFileSync(command,'#!/bin/sh\nprintf \'%s\\n\' \'{"appServerVersion":"0.166.0","configRequirements":{"requirements":{"allowedSandboxModes":["read-only"]}}}\'\n',{mode:0o700});expect(await readCodexRequirements(input,native)).toMatchObject({known:true,empty:false});
 });
});
