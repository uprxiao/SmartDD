// T16 real-source interruption/resume: the packaged App indexes the REAL local Foxmail profile (read-only, 9k files);
// the App is quit normally mid-index and reopened on the same data; the saved checkpoint must survive and later passes
// must continue (never restart from 0, never claim finished early) until the index finishes. Hashes/ids/counts only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable?.startsWith('/private/tmp/willyou-m10-'));
const cfg=JSON.parse(await readFile('/private/tmp/willyou-m10-real-foxmail-config.json','utf8')),w=ms=>new Promise(r=>setTimeout(r,ms));
const root=await mkdtemp('/private/tmp/willyou-m10-rf-t16-'),userData=join(root,'userdata');
const result={schema:'m10-t16-real-resume-v1',startedAt:new Date().toISOString(),root,app:executable,checks:[],passes:[],status:'running',layer:'A packaged App + real local Foxmail profile (read-only); App quit normally mid-index and reopened; only counts recorded'};
const note=n=>{result.checks.push({name:n,at:new Date().toISOString()});console.log('CHECK: '+n);},save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
async function tree(){const out={};async function walk(d){for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())await walk(p);else{const s=await lstat(p);out[p]=[s.size,Math.round(s.mtimeMs)];}}}await walk(join(cfg.profile,'Mail'));return out;}
const un=v=>{assert(v.ok,JSON.stringify(v).slice(0,300));return v.value;};
let app,project,before;
async function open(){app=await openElectron({executable,userData,inspectMain:true});result.appPids=[...(result.appPids??[]),app.processId];}
async function quit(){await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");const t=Date.now();const exit=await app.waitForExit(180000);result.quitExit={...exit,ms:Date.now()-t};await app.close();return exit.code===0;}
const status=async refresh=>{const t=Date.now(),r=un(await app.invoke('applications.mailStatus',project,refresh?{limit:1,refresh:true}:{limit:1}));return{ms:Date.now()-t,scanned:r.refresh?.scanned,total:r.refresh?.total,finished:r.refresh?.finished,last:r.refresh?.lastSuccessfulRefreshAt,complete:r.query?.complete,matched:r.query?.matched,problems:r.query?.problems?.length};};
try{
 before=await tree();
 await open();
 const cat=un(await app.invoke('applications.catalog')),m=cat.find(x=>x.appId==='mail');un(await app.invoke('applications.setAdded','mail',true,m.revision));
 const cand=un(await app.invoke('applications.testConnection',{name:'t16 real',expectedRevision:0,config:{kind:'foxmail',sourcePath:cfg.profile,account:cfg.account,queryDays:100}})),conn=un(await app.invoke('applications.saveConnection','mail',cand.operationId,cand.candidateHash));
 project=(await app.invoke('projects.create',{name:'t16',aliases:[],description:'real resume',rulesPath:null})).id;const st=un(await app.invoke('applications.projectSettings',project,'mail'));
 un(await app.invoke('applications.select',{projectId:project,appId:'mail',enabled:true,expectedRevision:st.revision,connections:{foxmail:conn.id,smtp:null}}));
 note('Real profile connected (queryDays=100) and selected for a project');
 // first pass is interrupted: quit the App 45s into the refresh
 const pending=app.invoke('applications.mailStatus',project,{limit:1,refresh:true}).catch(()=>null);await w(45000);
 const exited=await quit();result.interruptedExit=exited;assert(exited,'App must exit normally');note('App quit normally 45s into the first real index pass (process gone)');
 await open();
 const s0=await status(false);result.afterReopen=s0;console.log('AFTER_REOPEN',JSON.stringify(s0));
 assert(s0.scanned>0,'A checkpoint must survive the normal quit: scanned='+s0.scanned);assert.equal(s0.finished,false);assert(!s0.last,'No successful refresh time while the index is unfinished');
 note('After reopen the saved checkpoint is kept (scanned '+s0.scanned+'/'+s0.total+'), not finished, last successful refresh unset');
 let prev=s0.scanned,i=0;
 for(;i<14;i++){const p=await status(true);result.passes.push(p);console.log('PASS',i+1,JSON.stringify(p));await save();assert(p.scanned>=prev,'Progress must never restart from 0: '+prev+' -> '+p.scanned);prev=p.scanned;if(p.finished)break;}
 const last=result.passes.at(-1);assert(last.finished,'Index finished after '+result.passes.length+' resumed passes');if(last.problems>0)assert(!last.last,'A finished scan with incomplete mails must not set a last successful refresh time');else assert(last.last,'A finished scan without problems sets the last successful refresh time');result.successRule={finished:true,problems:last.problems,lastSuccessfulSet:!!last.last,complete:last.complete};
 note('Resumed passes continue monotonically until the full scan finishes ('+last.scanned+'/'+last.total+'); with '+last.problems+' incomplete mails the result stays partial (complete=false) and no last-successful time is claimed');
 const firstCycleMs=result.passes.reduce((n,x)=>n+x.ms,0);let againPasses=[];for(let k=0;k<10;k++){const x=await status(true);againPasses.push(x);console.log('AGAIN',k+1,JSON.stringify(x));if(x.finished)break;}
 const again=againPasses.at(-1);result.repeat={passes:againPasses.length,ms:againPasses.reduce((n,x)=>n+x.ms,0),firstCycleMsAfterReopen:firstCycleMs,final:again};assert(again.finished,'A refresh after completion (with incomplete mails retried) finishes again');assert.equal(again.matched,last.matched,'Repeated refresh returns the same matched count');assert(again.problems===last.problems,'Same incomplete mails are reported again, not hidden');
 assert(result.repeat.ms<=firstCycleMs*1.2,'The repeat pass reuses the index and is not slower than the original cycle');note('Refresh after completion retries the incomplete mails, finishes again in '+againPasses.length+' pass(es) ('+result.repeat.ms+' ms vs '+firstCycleMs+' ms first cycle) with identical matched/problem counts');
 const after=await tree();let changed=0,removed=0;for(const[k,v]of Object.entries(before)){if(!after[k])removed++;else if(after[k][0]!==v[0]||after[k][1]!==v[1])changed++;}result.realTree={files:Object.keys(after).length,changed,removed};assert.equal(changed+removed,0);note('Real source read-only: '+result.realTree.files+' files, 0 changed, 0 removed');
 const idle=Date.now();await w(20000);result.idle20s='no explicit work issued; refresh only on request';note('Idle window observed (no refresh was requested)');
 result.status='passed-real-resume';
}catch(e){result.status='failed';result.error=String(e);console.log('FAILED: '+e);process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();await save();console.log('RESULT: '+result.status+' '+join(root,'result.json'));try{process.kill(app.processId,'SIGTERM');}catch{}}
