import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDraft, makeRun, nextOccurrence, seedPlans, validateDraft, saveDraft, schedulePreview, permissionsFor, planDate, planStatus, taskConfig, launchDemo, settleDemo, recheckDemo, workspacePath } from '../src/m16-model.mjs';
import { confirmedTurn, defaultRunTab, orderedPlanRuns, runRecord, runResultSummary } from '../src/m16-run-view.mjs';
const projects=[
  {id:'smartdd',dirs:[{id:'git',path:'/workspace/SmartDD',isDefault:true,available:true,vcs:'Git'}]},
  {id:'ais',dirs:[{id:'svn',path:'/workspace/AIS',isDefault:true,available:true,vcs:'SVN'}]},
];
const tasks=[{id:'review',project:'smartdd',runner:'codex',cwd:'/worktree/review',model:'gpt-6.2-sol',permission:'ask'},{id:'other',project:'ais'},{id:'general',project:null,cwd:'/standalone/general',runner:'codex'}];
const now=Date.parse('2026-11-27T03:00:00Z'), MIN=60000;
const base={...defaultDraft(projects,now),name:'日报',prompt:'整理摘要'};
const time={time:'09:00',zone:'Asia/Shanghai'};
const plan=(id='p',patch={})=>saveDraft({...base,...patch},id,null,now);
const launch=(d,p='p',trigger='manual',id='r',t=now,s='due',list=tasks)=>launchDemo(d,p,trigger,id,t,s,projects,list);
const state=(...plans)=>({plans,runs:[],notifications:[]});
test('fixed daily and working-day times use selected zone',()=>{
  assert.equal(nextOccurrence({...time,type:'daily'},now),Date.parse('2026-11-28T01:00:00Z'));
  assert.equal(nextOccurrence({...time,type:'workdays'},now),Date.parse('2026-11-30T01:00:00Z'));
});
test('weekly validates days and interval does not drift from anchor',()=>{
  assert.equal(nextOccurrence({...time,type:'weekly',days:[1,3]},now),Date.parse('2026-11-30T01:00:00Z'));
  assert.equal(nextOccurrence({...time,type:'weekly',days:[]},now),null);
  assert.equal(nextOccurrence({type:'interval',minutes:60},now),now+60*MIN);
  assert.equal(nextOccurrence({type:'interval',minutes:60,anchor:now},now+75*MIN),now+120*MIN);
  assert.equal(nextOccurrence({type:'interval',minutes:0},now),null);
});
test('single time requires a valid future wall time and DST gap rejected',()=>{
  assert.equal(nextOccurrence({...time,type:'once',date:'2026-11-28'},now),Date.parse('2026-11-28T01:00:00Z'));
  assert.equal(nextOccurrence({...time,type:'once',date:'2026-11-25'},now),null);
  assert.equal(nextOccurrence({...time,type:'once',date:'2026-12-32'},now),null);
  assert.equal(nextOccurrence({type:'once',date:'2027-03-14',time:'02:30',zone:'America/New_York'},now),null);
});
test('monthly last / missing day, cron and invalid zone preview match common engine',()=>{
  const first=Date.parse('2027-01-31T10:00:00Z');
  const common={type:'monthly',time:'09:00',zone:'UTC'};
  assert.equal(nextOccurrence({...common,monthDay:31},first),Date.parse('2027-03-31T09:00:00Z'));
  assert.equal(nextOccurrence({...common,monthDay:'last'},first),Date.parse('2027-02-28T09:00:00Z'));
  assert.equal(schedulePreview({type:'cron',cron:'0 9 * * MON-FRI',zone:'UTC'},now).times.length,3);
  assert.ok(schedulePreview({type:'cron',cron:'61 9 * * *',zone:'UTC'},now).error);
  assert.ok(schedulePreview({...common,monthDay:31,zone:'Invalid/Zone'},now).error);
});
test('project optional, no-project local path and file/dir guards',()=>{
  assert.equal(validateDraft(base,projects,tasks,now),'');
  assert.equal(validateDraft({...base,name:''},projects,tasks,now),'请输入计划名称');
  assert.equal(validateDraft({...base,prompt:''},projects,tasks,now),'请输入任务提示词');
  const standalone={...base,projectId:'',dirId:''};
  assert.equal(validateDraft(standalone,projects,tasks,now),'');
  assert.ok(validateDraft({...standalone,standaloneMode:'local',localPath:''},projects,tasks,now));
  assert.equal(validateDraft({...standalone,standaloneMode:'local',localPath:'/work/common'},projects,tasks,now),'');
  assert.ok(validateDraft({...standalone,workspace:'per_run'},projects,tasks,now));
});
test('worktree only Git, dedicated works with reuse, per-run only new',()=>{
  assert.ok(validateDraft({...base,workspace:'dedicated',projectId:'ais',dirId:'svn'},projects,tasks,now).includes('Git'));
  for(const workspace of ['existing','dedicated'])assert.equal(validateDraft({...base,destination:'reuse',workspace},projects,tasks,now),'');
  assert.ok(validateDraft({...base,destination:'reuse',workspace:'per_run'},projects,tasks,now).includes('只能'));
  assert.equal(validateDraft({...base,destination:'new',workspace:'per_run'},projects,tasks,now),'');
});
test('specified task must belong to same scope and uses actual cwd',()=>{
  assert.ok(validateDraft({...base,destination:'existing',taskId:'other'},projects,tasks,now));
  const cfg=taskConfig(tasks[0],projects),draft={...base,destination:'existing',taskId:'review',...cfg};
  assert.equal(validateDraft(draft,projects,tasks,now),'');
  assert.equal(workspacePath(draft,projects),'/worktree/review');
  assert.ok(validateDraft({...draft,workspace:'dedicated'},projects,tasks,now));
  assert.equal(validateDraft({...base,projectId:'',dirId:'',destination:'existing',taskId:'general',...taskConfig(tasks[2],projects)},projects,tasks,now),'');
});
test('executor supported permission tiers only; default ask',()=>{
  assert.equal(base.permission,'ask');
  assert.ok(permissionsFor('cx-sub').some(p=>p.id==='auto'));
  assert.ok(!permissionsFor('cc-sub').some(p=>p.id==='auto'));
  assert.ok(validateDraft({...base,agent:'cc-sub',model:'sonnet',effort:'中',permission:'auto'},projects,tasks,now));
});
test('new vs reused vs existing run identities and worktree snapshot',()=>{
  const p=plan(),d=plan('d',{workspace:'dedicated',destination:'reuse'}),separate=plan('s',{workspace:'per_run'});
  const make=(p,id,status='running')=>makeRun(p,id,'scheduled',now,status,now,projects);
  assert.notEqual(make(p,'one').taskId,make(p,'two').taskId);
  assert.equal(make(d,'one').taskId,make(d,'two').taskId);
  assert.equal(make(d,'one').cwd,make(d,'two').cwd);
  assert.notEqual(make(separate,'one').cwd,make(separate,'two').cwd);
  assert.equal(make(p,'skip','skipped').taskId,null);
});
test('seed records are valid and include no ordinary project for general example',()=>{
  const {plans,runs,reuseTasks}=seedPlans(projects,now);
  assert.equal(plans.length,4);
  for(const p of plans)assert.equal(validateDraft(p,projects,[...tasks,...Object.values(reuseTasks)],now),'',p.name);
  assert.equal(plans.find(p=>p.id==='monthly-common').projectId,'');
  for(const r of runs)assert.ok(plans.some(p=>p.id===r.planId));
});
test('manual while paused preserves schedule anchor and no double run',()=>{
  const p=plan('p',{enabled:false,schedule:{type:'interval',minutes:60,zone:'UTC'}});
  let d=launch(state(p)).data;
  assert.equal(d.runs.length,1);assert.equal(d.plans[0].nextAt,null);
  const res=launch(d,'p','manual','r2');assert.ok(res.hint.includes('前次'));assert.equal(res.data.runs.length,1);
  d=settleDemo(d,'r','stopped',now+1000);assert.equal(planStatus(d.plans[0]),'已暂停');assert.equal(d.plans[0].schedule.anchor,now);
});
test('scheduled overlap records skip, independent plans dispatch',()=>{
  const p=plan(),q=plan('q');let d=launch(state(p,q)).data;
  const second=launch(d,'p','scheduled','skip',p.nextAt);assert.equal(second.data.runs[0].status,'skipped');
  d=launch(second.data,'q','scheduled','q-run',q.nextAt).data;
  assert.equal(d.runs[0].status,'running');assert.notEqual(d.runs[0].taskId,d.runs[2].taskId);
});
test('two plans bound to same task do not enqueue',()=>{
  const cfg=taskConfig(tasks[0],projects),p=plan('p',{destination:'existing',taskId:'review',...cfg}),q=plan('q',{destination:'existing',taskId:'review',...cfg});
  let d=launch(state(p,q)).data;
  d=launch(d,'q','scheduled','skip',q.nextAt).data;assert.equal(d.runs[0].status,'skipped');assert.ok(d.runs[0].reason.includes('绑定任务'));
  assert.equal(launch(d,'q','manual','busy').data.runs.length,2);
});
test('model/effort follow; important config change holds until explicit reconfirmation',()=>{
  const cfg=taskConfig(tasks[0],projects),p=plan('p',{destination:'existing',taskId:'review',...cfg});
  const changedModel=[{...tasks[0],model:'default',effort:'高'},...tasks.slice(1)];
  let d=launch(state(p),'p','manual','r',now,'due',changedModel).data;
  assert.equal(d.runs[0].model,'default');assert.equal(d.runs[0].effort,'高');
  d=settleDemo(d,'r','completed',now+1000);
  const altered=[{...changedModel[0],permission:'full'},...tasks.slice(1)];
  d=launch(d,'p','manual','r2',now+2000,'due',altered).data;
  assert.equal(d.runs[0].taskId,null);assert.equal(planStatus(d.plans[0]),'需重新确认');assert.equal(planDate(d.plans[0]),null);
  assert.equal(launch(d).data.runs.length,2);
  d=recheckDemo(d,'p',now+3000);assert.equal(d.plans[0].permission,'full');assert.equal(d.runs[1].permission,'ask');
  d=launch(d,'p','manual','r3',now+4000,'due',altered).data;assert.equal(d.runs[0].status,'running');assert.equal(d.runs[0].permission,'full');
});
test('archived bound task becomes repair state and cannot be reconfirmed as available',()=>{
  const cfg=taskConfig(tasks[0],projects),p=plan('p',{destination:'existing',taskId:'review',...cfg});
  const d=launch(state(p),'p','manual','r',now,'due',[]).data;
  assert.equal(d.runs[0].taskId,null);assert.ok(d.plans[0].needsRepair.unavailable);
  assert.equal(recheckDemo(d,'p').plans[0].needsRepair.unavailable,true);
});
test('actual pending notification dedupe, wait does not complete without simulated human action',()=>{
  let d=launch(state(plan())).data;d=settleDemo(d,'r','waiting',now+1000,'mail');
  assert.equal(d.notifications.length,1);assert.ok(d.runs[0].approval.text.includes('本人'));
  assert.deepEqual(settleDemo(d,'r','waiting',now+1001,'mail'),d);
  d=settleDemo(d,'r','running',now+2000);d=settleDemo(d,'r','waiting',now+3000,'mail');
  assert.equal(d.notifications.length,2);
  d=settleDemo(d,'r','running',now+4000);d=settleDemo(d,'r','completed',now+5000);assert.equal(d.notifications.length,2);
});
test('success preference, failure history and retry distinct identity',()=>{
  let d=launch(state(plan('p',{successNotify:true}))).data;
  d=settleDemo(d,'r','failed',now+1000);assert.equal(d.notifications.length,1);
  d=launch(d,'p','manual','r2',now+2000).data;assert.equal(d.runs[1].status,'failed');assert.notEqual(d.runs[0].taskId,d.runs[1].taskId);
  d=settleDemo(d,'r2','completed',now+3000);assert.equal(d.notifications.length,2);
});
test('one-shot manual early preserves due; terminal scheduled transition ends but manual remains',()=>{
  const p=plan('p',{schedule:{type:'once',date:'2026-11-28',time:'09:00',zone:'UTC'}});
  let d=launch(state(p)).data;d=settleDemo(d,'r','completed',now+1000);
  assert.equal(d.plans[0].nextAt,p.nextAt);assert.equal(d.plans[0].ended,false);
  d=launch(d,'p','scheduled','later',p.nextAt).data;assert.equal(d.plans[0].ended,false);
  d=settleDemo(d,'later','completed',p.nextAt+1000);assert.equal(planStatus(d.plans[0]),'已结束');
  assert.equal(launch(d,'p','manual','again',p.nextAt+2000).data.runs.length,3);
});
test('coalesce latest missed and skip when out of grace',()=>{
  const p=plan('p',{schedule:{type:'daily',time:'09:00',zone:'UTC'},grace:10});
  const actual=p.nextAt+2*1440*MIN+5*MIN;
  const d=launch(state(p),'p','scheduled','catch',actual,'within').data;
  assert.equal(d.runs[0].scheduledFor,p.nextAt+2*1440*MIN);assert.equal(d.runs[0].missedFrom,p.nextAt);assert.equal(d.runs[0].status,'running');
  const skip=launch(state(p),'p','scheduled','skip',p.nextAt,'outside').data;
  assert.equal(skip.runs[0].status,'skipped');assert.equal(skip.notifications.length,0);
});
test('unknown receipt blocks retry, known reconciliation retains identity',()=>{
  const p=plan();let d=launch(state(p),'p','scheduled','r',p.nextAt,'unknown').data;
  assert.equal(d.runs[0].turnId,null);assert.equal(launch(d).data.runs.length,1);
  assert.equal(settleDemo(d,'r','completed').runs[0].status,'unknown');
  d=settleDemo(d,'r','running',p.nextAt+100);assert.equal(d.runs[0].turnId,'demo-turn-r');
  d=settleDemo(d,'r','completed',p.nextAt+200);assert.equal(d.runs.length,1);
});
test('startup retry retains one record, edits do not rewrite snapshots and deletion preserves runs',()=>{
  const p=plan();let d=launch(state(p),'p','scheduled','r',p.nextAt,'startup').data;
  assert.equal(d.runs[0].attempts,2);assert.equal(d.runs.length,1);
  const changed=saveDraft({...d.plans[0],prompt:'new'},p.id,d.plans[0],p.nextAt+1);
  d={...d,plans:[{...changed,archived:true,enabled:false,nextAt:null}]};
  assert.equal(d.runs[0].prompt,base.prompt);assert.equal(launch(d).data.runs.length,1);
  d=settleDemo(d,'r','completed',p.nextAt+100);assert.equal(d.runs[0].status,'completed');
});
test('review regression: reuse records an actual demo task and validates model/identity on later runs',()=>{
  const p=plan('p',{destination:'reuse',workspace:'dedicated'});
  let d=launch(state(p)).data;const first=d.runs[0];
  assert.equal(d.plans[0].boundTask,first.taskId);assert.equal(d.reuseTasks[first.taskId].cwd,first.cwd);
  d=settleDemo(d,first.id,'completed',now+1000);
  const actual={...d.reuseTasks[first.taskId],model:'default',effort:'高'};
  d=launch(d,'p','manual','r2',now+2000,'due',[actual]).data;
  assert.equal(d.runs[0].model,'default');assert.equal(d.runs[0].effort,'高');assert.equal(d.runs[0].taskId,first.taskId);
  d=settleDemo(d,'r2','completed',now+3000);
  d=launch(d,'p','manual','r3',now+4000,'due',[{...actual,permission:'full'}]).data;
  assert.equal(d.runs[0].taskId,null);assert.ok(d.plans[0].needsRepair);assert.equal(d.plans[0].permission,'ask');
});
test('review regression: archived/missing continued task cannot fall back to its synthetic prior identity',()=>{
  const p=plan('p',{destination:'reuse'});let d=launch(state(p)).data;const id=d.runs[0].taskId;d=settleDemo(d,'r','completed',now+1000);
  d=launch(d,'p','manual','r2',now+2000,'due',[{...d.reuseTasks[id],archived:true}]).data;
  assert.ok(d.plans[0].needsRepair.unavailable);assert.equal(d.runs[0].taskId,null);
});
test('review regression: explicit deleted Agent/model or missing cwd never silently uses a default',()=>{
  for(const target of [{...tasks[0],agentId:'deleted-provider'},{...tasks[0],model:'deleted-model'},{...tasks[0],cwd:undefined}]){
    const cfg=taskConfig(target,projects);assert.equal(cfg.available,false);
    assert.ok(validateDraft({...base,destination:'existing',taskId:'review',...cfg},projects,[target],now));
  }
  const cfg=taskConfig({...tasks[0],runner:'codex',agent:{tool:'codex',providerId:'ModelHub'},model:'gpt-6.1-sol',effort:'中等'},projects);
  assert.equal(cfg.agent,'cx-hub');assert.equal(cfg.available,true);
});
test('review regression: old once run does not end a new paused date',()=>{
  const p=plan('p',{schedule:{type:'once',date:'2026-11-28',time:'09:00',zone:'UTC'}});
  let d=launch(state(p),'p','scheduled','old',p.nextAt).data;
  const changed=saveDraft({...d.plans[0],enabled:false,schedule:{type:'once',date:'2026-11-29',time:'09:00',zone:'UTC'}},p.id,d.plans[0],p.nextAt+1);
  d=settleDemo({...d,plans:[changed]},'old','completed',p.nextAt+100);
  assert.equal(d.plans[0].ended,false);assert.equal(planStatus(d.plans[0]),'已暂停');assert.ok(nextOccurrence(d.plans[0].schedule,p.nextAt+100)>p.nextAt);
});

test('P1.1 completed run has its own recorded message and artifact; skipped and predispatch failures have no result or confirmed turn',()=>{
  const {runs}=seedPlans(projects,now);
  const [done,skip,fail,wait,monthly]=runs;
  assert.equal(runRecord(done).result.kind,'final');
  assert.match(runRecord(done).result.markdown.join(' '),/待推进/);
  assert.equal(runRecord(done).result.artifacts[0].name,'研发摘要.md');
  assert.notEqual(runRecord(done).result.summary,runRecord(monthly).result.summary);
  for(const noRun of [skip,fail]){assert.equal(confirmedTurn(noRun),false);assert.equal(runRecord(noRun).result,null);assert.equal(runRecord(noRun).events.length,1);}
  assert.equal(runRecord(wait).result.kind,'partial');assert.equal(defaultRunTab(wait.status),'process');
});
test('P1.1 transition from waiting preserves recorded progress and exact turn on failure',()=>{
  let d=seedPlans(projects,now);
  const previous=d.runs.find(r=>r.id==='seed-4');
  d=settleDemo(d,previous.id,'running',now);
  d=settleDemo(d,previous.id,'failed',now+1000);
  const final=d.runs.find(r=>r.id===previous.id);
  assert.equal(final.turnId,previous.turnId);assert.equal(final.taskId,previous.taskId);
  assert.deepEqual(runRecord(final).result,runRecord(previous).result);
  assert.equal(runRecord(final).events.at(-1).kind,'error');
  assert.equal(defaultRunTab(final.status),'result');assert.match(runResultSummary(final),/失败/);
});
test('P1.1 unknown has no confirmed turn/output and reconciliation does not create a second record',()=>{
  let d=launch(state(plan()),'p','scheduled','u',now,'unknown').data;
  assert.equal(d.runs.length,1);assert.equal(confirmedTurn(d.runs[0]),false);
  assert.equal(runRecord(d.runs[0]).result,null);
  d=settleDemo(d,'u','running',now+1000);
  assert.equal(d.runs.length,1);assert.equal(confirmedTurn(d.runs[0]),true);
  d=settleDemo(d,'u','completed',now+2000);
  assert.match(runRecord(d.runs[0]).result.markdown.join(' '),/没有实际调用模型/);
});
test('P1.1 latest-first navigation is plan-specific and does not reorder by scheduled time',()=>{
  const runs=[{id:'new',planId:'a',scheduledFor:5},{id:'other',planId:'b',scheduledFor:10},{id:'older',planId:'a',scheduledFor:20}];
  assert.deepEqual(orderedPlanRuns(runs,'a').map(x=>x.id),['new','older']);
});
