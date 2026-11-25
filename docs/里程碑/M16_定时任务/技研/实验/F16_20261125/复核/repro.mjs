import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
globalThis.location={search:'?preview=m16&f35=1'};
const { defaultDraft,saveDraft,validateDraft,taskConfig,launchDemo,settleDemo,planStatus,planDate }=await import('./m16-model.mjs');
const projects=[{id:'smartdd',dirs:[{id:'git',path:'/workspace/SmartDD',available:true,isDefault:true,vcs:'Git'}]}];
const epoch=Date.parse('2026-11-27T03:00:00Z');
const base={...defaultDraft(projects,epoch),name:'Synthetic plan',prompt:'合成审阅任务',schedule:{type:'daily',time:'09:00',zone:'UTC'}};
const state=p=>({plans:[p],runs:[],notifications:[]});
const launch=(d,id,tasks,now=epoch,trigger='manual')=>launchDemo(d,'p',trigger,id,now,'due',projects,tasks).data;
const rows=[];
{
  const actualTask={id:'persistent',project:'smartdd',agentId:'cx-sub',runner:'codex',cwd:'/workspace/SmartDD',dirId:'git',model:'gpt-6.2-sol',effort:'低',permission:'ask',status:'stopped'};
  const plan=saveDraft({...base,destination:'reuse',boundTask:actualTask.id,...taskConfig(actualTask,projects)},'p',null,epoch);
  // Same agent, same provider, model and effort changed. These must follow the bound task.
  const updatedModel={...actualTask,model:'default',effort:'高'};
  const following=launch(state(plan),'model-follow',[updatedModel]);
  const changedPermission={...actualTask,permission:'full',cwd:'/workspace/changed',agentId:'cc-hub',runner:'claude',model:'claude-sonnet-5-5'};
  const conflicting=launch(state(plan),'identity',[changedPermission]);
  const archived=launch(state(plan),'archived',[{...actualTask,archived:true}]);
  const model=following.runs[0],identity=conflicting.runs[0],inactive=archived.runs[0];
  assert.equal(model.model,'gpt-6.2-sol');assert.equal(model.effort,'低');
  assert.equal(identity.status,'running');assert.equal(identity.permission,'ask');assert.equal(conflicting.plans[0].needsRepair,null);
  assert.equal(inactive.status,'running');assert.equal(inactive.taskId,'persistent');
  rows.push({id:'R05-REUSE',observed:{model:{model:model.model,effort:model.effort,status:model.status},identity:{status:identity.status,agent:identity.agent,permission:identity.permission,cwd:identity.cwd,needsRepair:conflicting.plans[0].needsRepair},archived:{status:inactive.status,taskId:inactive.taskId}},expected:'Existing reuse binding must follow model+effort; pause on agent/provider/cwd/tier change; archived target requires repair.'});
}
{
  const plan=saveDraft({...base,schedule:{type:'once',date:'2026-11-27',time:'03:01',zone:'UTC'}},'p',null,epoch);
  let d=launch(state(plan),'old',[],plan.nextAt,'scheduled');
  assert.equal(d.plans[0].ended,false);assert.equal(d.plans[0].nextAt,null);assert.equal(d.runs[0].status,'running');
  const edited={...d.plans[0],enabled:false,schedule:{type:'once',date:'2026-11-28',time:'03:00',zone:'UTC'}};
  assert.equal(validateDraft(edited,projects,[],plan.nextAt+1),'');
  const saved=saveDraft(edited,'p',d.plans[0],plan.nextAt+1);
  assert.equal(saved.ended,false);assert.equal(planStatus(saved),'已暂停');
  d=settleDemo({...d,plans:[saved]},'old','completed',plan.nextAt+2000);
  assert.equal(d.plans[0].ended,true);assert.equal(planStatus(d.plans[0]),'已结束');
  rows.push({id:'R02-ONCE-EDIT',observed:{oldDue:plan.nextAt,newDue:saved.schedule.onceAt,before:planStatus(saved),after:planStatus(d.plans[0]),newDate:d.plans[0].schedule.date,nextAt:planDate(d.plans[0])},expected:'Old run completion settles only old run; edited new date remains paused and resumable.'});
}
{
  const missing={id:'unavailable-profile',project:'smartdd',runner:'codex',agentId:'removed-agent',model:'removed-model',status:'stopped'};
  const cfg=taskConfig(missing,projects);
  const d={...base,destination:'existing',taskId:missing.id,...cfg};
  assert.equal(validateDraft(d,projects,[missing],epoch),'');
  const plan=saveDraft(d,'p',null,epoch);
  const started=launch(state(plan),'bad-binding',[missing]);
  assert.equal(cfg.agent,'cx-sub');assert.equal(cfg.model,'gpt-6.2-sol');assert.equal(cfg.cwd,'/workspace/SmartDD');assert.equal(started.runs[0].status,'running');
  const nested={id:'provider-snapshot',project:'smartdd',runner:'codex',agent:{agentId:'rc-cx-hub',tool:'codex',source:'provider',providerId:'provider-modelhub',model:'gpt-6.1-sol'},status:'stopped',cwd:'/workspace/actual'};
  const nestedCfg=taskConfig(nested,projects);assert.equal(nestedCfg.agent,'cx-sub');
  rows.push({id:'R03-MISSING-IDENTITY',observed:{invalidTaskProjection:cfg,validated:true,runStatus:started.runs[0].status,nestedProviderTaskProjection:nestedCfg},expected:'An unavailable explicit Agent/model or missing actual cwd requires repair/selection confirmation; a Provider-backed task must not be silently mapped to subscription.'});
}
writeFileSync(new URL('./observed.json',import.meta.url),JSON.stringify({layer:'read-only copy of synthetic P1.0 model, no GUI/no user data',rows},null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
