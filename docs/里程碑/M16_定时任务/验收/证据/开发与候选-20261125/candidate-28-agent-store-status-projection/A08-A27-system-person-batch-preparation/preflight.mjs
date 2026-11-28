// Static only. No App, native CLI, listener, system setting, or process probe.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,writeFileSync,chmodSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ROOT,REPO,hash,verifyPins,parseArgs,GROUP_FLAGS} from './pins.mjs';
import {allowedMarkers,classifyTimingInput} from './timing-model-fixture.mjs';
import {atMinutes,localTime,utcOnce,wallSkew,naturalWaitBudget,assertZoneOnly,observedResumeProof} from './clock-contract.mjs';
const cases=[],pass=name=>cases.push(name),reject=(name,fn)=>{assert.throws(fn);pass(name)};
const sys=verifyPins();
const doc=path.join(REPO,'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125');
const oldRoot=path.join(doc,'candidate-21-scoped-home/A08-user-deferred-system-zone');
const indexPath=path.join(oldRoot,'A08-C21-user-deferred-system-zone-evidence-index.json');
const index=JSON.parse(readFileSync(indexPath,'utf8'));
let oldFileCount=0;for(const r of index.files)for(const f of r.files){const p=path.join(oldRoot,r.root,f.file);assert.equal(hash(p),f.sha256);assert.equal(statSync(p).size,f.size);oldFileCount++;}
assert(index.priorDriverFailure.noOccurrence&&index.priorDriverFailure.normalExit0&&index.actualResume.userExplicitlyDeferredTimezone&&index.actualResume.actualFinalMarker==='WY_M16_ZONE_801_FIRST_ANSWER');
pass('archived C21 original failure and natural first occurrence all evidence hashes');
const initial=path.join(oldRoot,'a08-a27-c21-system-DhQi24/driver.snapshot.mjs'),resume=path.join(oldRoot,'a08-a27-c21-system-resume-Ek4zXg/driver.snapshot.mjs');
const priorFixture=path.join(doc,'candidate-21-scoped-home/A51-system-notification-remainder/a51-c21-local-model-fixture.ts');
assert.equal(hash(priorFixture),'325b5439662d6cd8b7f5cff4ff4cbf8f3a96198281f4b78e29d98da17cee1e2a');
const oldFixture=readFileSync(priorFixture,'utf8'),newFixture=readFileSync(path.join(ROOT,'timing-model-fixture.mjs'),'utf8');
const exactSSE=oldFixture.slice(oldFixture.indexOf('function respondCodex('),oldFixture.indexOf('function respondCodexTool(')).replace('res:ServerResponse, model:string,answer:string','res, model,answer').replace('(type:string,payload:unknown)','(type,payload)').replace('...(payload as object)','...payload');
assert(newFixture.includes(exactSSE));pass('same-candidate C21 companion real generative SSE preserved, no fabricated original A08 fixture pin');
for(const [g,flag] of Object.entries(GROUP_FLAGS)){assert.deepEqual(parseArgs(['--run-approved','--group',g,flag]),{group:g,preflightOnly:false});pass('exact person group '+g);}
reject('no implicit system authorization',()=>parseArgs(['--run-approved','--group','A08-zone']));
reject('mismatched separate personal operation',()=>parseArgs(['--run-approved','--group','A27-sleep',GROUP_FLAGS['A27-clock']]));
reject('no extra arbitrary executable path',()=>parseArgs(['--run-approved','--group','A08-zone',GROUP_FLAGS['A08-zone'],'--app','/Applications/WillYou.app']));
assert.equal(parseArgs(['--preflight-only']).preflightOnly,true);
for(const [g,markers] of Object.entries(allowedMarkers))for(const marker of markers){const value=classifyTimingInput({model:'m16-codex-one',input:[{type:'message',content:marker}]},g);assert.equal(value.answer,marker+'_ANSWER');assert.equal(value.marker,marker);pass('archived generic dedicated marker '+marker);}
assert(classifyTimingInput({model:'m16-codex-one',input:'Call the wy_ping tool exactly once.',tools:[{name:'wy_ping'}]},'A08-zone').probe);pass('original actual provider probe request shape');
reject('reject other case marker',()=>classifyTimingInput({model:'m16-codex-one',input:'WY_M16_MAIL_47_FIRST'},'A08-zone'));
reject('reject mixed group marker',()=>classifyTimingInput({model:'m16-codex-one',input:'WY_M16_ZONE_801_FIRST WY_M16_SLEEP_271_FIRST'},'A08-zone'));
reject('reject actual external model id',()=>classifyTimingInput({model:'not-fixture',input:'test'},'A08-zone'));
const due=Date.parse(index.priorDriverFailure.actualDueUtc),oldTimeout=Date.parse(index.priorDriverFailure.rawDriverTimeoutUtc);
assert(due-oldTimeout===2395);const oldStart=oldTimeout-200000;assert.equal(naturalWaitBudget(oldStart,due),292395);pass('preserved exact C21 early-200s failure input corrected to due+90s');
assert.equal(localTime(due,-480),localTime(due+3600000,-420));assert.equal(new Date(utcOnce(due).date+'T'+utcOnce(due).time+':00Z').getTime(),due);pass('same actual wall after -1h zone shift, fixed UTC once math');
const before={wall:due-120000,mono:0,zone:'Asia/Singapore',offset:-480,events:[]},after={wall:before.wall+1000,mono:1000,zone:'Asia/Bangkok',offset:-420,events:[]};
assertZoneOnly(before,after,before);reject('zone change cannot hide absolute wall jump',()=>assertZoneOnly(before,{...after,wall:after.wall+60000},before));
const su={kind:'suspend',wall:due-100000},re={kind:'resume',wall:due+30000},inside={due,claimedAt:re.wall,startedAt:re.wall+1000,status:'completed',taskId:'fixture-task',turnId:'fixture-turn'},outside={due,claimedAt:re.wall,status:'skipped',taskId:null,turnId:null};
observedResumeProof(su,re,due,inside,outside);pass('offline actual sleep/wake receipt contract shape');
reject('display lock/no suspend is not actual sleep',()=>observedResumeProof({...su,kind:'lock'},re,due,inside,outside));
reject('sleep must cover real due',()=>observedResumeProof(su,{...re,wall:due-1},due,inside,outside));
reject('no phantom claim during actual sleep',()=>observedResumeProof(su,re,due,{...inside,claimedAt:due+1000},outside));
reject('no phantom task outside grace',()=>observedResumeProof(su,re,due,inside,{...outside,taskId:'phantom'}));
const forward={wall:before.wall+300000,mono:0,zone:before.zone},restored={wall:before.wall+20000,mono:20000,zone:before.zone};
assert(wallSkew(before,forward)>60000&&Math.abs(wallSkew(before,restored))<15000&&restored.wall<due);pass('forward/recross arithmetic; no system clock changed');
const driver=readFileSync(path.join(ROOT,'driver.mjs'),'utf8'),original=readFileSync(initial,'utf8');
for(const [a,z] of [['const field=','async function quit()'],['function taskRow','async function mount()'],['async function captureClock','async function handoff']]){
 assert.equal(driver.slice(driver.indexOf(a),driver.indexOf(z)),original.slice(original.indexOf(a),original.indexOf(z)),a);
}
assert(driver.includes('await app.invoke(\'agents.customToolPath\',\'codex\',CLI)')&&driver.includes('actualMockKeychain,false')&&driver.includes("process.env.TZ!==undefined"));
assert(driver.includes("E.powerMonitor.on('suspend',s.suspend)")&&driver.includes("E.powerMonitor.on('resume',s.resume)")&&driver.includes("E.powerMonitor.removeListener('resume',s.resume)"));
assert(!/\bsystemsetup\b|\bpmset\b|\bosascript\b|\bsettimeofday\b|\bclock_settime\b|powerMonitor\.emit|Date\.now\s*=/.test(driver));
assert(driver.includes("markRestore('zone',original)")&&driver.includes("markRestore('clock',baseline)")&&driver.includes("PERSON-RESTORATION-REQUIRED")&&driver.includes("process.exitCode=1"));
const ui=readFileSync(path.join(REPO,'src/renderer/features/schedules/workspace.tsx'),'utf8');
for(const t of ['计划名称','提示词','项目目录','间隔（分钟）','宽限期','保存后启用','暂停','schedule-form','schedule-heading'])assert(ui.includes(t),t);
const production=readFileSync(path.join(REPO,'src/main/index.ts'),'utf8');assert(production.includes("powerMonitor.on('resume',()=>schedules.tick('resume'))"));pass('current real C28 routes and original UI workflow/observer static source preserved');
const files=['driver.mjs','pins.mjs','clock-contract.mjs','timing-model-fixture.mjs','preflight.mjs','cleanup-observe.py','../own_scope_native_diagnostic.py','../scope_mismatch_diagnostics.py','../closure_contract.py','../coalition_accounting.py','../cpu_collector.py'];
const actualR6=JSON.parse(readFileSync(path.join(ROOT,'../cohort-hXXlEt/prepared.json'),'utf8'));for(const f of files.filter(f=>f.startsWith('../')))assert.equal(hash(path.join(ROOT,f)),actualR6.sourcePins[f.slice(3)]);
for(const f of files.filter(f=>f.endsWith('.mjs')))execFileSync(process.execPath,['--check',path.join(ROOT,f)],{stdio:'pipe',timeout:10000});
execFileSync('/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',['-c','import ast,sys; ast.parse(open(sys.argv[1]).read())',path.join(ROOT,'cleanup-observe.py')],{stdio:'pipe',timeout:10000});
const expr=JSON.parse(execFileSync(process.execPath,[path.join(REPO,'scripts/lib/check-cdp-expressions.mjs'),path.join(ROOT,'driver.mjs')],{cwd:REPO,encoding:'utf8',timeout:30000}));assert.equal(expr.failures,0);assert.equal(expr.executed,false);
const launch=JSON.parse(execFileSync(process.execPath,[path.join(ROOT,'driver.mjs'),'--preflight-only'],{encoding:'utf8',timeout:60000}));assert.deepEqual(launch.systemPins,sys);assert(!launch.actualAppLaunched&&!launch.actualCliExecuted&&!launch.systemSettingsChanged);
const result={schema:'A08-A27-C28-recovered-system-driver-static-v1',staticOnly:true,actualAppLaunched:false,actualCliExecuted:false,actualSystemChange:false,systemPins:sys,sourcePins:Object.fromEntries(files.map(f=>[f,hash(path.join(ROOT,f))])),originalC21:{indexSha256:hash(indexPath),initialDriverSha256:hash(initial),resumeDriverSha256:hash(resume),archivedIndividualFilesChecked:oldFileCount,priorActualFixtureDirectHashUnavailable:true,companionFixtureSha256:hash(priorFixture),actualNaturalReceipt:index.actualResume.actualFinalMarker,actualPersonalSDeferred:true},cases,cdpLiteralCheck:expr,boundary:'No actual system setting, App, target native CLI, listener, or model. Actual person authorizations and restoration still needed; original C21 A08/A27 S never claimed passed.'};
const out=path.join(ROOT,'preflight.json');writeFileSync(out,JSON.stringify(result,null,2)+'\n',{mode:0o600});chmodSync(out,0o600);
console.log(JSON.stringify({preflight:out,sha256:hash(out),cases:cases.length,originalFiles:oldFileCount,sourcePins:Object.keys(result.sourcePins).length,actualAppLaunched:false,actualCliExecuted:false,actualSystemChange:false}));
