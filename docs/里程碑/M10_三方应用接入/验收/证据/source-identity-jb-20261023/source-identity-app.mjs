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
 await rename(database,join(source,'retained-original.fixture'));create();const originalHash=await hash(join(source,'retained-original.fixture')),replacementHash=await hash(database);
 const rejected=await app.invoke('applications.testConnection',{...request,id:original.id,expectedRevision:original.revision});assert.equal(rejected.ok,false);assert.equal(rejected.code,'IDENTITY_CHANGE_REQUIRES_SELECTION',JSON.stringify(rejected));
 assert.deepEqual(await app.invoke('applications.connections','mail'),before);result.checks.push('Same path replacement rejects old connection update and preserves original saved identity');
 const replacement=await save({...request,name:'Explicit replacement source'});assert.notEqual(replacement.id,original.id);assert.notEqual(replacement.identity.serviceId,original.identity.serviceId);assert.equal(replacement.identity.accountId,original.identity.accountId);
 const after=await app.invoke('applications.connections','mail');assert(after.ok);assert.equal(after.value.length,2);assert.deepEqual(after.value.find(c=>c.id===original.id),original);result.replacement=replacement;
 assert.equal(await hash(join(source,'retained-original.fixture')),originalHash);assert.equal(await hash(database),replacementHash);result.checks.push('Explicit new connection has distinct source identity; original record and both source database bytes retained');
 result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'app.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
