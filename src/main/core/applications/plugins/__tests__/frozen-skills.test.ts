import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import * as schema from '../../../../db/schema';
import {SecretsStore} from '../../../../secrets';
import {MacProcessIdentityReader} from '../../process-identity';
import {agentFixture} from '../../__tests__/agent-fixture';
import {PluginHostService} from '../host-service';
import {validatePluginBundle} from '../package';
import {FrozenPluginSkills,type FrozenPluginSkillSet,pluginSkillNamespace} from '../frozen-skills';
import {fixture} from './fixture';

let f:Awaited<ReturnType<typeof agentFixture>>,host:PluginHostService,delivery:FrozenPluginSkills;
function plugin(version='0.1.0'){
  const p=fixture();p.manifest.version=version;p.manifest.providers=[];p.manifest.capabilities['demo-tracker.items.list'].slots=[];Object.assign(p.manifest,{skills:['skills']});p.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:${JSON.stringify(version)}}})+'\\n');});`));
  p.files.set('skills/query/SKILL.md',Buffer.from(`---\nname: query\ndescription: Synthetic query ${version}\n---\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\n[Relative](references/version.txt)\n`));p.files.set('skills/query/references/version.txt',Buffer.from(version));p.files.set('skills/query/scripts/run.sh',Buffer.from('#!/bin/sh\ncat "$(dirname "$0")/../references/version.txt"\n'));
  // These are package files, not native plugin capabilities; delivery must not activate them.
  p.files.set('.mcp.json',Buffer.from('{"mcpServers":{"MUST_NOT_LOAD":{}}}'));p.files.set('hooks/hooks.json',Buffer.from('{"MUST_NOT_RUN":true}'));p.files.set('.claude-plugin/plugin.json',Buffer.from('{"name":"UNTRUSTED_NATIVE_PLUGIN"}'));
  return validatePluginBundle(p.bundle(),undefined,new Set(['skills/query/scripts/run.sh']));
}
async function snapshot(runner:'claude-code'|'codex'='claude-code'){
  const original=f.plan(runner);await f.sessions.create(original,f.home);const externalPlugins=host.selections('p1'),nativeToolNames={...original.adapterBinding.nativeToolNames};for(const p of externalPlugins)for(const c of p.capabilities)nativeToolNames[c.mcpTool]='mcp__synthetic_host__'+c.mcpTool;
  return{...original,schema:3,packages:[],externalPlugins,adapterBinding:{...original.adapterBinding,nativeToolNames}} as CapabilitySessionSnapshot;
}
async function prepare(runner:'claude-code'|'codex'='claude-code'){
  const selected=await snapshot(runner),runId=randomUUID();f.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES(?,?,?,?,'prepared',?)").run(runId,selected.taskId,selected.projectId,runner,new Date().toISOString());const set=delivery.describe(selected,runId,{mcp:true,cli:false})!;delivery.materialize(set);return{set,selected,runId};
}
const entry=(set:FrozenPluginSkillSet)=>join(set.root,'packages/demo-tracker/payload/skills/query/SKILL.md');
beforeEach(async()=>{
  f=await agentFixture();mkdirSync(join(f.root,'synthetic-keychain'));const secrets=new SecretsStore(drizzle(f.sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});host=new PluginHostService(f.store,secrets,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(f.root,'synthetic-keychain')]}});const p=plugin();await host.lifecycle.install(p,host.lifecycle.inspect(p));delivery=new FrozenPluginSkills(f.store,host.lifecycle);
});
afterEach(async()=>{vi.restoreAllMocks();await host?.close();f?.cleanup();});
describe('per-run frozen external plugin Skill trees',()=>{
  it('uses an explicit native Claude wrapper, renders only host entrypoints, and preserves relative assets and executable scripts',async()=>{
    const {set}=await prepare(),wrapper=JSON.parse(readFileSync(join(set.claudeRoots[0],'.claude-plugin/plugin.json'),'utf8'));expect(wrapper).toEqual({name:'willyou-demo-tracker',version:'0.1.0',description:'Synthetic P1 plugin',skills:['./payload/skills/query']});expect(set.skills[0].nativeName).toBe('willyou-demo-tracker:query');const text=readFileSync(entry(set),'utf8');expect(text).toContain('name: query');expect(text).toContain('mcp__synthetic_host__smartdd_p');expect(text).not.toContain('{{WILLYOU_');expect(existsSync(join(set.claudeRoots[0],'payload/runtime/main.mjs'))).toBe(false);expect(existsSync(join(set.claudeRoots[0],'payload/.mcp.json'))).toBe(false);expect(existsSync(join(set.claudeRoots[0],'hooks/hooks.json'))).toBe(false);expect(existsSync(join(f.home,'.claude/skills'))).toBe(false);
    const script=join(set.claudeRoots[0],'payload/skills/query/scripts/run.sh');expect(statSync(script).mode&0o111).toBe(0o100);expect(execFileSync(script,[],{cwd:f.cwd,encoding:'utf8'})).toBe('0.1.0');delivery.verify(set);
    const evidence=process.env.WILLYOU_P1_SKILL_EVIDENCE_DIR;if(evidence){const output=realpathSync(evidence);if(!output.startsWith('/private/tmp/willyou-m13-plugin-skills-'))throw new Error('Synthetic evidence output must be isolated');const destination=join(output,'claude-wrapper');cpSync(set.claudeRoots[0],destination,{recursive:true,errorOnExist:true,force:false});writeFileSync(join(output,'frozen-fixture.json'),JSON.stringify({bundleHash:set.bundle.hash,wrapperHash:set.skills[0].renderedHash,source:'Actual FrozenPluginSkills materialization from this software fixture',nativeModel:false},null,2));}
  });
  it('provides exact private Codex roots and globally unique Skill names without writing HOME or project discovery',async()=>{
    const {set}=await prepare('codex');expect(set.claudeRoots).toEqual([]);expect(set.codexRoots).toEqual([join(set.root,'packages/demo-tracker/payload/skills/query')]);expect(set.skills[0].nativeName).toBe('willyou-demo-tracker-query');expect(readFileSync(entry(set),'utf8')).toContain('name: willyou-demo-tracker-query');expect(existsSync(join(f.home,'.agents/skills'))).toBe(false);expect(existsSync(join(f.cwd,'.agents/skills'))).toBe(false);const evidence=process.env.WILLYOU_P1_SKILL_EVIDENCE_DIR;if(evidence){const output=realpathSync(evidence);if(!output.startsWith('/private/tmp/willyou-m13-plugin-skills-'))throw new Error('Synthetic evidence output must be isolated');cpSync(set.root,join(output,'codex-projection'),{recursive:true,errorOnExist:true,force:false});writeFileSync(join(output,'codex-fixture.json'),JSON.stringify({bundleHash:set.bundle.hash,roots:['packages/demo-tracker/payload/skills/query'],nativeName:set.skills[0].nativeName,source:'Actual FrozenPluginSkills materialization; Codex production delivery not yet connected'},null,2));}
  });
  it('keeps old loaded bytes after update deletes the old package, while the next run receives only the latest Skill',async()=>{
    const {set:old}=await prepare(),before=readFileSync(entry(old));const p=plugin('0.2.0');await host.lifecycle.install(p,host.lifecycle.inspect(p));expect(host.lifecycle.packages.list().some(row=>row.manifest.version==='0.1.0')).toBe(false);expect(readFileSync(entry(old))).toEqual(before);const {set:next}=await prepare();expect(readFileSync(entry(next),'utf8')).toContain('Synthetic query 0.2.0');expect(next.root).not.toBe(old.root);delivery.verify(old);
  });
  it('omits a project-closed or globally disabled plugin from new runs without changing an existing frozen copy',async()=>{
    const {set,selected}=await prepare(),before=readFileSync(entry(set)),target={appId:'demo-tracker',packageHash:host.lifecycle.state('demo-tracker').hash!},project=host.connections.project(target,'p1');await host.connections.setProject({...target,projectId:'p1',expectedRevision:project.binding_revision,mode:'follow',enabled:false});expect(delivery.describe({...selected,...{externalPlugins:host.selections('p1')}} as CapabilitySessionSnapshot,randomUUID(),{mcp:true,cli:false})).toBeUndefined();expect(readFileSync(entry(set))).toEqual(before);
    await host.setEnabled('demo-tracker',false,host.lifecycle.state('demo-tracker').revision);expect(host.selections('p1')).toEqual([]);delivery.verify(set);
  });
  it('retains loaded Skills after uninstall but no longer describes any for a subsequent run',async()=>{
    const {set}=await prepare();await host.uninstall('demo-tracker',true,host.lifecycle.state('demo-tracker').revision);delivery.verify(set);const selected=await snapshot();expect(delivery.describe(selected,randomUUID(),{mcp:true,cli:false})).toBeUndefined();
  });
  it('refuses native name collisions and explicit user disabled names without replacing any user entry',async()=>{
    const {set}=await prepare();expect(()=>delivery.checkNative(set,{inventory:[{kind:'plugin',name:pluginSkillNamespace('demo-tracker'),path:'/synthetic/user/plugin',ownerStoreId:null,contentHash:null}],userSkillConfig:[]})).toThrow('保留用户配置');expect(()=>delivery.checkNative(set,{inventory:[{kind:'skill',name:set.skills[0].nativeName,path:'/synthetic/user/skill',ownerStoreId:null,contentHash:null}],userSkillConfig:[]})).toThrow();expect(()=>delivery.checkNative(set,{inventory:[],userSkillConfig:[{name:set.skills[0].nativeName,enabled:false}]})).toThrow();delivery.verify(set);
  });
  it('refuses cleanup before confirmed stop and reclaims only stopped, verified run directories during recovery',async()=>{
    const {set,runId}=await prepare();expect(()=>delivery.release(runId)).toThrow('原运行未确认停止');expect(delivery.recover()).toContainEqual({runId,code:'RESOURCE_BUSY'});expect(existsSync(set.root)).toBe(true);f.sqlite.prepare("UPDATE capability_runs SET state='stopped' WHERE run_id=?").run(runId);expect(delivery.recover()).toEqual([]);expect(existsSync(set.root)).toBe(false);
  });
  it('detects tampering before a fork and preserves the suspect tree rather than deleting it on recovery',async()=>{
    const {set,runId}=await prepare();writeFileSync(entry(set),'tampered');expect(()=>delivery.verify(set)).toThrow();f.sqlite.prepare("UPDATE capability_runs SET state='stopped' WHERE run_id=?").run(runId);expect(delivery.recover()).toContainEqual({runId,code:'HASH_MISMATCH'});expect(existsSync(set.root)).toBe(true);
  });
  it('does not materialize a projection for an unregistered run or another task/project identity',async()=>{
    const selected=await snapshot(),set=delivery.describe(selected,randomUUID(),{mcp:true,cli:false})!;expect(()=>delivery.materialize(set)).toThrow('本次已准备运行');expect(existsSync(set.root)).toBe(false);expect(readdirSync(join(f.store.root,'plugin-skills'))).toEqual([]);
  });
});
