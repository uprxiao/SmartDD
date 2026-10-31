// T13 step 4 analogue on the controlled COPY: saved connection + permission removed on the copy + App reopened on the same data;
// the mail status read must fail visibly (never a successful empty mailbox) and recover after the permission is restored.
// Reads RUN= the userData/copy of a previous real-foxmail-copy-faults-ui run. Real profile untouched. Hashes/ids/counts only.
import assert from 'node:assert/strict';
import {chmod,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP,R=process.env.RUN;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&R?.startsWith('/private/tmp/willyou-m10-rf-copy-'));
const db=join(R,'copy-profile/messages.db'),w=ms=>new Promise(r=>setTimeout(r,ms));
const result={schema:'m10-t13-copy-reopen-v1',startedAt:new Date().toISOString(),run:R,app:executable,checks:[],status:'running'};
const note=n=>{result.checks.push({name:n,at:new Date().toISOString()});console.log('CHECK: '+n);};
let app;const unwrap=v=>{assert(v.ok,JSON.stringify(v).slice(0,300));return v.value;};
const shape=v=>({code:v.code,query:v.value?.query?{complete:v.value.query.complete,items:v.value.query.items.length,matched:v.value.query.matched,hasNext:!!v.value.query.nextCursor}:undefined,ok:v.ok,});
try{
 await mkdir(join(R,'copy-profile/Mail'),{recursive:true});await chmod(db,0o000);
 app=await openElectron({executable,userData:join(R,'userdata'),inspectMain:true});result.appPid=app.processId;
 const [conn]=unwrap(await app.invoke('applications.connections','mail'));assert(conn);
 const project=await app.invoke('projects.create',{name:'T13 reopen '+Date.now(),aliases:[],description:'copy faults',rulesPath:null});
 const settings=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));
 unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:settings.revision,connections:{foxmail:conn.id,smtp:null}}));
 note('App reopened on the saved copy connection; project selection created');
 const denied=await app.invoke('applications.mailStatus',project.id,{limit:1,refresh:true});result.denied=shape(denied);console.log('DENIED',JSON.stringify(result.denied));
 const emptySuccess=denied.ok&&denied.value?.complete===true&&(denied.value?.items?.length??0)===0&&!denied.value?.error&&!(denied.value?.problems?.length);
 assert(!emptySuccess,'An unreadable source must never read as a complete empty mailbox');
 assert(!(denied.ok&&denied.value?.complete===true&&(denied.value.items?.length??0)>0),'Unreadable source must not return fresh complete items');
 note('Unreadable saved source after reopen is not a complete empty/fresh result: '+JSON.stringify(result.denied));
 await chmod(db,0o600);await w(500);
 const back=await app.invoke('applications.mailStatus',project.id,{limit:1,refresh:true});result.restored=shape(back);console.log('RESTORED',JSON.stringify(result.restored));
 assert(back.ok&&!back.value?.error&&back.value?.query&&Array.isArray(back.value.query.items),'After restoring the permission a refresh reads the source again (copy has no downloaded .mail bodies, so partial is expected)');
 note('After permission restored the next refresh reads mail again: '+JSON.stringify(result.restored));
 result.status='passed-copy-reopen';
}catch(e){result.status='failed';result.error=String(e);console.log('FAILED: '+e);process.exitCode=1;}
finally{try{await chmod(db,0o600);}catch{}result.finishedAt=new Date().toISOString();await writeFile(join(R,'reopen-result.json'),JSON.stringify(result,null,2));console.log('RESULT: '+result.status);try{process.kill(result.appPid,'SIGTERM');}catch{}}
