import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AgentLaunchPlan } from './agent-launch-plan';
import { materializeAgentPlan } from './agent-launch-files';
let root: string, data: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-agent-files-'))); data = join(root,'user-data'); mkdirSync(data); });
afterEach(() => rmSync(root,{recursive:true,force:true}));
function plan(): AgentLaunchPlan {
  const claudeRoot = join(data,'agents','claude','1'.repeat(32));
  return { profile: { id:'c',name:'Synthetic',runner:'claude',command:'not-executed',args:[],env:{ANTHROPIC_AUTH_TOKEN:'PUBLIC_TEST_KEY'},isolatePrefixes:[] },permission:{id:'ask',args:[]},model:'a',claudeRoot,
    files:[{path:join(claudeRoot,'settings.json'),value:{modelPicker:{options:[{model:'a',label:'A'}],replaceBuiltInOptions:true}}}] };
}
it('writes only private settings/model menu and trust metadata without storing the process key or skipping the CLI danger warning',()=>{
  const p=plan(); materializeAgentPlan(p,data,root);
  expect(JSON.parse(readFileSync(p.files[0].path,'utf8'))).toEqual(p.files[0].value);
  const native=JSON.parse(readFileSync(join(p.claudeRoot!,'.claude.json'),'utf8'));
  expect(native.projects[root].hasTrustDialogAccepted).toBe(true); expect(native).not.toHaveProperty('skipDangerousModePermissionPrompt');
  expect(JSON.stringify([native,p.files[0].value])).not.toContain('PUBLIC_TEST_KEY');
  expect(statSync(p.files[0].path).mode & 0o777).toBe(0o600);
});
it.each([{env:{ANTHROPIC_BASE_URL:'https://other.invalid'}},{apiKeyHelper:'not-executed'}])('rejects residual managed authentication without overwriting it %j',(residual)=>{
  const p=plan(); mkdirSync(p.claudeRoot!,{recursive:true}); const path=p.files[0].path;writeFileSync(path,JSON.stringify(residual));
  expect(()=>materializeAgentPlan(p,data,root)).toThrow('残留认证');expect(JSON.parse(readFileSync(path,'utf8'))).toEqual(residual);
});
it('preserves harmless native preferences while refusing credentials and symlink destinations',()=>{
  const p=plan();materializeAgentPlan(p,data,root);writeFileSync(join(p.claudeRoot!,'.claude.json'),JSON.stringify({theme:'dark',skipDangerousModePermissionPrompt:true}));
  materializeAgentPlan(p,data,root);expect(JSON.parse(readFileSync(join(p.claudeRoot!,'.claude.json'),'utf8'))).toMatchObject({theme:'dark',skipDangerousModePermissionPrompt:true});
  writeFileSync(join(p.claudeRoot!,'.credentials.json'),'{}'); expect(()=>materializeAgentPlan(p,data,root)).toThrow('残留认证');
  rmSync(join(data,'agents'),{recursive:true});symlinkSync(root,join(data,'agents'));expect(()=>materializeAgentPlan(p,data,root)).toThrow('目录身份异常');
});
it('does not write to a native user root or serialize credentials into generated files',()=>{
  const p=plan();p.files[0].path=join(root,'.claude','settings.json');expect(()=>materializeAgentPlan(p,data,root)).toThrow('超出');
  const q=plan();q.files[0].value={key:'PUBLIC_TEST_KEY'};expect(()=>materializeAgentPlan(q,data,root)).toThrow('包含认证值');
  q.profile.env.ANTHROPIC_AUTH_TOKEN='public"test';q.files[0].value={key:'public"test'};expect(()=>materializeAgentPlan(q,data,root)).toThrow('包含认证值');
});
it('creates immutable per-run catalogs and leaves native-login configuration untouched',()=>{
  const p=plan();p.claudeRoot=null;p.files=[{path:join(data,'agents','runs','synthetic','models.json'),value:{models:[]}}];
  materializeAgentPlan(p,data,root);expect(()=>materializeAgentPlan(p,data,root)).toThrow('已存在');
  const login={...p,files:[],claudeRoot:null};materializeAgentPlan(login,join(root,'missing-user-root'),root);
  expect(dirname(p.files[0].path)).toContain('/agents/runs/');
});
