import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,expect,it} from 'vitest';
import * as schema from '../../../db/schema';
import {runBundledMigrations} from '../../../db/migrations';
import {SecretsStore} from '../../../secrets';
import {ResourceStore} from '../resource-store';
import {ApplicationConnectionService} from '../connection-service';
import {BuiltinPluginPreferences} from '../builtin-plugin-preferences';
import type {ConnectionConfig} from '@shared/application-connections';
import type {BuiltinPluginId} from '@shared/builtin-plugin-preferences';
let root:string,sql:Database.Database,prefs:BuiltinPluginPreferences,connections:ApplicationConnectionService,secrets:SecretsStore;
const state=(projectId:string,appId:BuiltinPluginId='mail')=>prefs.project(appId,projectId);
const project=(id:string)=>sql.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,id);
async function create(name:string,kind:'foxmail'|'smtp'='foxmail'){
 const config:ConnectionConfig=kind==='foxmail'?{kind,sourcePath:join(root,name),account:name+'@example.test',queryDays:30}:{kind,host:'127.0.0.1',port:2525,username:name,fromAddress:name+'@example.test',authMode:'password',mode:'plain'};
 const candidate=await connections.testCandidate({expectedRevision:0,name,config,...(kind==='smtp'?{secret:'PUBLIC_SOFTWARE_SECRET_'+name}:{})});return connections.commitCandidate(candidate.operationId,candidate.candidateHash);
}
async function select(projectId:string,slot:'foxmail'|'smtp',mode:'follow'|'individual',connectionId?:string,enabled=true){const p=state(projectId);return prefs.setProject({appId:'mail',projectId,enabled,expectedRevision:p.binding_revision,slots:Object.fromEntries(p.slots.map(s=>[s.id,s.id===slot?{mode,...(connectionId?{connectionId}:{})}:{mode:s.mode,...(s.mode==='individual'&&s.connectionId?{connectionId:s.connectionId}:{})}]))});}
const selected=(id:string,slot='foxmail')=>state(id).slots.find(s=>s.id===slot)!;
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),'willyou-m13-builtin-prefs-'));sql=new Database(join(root,'state.sqlite'));sql.pragma('foreign_keys=ON');runBundledMigrations(sql);for(const id of ['p1','p2','p3'])project(id);
 // Software storage boundary only, not macOS keychain acceptance.
 secrets=new SecretsStore(drizzle(sql,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('test:'+s.split('').reverse().join('')),decrypt:b=>b.toString().slice(5).split('').reverse().join('')});
 const store=new ResourceStore(sql,root);connections=new ApplicationConnectionService(store,secrets,{verify:async c=>({providerId:c.kind,serviceId:'fixture-'+c.kind,accountId:c.kind==='foxmail'?c.account:c.kind==='smtp'?c.fromAddress:'fixture',contractMajor:1})},1000,undefined,undefined,{committed:(id,created)=>prefs.connectionSaved(id,created)});prefs=new BuiltinPluginPreferences(store,connections,secrets);prefs.initialize();
});
afterEach(()=>{sql.close();rmSync(root,{recursive:true,force:true});});
it('initializes both builtins for existing and new projects without inventing browser connections or rewriting explicit off',()=>{
 expect(state('p1','browser')).toMatchObject({enabled:1,slots:[]});expect(state('p1').slots.map(s=>s.mode)).toEqual(['follow','follow']);sql.prepare("UPDATE application_project_settings SET enabled=0 WHERE project_id='p1' AND app_id='browser'").run();sql.prepare("UPDATE application_catalog_state SET added=0,enabled=0 WHERE app_id='mail'").run();project('p4');prefs.initialize('p4');prefs.initialize();expect(state('p1','browser').enabled).toBe(0);expect(state('p4','browser').enabled).toBe(1);expect(sql.prepare("SELECT added,enabled FROM application_catalog_state WHERE app_id='mail'").get()).toEqual({added:1,enabled:0});expect(prefs.list('browser').slots).toEqual([]);expect(sql.pragma('foreign_key_check')).toEqual([]);
});
it('atomically makes first read/send connections separate defaults and never lets a second connection take either over',async()=>{
 const a=await create('A'),smtp=await create('SenderA','smtp');await create('B');await create('SenderB','smtp');for(const id of ['p1','p2','p3']){expect(selected(id).connectionId).toBe(a.id);expect(selected(id,'smtp').connectionId).toBe(smtp.id);}expect(prefs.list('mail').slots.map(s=>s.connection_id)).toEqual([a.id,smtp.id]);expect(sql.pragma('foreign_key_check')).toEqual([]);
});
it('distinguishes individual A from follow A, excludes closed projects from default impact, and preserves the SMTP slot',async()=>{
 const a=await create('A'),b=await create('B'),smtp=await create('Sender','smtp');await select('p2','foxmail','individual',a.id);await select('p3','foxmail','follow',undefined,false);const plan=prefs.planDefault({appId:'mail',slot:'foxmail',connectionId:b.id});expect(plan.synchronized.map(p=>p.id)).toEqual(['p1']);expect(plan.unchanged.map(p=>p.id)).toEqual(['p2']);await prefs.setDefault({appId:'mail',slot:'foxmail',connectionId:b.id,planHash:plan.planHash});expect(selected('p1').connectionId).toBe(b.id);expect(selected('p2')).toMatchObject({mode:'individual',connectionId:a.id});expect(selected('p3').connectionId).toBe(a.id);await select('p3','foxmail','follow');expect(selected('p3').connectionId).toBe(b.id);for(const id of ['p1','p2','p3'])expect(selected(id,'smtp').connectionId).toBe(smtp.id);
});
it('rejects stale default plans and cross-slot targets without partial writes',async()=>{
 const a=await create('A'),b=await create('B'),s=await create('Sender','smtp');const plan=prefs.planDefault({appId:'mail',slot:'foxmail',connectionId:b.id});await select('p2','foxmail','individual',a.id);await expect(prefs.setDefault({appId:'mail',slot:'foxmail',connectionId:b.id,planHash:plan.planHash})).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});expect(selected('p1').connectionId).toBe(a.id);expect(()=>prefs.planDefault({appId:'mail',slot:'foxmail',connectionId:s.id})).toThrow();await expect(prefs.setProject({appId:'mail',projectId:'p1',expectedRevision:state('p1').binding_revision,enabled:true,slots:{foxmail:{mode:'individual',connectionId:s.id},smtp:{mode:'follow'}}})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(selected('p1').connectionId).toBe(a.id);
});
it('requires replacement before deleting a default, moves individual projects to follow, and deletes only that slot and its credentials',async()=>{
 const a=await create('SenderA','smtp'),b=await create('SenderB','smtp'),read=await create('Reader');await select('p2','smtp','individual',a.id);expect(()=>prefs.planDelete({appId:'mail',connectionId:a.id})).toThrow();const plan=prefs.planDelete({appId:'mail',connectionId:a.id,replacementId:b.id});expect(plan.individual.map(p=>p.id)).toEqual(['p2']);await prefs.delete({appId:'mail',connectionId:a.id,replacementId:b.id,planHash:plan.planHash});expect(connections.list('mail').some(c=>c.id===a.id)).toBe(false);for(const id of ['p1','p2','p3']){expect(selected(id,'smtp')).toMatchObject({mode:'follow',connectionId:b.id});expect(selected(id).connectionId).toBe(read.id);}expect(sql.pragma('foreign_key_check')).toEqual([]);
});
it('uses a live run binding for deletion even when project selection changed, and releases it only at terminal state',async()=>{
 const a=await create('A'),b=await create('B');const runBinding=prefs.capture('p1');await select('p1','foxmail','individual',b.id);
 sql.prepare("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES('task',0,'{}',?,'now','history-unknown','hold')").run('a'.repeat(64));
 sql.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,bindings_json,binding_mode) VALUES('run','task','p1','codex','active','now',?,'run')").run(JSON.stringify(runBinding));
 const plan=prefs.planDelete({appId:'mail',connectionId:a.id,replacementId:b.id});expect(plan.running.map(r=>r.runId)).toEqual(['run']);await expect(prefs.delete({appId:'mail',connectionId:a.id,replacementId:b.id,planHash:plan.planHash})).rejects.toMatchObject({code:'RESOURCE_BUSY'});sql.prepare("UPDATE capability_runs SET state='stopped' WHERE run_id='run'").run();expect(prefs.planDelete({appId:'mail',connectionId:a.id,replacementId:b.id}).running).toEqual([]);
});
it('rejects stale project writes, keeps browser connectionless, and keeps configuration available after deleting the only connection',async()=>{
 const a=await create('A');await expect(prefs.setProject({appId:'mail',projectId:'p1',expectedRevision:999,enabled:false,slots:{foxmail:{mode:'follow'},smtp:{mode:'follow'}}})).rejects.toMatchObject({code:'REVISION_CONFLICT'});const browser=state('p1','browser');await prefs.setProject({appId:'browser',projectId:'p1',enabled:false,expectedRevision:browser.binding_revision,slots:{}});expect(state('p1','browser').enabled).toBe(0);const plan=prefs.planDelete({appId:'mail',connectionId:a.id});await prefs.delete({appId:'mail',connectionId:a.id,planHash:plan.planHash});expect(selected('p1').connectionId).toBeNull();expect(state('p1').enabled).toBe(1);expect(prefs.list('mail').slots[0].connection_id).toBeNull();
});

it('never captures a disabled project or global builtin as a run connection occupant',async()=>{
 const a=await create('A');expect(prefs.capture('p1').some(b=>b.connectionId===a.id)).toBe(true);await select('p1','foxmail','follow',undefined,false);expect(prefs.capture('p1')).toEqual([]);await select('p1','foxmail','follow');sql.prepare("UPDATE application_catalog_state SET enabled=0 WHERE app_id='mail'").run();expect(prefs.capture('p1')).toEqual([]);
});
