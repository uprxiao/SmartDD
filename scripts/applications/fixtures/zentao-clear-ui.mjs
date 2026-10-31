// PP / P04 only. Synthetic metadata has no secret and proves no provider authentication.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export async function seedZenTaoClear({app,root,userData,projectId}){
 assert(root.startsWith('/private/tmp/willyou-m10-project-state-')&&userData===join(root,'userdata'));
 const other=await app.invoke('projects.create',{name:'PP 独立项目 B',aliases:[],description:'Shared synthetic connection protection;no credentials',rulesPath:null});
 const id=randomUUID(),name='PP 合成共享禅道 C',at=new Date().toISOString();
 const config={kind:'zentao',baseUrl:'https://pp.example.invalid/',username:'synthetic-pp',authMode:'token'};
 const identity={providerId:'zentao',serviceId:'synthetic-pp',accountId:'synthetic-pp',contractMajor:1};
 const canonical=o=>JSON.stringify(o,Object.keys(o).sort()),q=v=>typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const hash=createHash('sha256').update(canonical(identity)).digest('hex');
 execFileSync('/usr/bin/sqlite3',[join(userData,'smartdd.db'),`INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES(${[id,'zentao','zentao',name,canonical(config),1,1,1,canonical(identity),hash,0,1,1,'connected','unverified',at,at].map(q).join(',')})`]);
 for(const p of [projectId,other.id]){const s=await app.invoke('applications.projectSettings',p,'zentao');assert(s.ok);assert((await app.invoke('applications.select',{projectId:p,appId:'zentao',enabled:true,expectedRevision:s.value.revision,connections:{zentao:id}})).ok);}
 return{connectionId:id,connectionName:name,otherProjectId:other.id,boundary:'Synthetic connection metadata,secret_ref NULL/secret_revision 0;no credentials/auth/provider/Agent;only non-tested prerequisite seeded'};
}

export async function checkZenTaoClear({app,layer,theme,root,projectId,seed,click,key,state,facts,note}){
 const prefix='.m10-project-application:has(.m10-appmark.zentao)',none=prefix+' input[aria-label="禅道连接不选用"]',chosen=prefix+' .m10-project-connections label:nth-child(2) input';
 const read=()=>layer==='P'?state():facts();
 const checked=(selector,value)=>`document.querySelector(${JSON.stringify(selector)})?.checked===${value}&&!document.querySelector(${JSON.stringify(selector)}).disabled`;
 await app.waitFor(checked(chosen,true)+'&&'+checked(none,false));const before=await read();
 await click(none);await app.waitFor('!!document.querySelector("dialog[open]")');await app.waitFor('document.querySelector("dialog h2")?.textContent==="切换项目禅道连接"');
 assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify(chosen)}).checked`),true);
 assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify(none)}).checked`),false);
 assert((await app.evaluate('document.querySelector("dialog").textContent')).includes('→ 不选用'));assert.deepEqual(await read(),before);
 await app.screenshot(join(root,theme+'-none-preview.png'));await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog")');await app.waitFor(`document.activeElement===document.querySelector(${JSON.stringify(none)})`);
 assert.deepEqual(await read(),before);note(theme+' no-selection preview and Escape retain original source/all facts;focus returns to its exact radio');
 await click(none);await app.waitFor('!!document.querySelector("dialog[open]")');
 const confirmation=layer==='P'?'切换连接 · 模拟':'切换连接';
 await app.waitFor(`Array.from(document.querySelectorAll('dialog footer button')).some(e=>e.textContent.trim()===${JSON.stringify(confirmation)}&&!e.disabled)`);
 await click('dialog footer button',confirmation);await app.waitFor('!document.querySelector("dialog")');await app.waitFor(checked(none,true)+'&&'+checked(chosen,false));
 const cleared=await read();
 if(layer==='P'){
  assert(!cleared.bindings[projectId].some(id=>cleared.connections.find(c=>c.id===id)?.app==='zentao'));
  const stable=({bindings,...rest})=>rest;assert.deepEqual(stable(cleared),stable(before));assert.deepEqual(cleared.bindings.smartdd,before.bindings.smartdd);assert.deepEqual(cleared.bindings[projectId],before.bindings[projectId].filter(id=>before.connections.find(c=>c.id===id)?.app!=='zentao'));
 }else{
  assert(!cleared.application_project_bindings.some(v=>v.project_id===projectId&&v.app_id==='zentao'));
  assert.deepEqual(cleared.application_connections,before.application_connections);
  for(const table of Object.keys(before))if(!['application_project_settings','application_project_bindings'].includes(table))assert.deepEqual(cleared[table],before[table]);
  assert.deepEqual(cleared.application_project_bindings.filter(v=>v.project_id!==projectId||v.app_id!=='zentao'),before.application_project_bindings.filter(v=>v.project_id!==projectId||v.app_id!=='zentao'));
  for(const v of before.application_project_settings){const n=cleared.application_project_settings.find(x=>x.project_id===v.project_id&&x.app_id===v.app_id);if(v.project_id===projectId&&v.app_id==='zentao'){assert.equal(n.enabled,1);assert.equal(n.policy_revision,v.policy_revision);assert.equal(n.binding_revision,v.binding_revision+1);assert.equal(n.pending_operation_id,null);}else assert.deepEqual(n,v);}
 }
 assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify(prefix+' [role=switch]')}).getAttribute('aria-checked')`),'true');await app.screenshot(join(root,theme+'-none-committed.png'));
 await click(chosen);await app.waitFor(checked(chosen,true)+'&&'+checked(none,false));assert.equal(await app.evaluate('!!document.querySelector("dialog")'),false);const restored=await read();
 if(layer==='P'){const normalize=x=>({...x,bindings:{...x.bindings,[projectId]:[...x.bindings[projectId]].sort()}});assert.deepEqual(normalize(restored),normalize(before));}
 else{
  const binding=restored.application_project_bindings.find(v=>v.project_id===projectId&&v.app_id==='zentao');assert.equal(binding.connection_id,seed.connectionId);assert.equal(binding.identity_revision,1);
  for(const table of Object.keys(before))if(!['application_project_settings','application_project_bindings'].includes(table))assert.deepEqual(restored[table],before[table]);
  assert.deepEqual(restored.application_project_bindings.filter(v=>v.project_id!==projectId||v.app_id!=='zentao'),before.application_project_bindings.filter(v=>v.project_id!==projectId||v.app_id!=='zentao'));
  const old=before.application_project_bindings.find(v=>v.project_id===projectId&&v.app_id==='zentao');for(const k of Object.keys(old))if(!['created_at','updated_at'].includes(k))assert.deepEqual(binding[k],old[k]);
  for(const v of before.application_project_settings){const n=restored.application_project_settings.find(x=>x.project_id===v.project_id&&x.app_id===v.app_id);if(v.project_id===projectId&&v.app_id==='zentao'){assert.equal(n.enabled,1);assert.equal(n.policy_revision,v.policy_revision);assert.equal(n.binding_revision,v.binding_revision+2);assert.equal(n.pending_operation_id,null);}else assert.deepEqual(n,v);}
 }
 await app.screenshot(join(root,theme+'-explicitly-reselected.png'));note(theme+' confirmed clear affects only A ZenTao binding,keeps enablement/Mail/shared C/B;explicit reselect uses no old-source dialog,original identity retained');
}
