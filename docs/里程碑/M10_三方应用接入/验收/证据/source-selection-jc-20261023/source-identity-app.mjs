// Packaged connection service + native Foxmail reader, synthetic source, no UI claim.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-source-identity-'),home=join(root,'home'),userData=join(root,'userdata'),source=join(root,'source');
await mkdir(home);await mkdir(join(source,'Mail/Inbox'),{recursive:true});
const result={root,startedAt:new Date().toISOString(),layer:'packaged connection IPC and native Foxmail reader; synthetic source; no UI',checks:[]};let app;
const database=join(source,'messages.db');
const create=()=>execFileSync('/usr/bin/sqlite3',[database,'CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);']);
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
try{
 result.asar=await hash(join(dirname(dirname(executable)),'Resources/app.asar'));assert.equal(result.asar,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);create();
 app=await openElectron({executable,userData,env:{HOME:home},inspectMain:true});
 const request={name:'Synthetic source identity',expectedRevision:0,config:{kind:'foxmail',sourcePath:source,account:'fixture-mailbox',queryDays:30}};
 const save=async input=>{const tested=await app.invoke('applications.testConnection',input);assert(tested.ok,JSON.stringify(tested));const c=tested.value;const saved=await app.invoke('applications.saveConnection','mail',c.operationId,c.candidateHash,c.compatibility.planHash);assert(saved.ok,JSON.stringify(saved));return saved.value;};
 const original=await save(request);assert.equal(original.hasSecret,false);result.original=original;
 const before=await app.invoke('applications.connections','mail');assert(before.ok);
 const project=await app.invoke('projects.create',{name:'Source identity fixture',aliases:[],description:'Private source binding checks',rulesPath:null},[{label:'fixture',path:source}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(row=>row.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 const selection=await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:original.id,smtp:null}});assert(selection.ok,JSON.stringify(selection));
 const originalSettings=await app.invoke('applications.projectSettings',project.id,'mail');assert(originalSettings.ok);assert.equal(originalSettings.value.connections.foxmail,original.id);

 await rename(database,join(source,'retained-original.fixture'));create();const originalHash=await hash(join(source,'retained-original.fixture')),replacementHash=await hash(database);
 const rejected=await app.invoke('applications.testConnection',{...request,id:original.id,expectedRevision:original.revision});assert.equal(rejected.ok,false);assert.equal(rejected.code,'IDENTITY_CHANGE_REQUIRES_SELECTION',JSON.stringify(rejected));
 assert.deepEqual(await app.invoke('applications.connections','mail'),before);result.checks.push('Same path replacement rejects old connection update and preserves original saved identity');
 const replacement=await save({...request,name:'Explicit replacement source'});assert.notEqual(replacement.id,original.id);assert.notEqual(replacement.identity.serviceId,original.identity.serviceId);assert.equal(replacement.identity.accountId,original.identity.accountId);
 const after=await app.invoke('applications.connections','mail');assert(after.ok);assert.equal(after.value.length,2);assert.deepEqual(after.value.find(c=>c.id===original.id),original);result.replacement=replacement;
 assert.equal(await hash(join(source,'retained-original.fixture')),originalHash);assert.equal(await hash(database),replacementHash);result.checks.push('Explicit new connection has distinct source identity; original record and both source database bytes retained');
 assert.deepEqual(await app.invoke('applications.projectSettings',project.id,'mail'),originalSettings);result.checks.push('Creating the replacement connection never silently rebinds the project');
 const switched=await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:originalSettings.value.revision,connections:{foxmail:replacement.id,smtp:null}});assert(switched.ok,JSON.stringify(switched));
 const selected=await app.invoke('applications.projectSettings',project.id,'mail');assert(selected.ok);assert.equal(selected.value.connections.foxmail,replacement.id);assert(selected.value.revision>originalSettings.value.revision);
 const stale=await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:originalSettings.value.revision,connections:{foxmail:original.id,smtp:null}});assert.equal(stale.ok,false);assert.equal(stale.code,'REVISION_CONFLICT');assert.deepEqual(await app.invoke('applications.projectSettings',project.id,'mail'),selected);
 assert.deepEqual(await app.invoke('applications.connections','mail'),after);result.selected=selected.value;result.checks.push('Explicit selection changes the binding; stale selection cannot undo it and old connection remains intact');
 await writeFile(join(root,'before-restart.log'),app.logs());
 await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;
 app=await openElectron({executable,userData,env:{HOME:home},inspectMain:true});
 assert.deepEqual(await app.invoke('applications.projectSettings',project.id,'mail'),selected);assert.deepEqual(await app.invoke('applications.connections','mail'),after);
 assert.equal(await hash(join(source,'retained-original.fixture')),originalHash);assert.equal(await hash(database),replacementHash);result.checks.push('Normal App quit and restart retain explicit project selection, both connections and source bytes');
 result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'app.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
