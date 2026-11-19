import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,globSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import {readExactA40Database} from './observations.mjs';
import {parseRecordedSkillListing} from './native-skill-inventory.mjs';
import {pluginId,relativeMarker,runtimeMarker} from './plugin-fixture.mjs';

const g04=realpathSync(new URL('..',import.meta.url));
const [commit,asar,...flags]=process.argv.slice(2);
assert.match(commit,/^[a-f0-9]{40}$/);
assert.match(asar,/^[a-f0-9]{64}$/);
const modes={};
assert(flags.length&&flags.length%2===0,
  'Expected exact commit, ASAR SHA and --disable NNN [--update NNN] [--uninstall NNN]');
for(let i=0;i<flags.length;i+=2){
  const [option,attempt]=flags.slice(i,i+2),mode=option.slice(2);
  assert(['--disable','--update','--uninstall'].includes(option)&&!Object.hasOwn(modes,mode));
  assert.match(attempt,/^\d{3}$/);
  modes[mode]=attempt;
}
assert.equal(new Set(Object.values(modes)).size,Object.keys(modes).length);
const packageHash={
  '1.0.0':'0db6049222fe2f49e5530e1c9b823e4d651a8fbe14ef8c44f557b36cf88f0018',
  '1.1.0':'1149140d69e203a5ed6d06b9c54ef8ec85f9caeaacc0c8cf9f8fa86eec55ed62',
  '2.0.0':'9c8bc7959b0b661cb4bb3d8328f0d13452f1a9c215c6a9f612db95bc42cce4bc',
};
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const helper=join(g04,'../package/mac-arm64/WillYou.app/Contents/Resources/native/willyou-process-identity');
assert.equal(sha(helper),'3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040');
const inspect=pid=>JSON.parse(execFileSync(helper,[String(pid)],{encoding:'utf8',timeout:2500}));

function load(attempt,scenario,status){
  const path=join(g04,'attempt-'+attempt,'result.json'),r=JSON.parse(readFileSync(path,'utf8'));
  assert.deepEqual([r.commit,r.archive,r.scenario,r.exit.code,r.exit.signal],[commit,asar,scenario,0,null]);
  if(status==='finished')assert(['failed','passed'].includes(r.status));
  else assert.equal(r.status,status);
  assert.equal(r.rendererErrors.length,0);
  const userData=r.isolation.userData,db=join(userData,'smartdd.db'),dbSha=sha(db);
  const retained=join(userData,'plugin-data',pluginId);
  const actual=readExactA40Database(db,pluginId,{
    install:'SELECT installed,enabled,package_hash FROM plugin_installations WHERE app_id=?',
    changes:'SELECT kind,state,from_hash,to_hash,updated_at,error_code,payload_json FROM plugin_lifecycle_changes WHERE app_id=? ORDER BY created_at',
    calls:'SELECT operation_id,run_id,task_id,package_hash,state,error_code,attempt_count,effect_state,started_at,ended_at FROM application_invocations WHERE app_id=? ORDER BY started_at',
    packages:'SELECT version,package_hash,relative_path FROM plugin_packages WHERE app_id=? ORDER BY version',
    settings:'SELECT project_id,enabled,binding_revision,policy_revision FROM application_project_settings WHERE app_id=?',
    leases:'SELECT kind,state,pid,process_started_at FROM plugin_runtime_leases WHERE app_id=? ORDER BY created_at',
  },'closed');
  assert.equal(sha(db),dbSha);
  const taskFacts=new Map();
  function states(taskId){
    if(taskFacts.has(taskId))return taskFacts.get(taskId);
    const state=readExactA40Database(db,taskId,{
      run:`SELECT r.run_id,r.task_id,r.state,r.pid,r.process_started_at,r.binding_id,r.generation,b.native_id,b.state_root,c.snapshot_json
        FROM capability_runs r JOIN agent_bindings b ON r.binding_id=b.binding_id
        JOIN agent_capability_sessions c ON c.capability_session_id=r.capability_session_id WHERE r.task_id=?`,
      processes:`SELECT p.kind,p.pid,p.process_started_at,p.state,p.ended_at FROM capability_run_processes p
        JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY p.attached_at`,
    },'closed');
    assert.equal(state.run.length,1);
    assert.equal(state.run[0].state,'stopped');
    assert(state.processes.every(p=>p.state==='exited'&&p.process_started_at&&p.ended_at));
    taskFacts.set(taskId,state);
    return state;
  }
  const rawHashes={};
  function raw(stage){
    const turns=r.turns.filter(row=>row.stage===stage);
    assert.equal(turns.length,1);
    const [turn]=turns,run=states(turn.taskId).run[0],snapshot=JSON.parse(run.snapshot_json);
    assert.equal(run.run_id,turn.nativeInventory.runId);
    assert.equal(run.native_id,turn.nativeInventory.sessionId);
    assert.equal(snapshot.runId,run.run_id);
    const files=globSync(join(run.state_root,'projects','*',run.native_id+'.jsonl'));
    assert.equal(files.length,1);
    const [file]=files;
    rawHashes[relative(g04,file)]=sha(file);
    const body=readFileSync(file,'utf8');
    const inventory=parseRecordedSkillListing(body,run.native_id);
    assert.equal(inventory.recordId,turn.nativeInventory.recordId);
    assert.equal(inventory.advertised,turn.nativeInventory.advertised);
    const rows=body.trim().split('\n').map(line=>JSON.parse(line));
    const output=new Map();
    for(const receipt of turn.receipts){
      const reply=rows.flatMap(row=>row.type==='user'&&Array.isArray(row.message?.content)?row.message.content:[])
        .filter(item=>item.type==='tool_result'&&item.tool_use_id===receipt.toolUseId);
      const call=rows.flatMap(row=>row.type==='assistant'&&Array.isArray(row.message?.content)?row.message.content:[])
        .filter(item=>item.type==='tool_use'&&item.id===receipt.toolUseId);
      assert.equal(reply.length,1);
      assert.equal(call.length,1);
      assert.equal(call[0].name,receipt.tool);
      const text=typeof reply[0].content==='string'?reply[0].content:reply[0].content.map(part=>part.text).join('\n');
      assert.equal(text,receipt.text);
      assert.equal(reply[0].is_error===true,receipt.isError);
      output.set(receipt.toolUseId,{kind:receipt.condition,isError:receipt.isError,text,input:call[0].input});
    }
    return {turn,run,snapshot,inventory,output:[...output.values()]};
  }
  function skill(stage,version){
    const proof=raw(stage),reads=proof.output.filter(row=>row.kind==='read-resource');
    assert.equal(reads.length,1);
    assert.equal(proof.inventory.advertised,true);
    assert.equal(reads[0].isError,false);
    assert.equal(proof.turn.frozen.version,version);
    assert.equal(proof.turn.frozen.runId,proof.run.run_id);
    assert.equal(reads[0].input.file_path,proof.turn.frozen.skill+'/./references/proof.txt');
    assert.equal(reads[0].text.match(/A40_RELATIVE_SKILL_[0-9_]+/g)?.[0],relativeMarker(version));
    assert(!existsSync(proof.turn.frozen.runRoot),'Frozen Skill remains until its original run has exited');
    return {runId:proof.run.run_id,nativeId:proof.run.native_id,version,marker:relativeMarker(version),sha256:proof.turn.frozen.sha256};
  }
  function error(stage,code,message,attemptCount){
    const proof=raw(stage),calls=proof.output.filter(row=>row.kind==='plugin-call');
    assert.equal(calls.length,1);
    assert(calls[0].isError);
    const response=JSON.parse(calls[0].text);
    assert.deepEqual([response.error.code,response.error.message,response.error.attemptCount],[code,message,attemptCount]);
    return {...response,runId:proof.run.run_id,uniqueRawToolResults:calls.length,capturedProviderCopies:proof.turn.receipts.filter(row=>row.condition==='plugin-call').length};
  }
  function success(stage,label,version){
    const proof=raw(stage),action=proof.output.find(row=>row.kind==='plugin-call');
    assert(!action.isError);
    assert.deepEqual(JSON.parse(action.text),{label,version,status:runtimeMarker(version)});
    return {runId:proof.run.run_id,version,marker:runtimeMarker(version)};
  }
  function gate(stage,check,childVersion,ok){
    const item=r.checks[check],op=item.gate.row.operationId;
    const start=JSON.parse(readFileSync(join(retained,stage+'.arrived.json'),'utf8'));
    const returned=JSON.parse(readFileSync(join(retained,stage+'.returned.json'),'utf8'));
    assert.equal(start.operationId,op);
    assert.equal(readFileSync(join(retained,stage+'.release'),'utf8'),op);
    assert.equal(start.version,childVersion);
    assert.deepEqual([returned.operationId,returned.version,returned.runId,returned.pid],[op,childVersion,start.runId,start.pid]);
    assert(returned.at<=item.releasedAt&&item.releasedAt<=returned.returnedAt);
    const [row]=actual.calls.filter(row=>row.operation_id===op);
    assert.equal(actual.calls.filter(row=>row.operation_id===op).length,1);
    assert.deepEqual([row.package_hash,row.state,row.error_code,row.attempt_count,row.effect_state],
      [packageHash[childVersion],ok?'succeeded':'failed',ok?null:'APP_NOT_ENABLED',1,'read-only']);
    assert(Date.parse(row.ended_at)>=returned.returnedAt);
    assert.equal(row.run_id,returned.runId);
    return {operation:op,childVersion,childPid:start.pid,startedAt:start.at,releasedAt:item.releasedAt,
      returnedAt:returned.returnedAt,ledgerEndedAt:row.ended_at,ledgerState:row.state,ledgerError:row.error_code,attemptCount:1};
  }
  function finish(){
    const recorded=new Set([r.exit.pid,...actual.leases.map(row=>row.pid)]);
    for(const task of r.taskFixtures){
      if(task.taskId){
        const list=states(task.taskId).processes;
        for(const process of list)recorded.add(process.pid);
      }
    }
    for(const gate of r.runtimeGates)recorded.add(gate.arrived.row.pid);
    for(const pid of recorded){
      assert(Number.isInteger(pid));
      assert.deepEqual(inspect(pid),{schema:1,state:'stopped'});
    }
    assert(actual.leases.every(row=>row.state==='closed'));
    assert.equal(sha(db),dbSha);
    return {dbSha256:dbSha,resultSha256:sha(path),transcripts:rawHashes,appPid:r.exit.pid,exitCode:r.exit.code,exactPidsStopped:[...recorded]};
  }
  return {r,actual,retained,raw,skill,error,success,gate,finish};
}

function verifyUpdate(attempt){
  const update=load(attempt,'update','passed');
  assert.deepEqual(update.actual.changes.map(row=>[row.kind,row.state,row.from_hash,row.to_hash]),[
    ['install','committed',null,packageHash['1.0.0']],
    ['update','committed',packageHash['1.0.0'],packageHash['1.1.0']],
    ['update','committed',packageHash['1.1.0'],packageHash['2.0.0']],
  ]);
  assert.deepEqual(update.actual.install,[{installed:1,enabled:1,package_hash:packageHash['2.0.0']}]);
  assert.equal(update.actual.packages.length,1);
  const gateUpdate=update.gate('hold_update','compatibleUpdate','1.0.0',true);
  const gateBreaking=update.gate('hold_breaking','breakingUpdateLease','1.1.0',true);
  for(const [i,check,proof] of [[1,'compatibleUpdate',gateUpdate],[2,'breakingUpdateLease',gateBreaking]]){
    assert.equal(update.r.checks[check].during.install[0].package_hash,packageHash[proof.childVersion]);
    assert.equal(update.r.checks[check].during.changes.at(-1).state,'preparing');
    assert(Date.parse(update.actual.changes[i].updated_at)>=Date.parse(proof.ledgerEndedAt));
  }
  const frozen1=update.skill('initial','1.0.0');
  for(const stage of ['hold_update','old_run_new_plugin','hold_breaking','old_tool_after_break'])assert.deepEqual(update.skill(stage,'1.0.0'),frozen1);
  const version11=update.skill('new_run_after_compatible','1.1.0'),version20=update.skill('new_current_owner','2.0.0');
  assert.notEqual(version11.runId,frozen1.runId);
  assert.notEqual(version20.runId,version11.runId);
  const updateSuccess=[update.success('hold_update','hold_update','1.0.0'),update.success('old_run_new_plugin','old_run_new_plugin','1.1.0'),
    update.success('hold_breaking','hold_breaking','1.1.0'),update.success('new_current_owner','new_current_owner','2.0.0')];
  const oldTool=update.error('old_tool_after_break','CAPABILITY_UNAVAILABLE','插件已删除此能力，需更新任务使用方式',0);
  assert.equal(update.r.checks.unsupportedInterface.message,'需要插件接口 99');
  assert.equal(update.r.checks.unsupportedInterface.plugin.package_hash,packageHash['1.1.0']);
  assert.deepEqual(update.r.folderHandoffs.map(row=>row.accepted.title),['选择插件包','选择更新插件包','选择更新插件包','选择更新插件包']);
  return {attempt,status:'passed',gates:[gateUpdate,gateBreaking],frozenSkill:[frozen1,version11,version20],
    nativeSuccess:updateSuccess,removedTool:oldTool,unsupportedInterface:'HOST_INCOMPATIBLE',evidence:update.finish()};
}
function verifyUninstall(attempt){
  const uninstall=load(attempt,'uninstall','passed');
  const gateUninstall=uninstall.gate('hold_uninstall','uninstall','1.0.0',true);
  assert.equal(uninstall.r.checks.uninstall.during.changes.at(-1).state,'preparing');
  const published=uninstall.actual.changes.at(-1);
  assert.equal(published.state,'committed');
  assert.equal(JSON.parse(published.payload_json).deleteData,false);
  assert(Date.parse(published.updated_at)>=Date.parse(gateUninstall.ledgerEndedAt));
  assert.deepEqual(uninstall.actual.install,[{installed:0,enabled:0,package_hash:null}]);
  assert.deepEqual(uninstall.actual.packages,[]);
  const retainedPath=join(uninstall.retained,'a40-retained.txt');
  const oldData=uninstall.r.checks.uninstall.after.before;
  assert.equal(readFileSync(retainedPath,'utf8'),'A40_PRIVATE_DATA_MUST_SURVIVE\n');
  assert.equal(sha(retainedPath),oldData.sha256);
  assert.equal(sha(retainedPath),uninstall.r.checks.uninstall.after.retainedSha256);
  assert.deepEqual(uninstall.actual.settings,oldData.projectSettings);
  const oldUninstall=uninstall.error('old_call_after_uninstall','NOT_FOUND','插件已卸载',0);
  const originalUninstallSkill=uninstall.skill('initial','1.0.0');
  assert.deepEqual(uninstall.skill('old_call_after_uninstall','1.0.0'),originalUninstallSkill);
  const omitted=uninstall.raw('new_run_after_uninstall');
  assert.equal(omitted.inventory.advertised,false);
  assert(!omitted.snapshot.snapshot.externalPlugins.some(plugin=>plugin.appId===pluginId));
  assert.notEqual(omitted.run.run_id,originalUninstallSkill.runId);
  const originalUninstallResult=uninstall.success('hold_uninstall','hold_uninstall','1.0.0');
  return {attempt,status:'passed',gate:gateUninstall,nativeResult:originalUninstallResult,oldTool:oldUninstall,
    frozenSkill:originalUninstallSkill,newRunOmittedPlugin:true,retainedDataSha256:sha(retainedPath),
    retainedProjectSettings:uninstall.actual.settings,evidence:uninstall.finish()};
}

function verifyDisable(attempt){
  const test=load(attempt,'disable','finished');
  assert(test.r.checks.disable?.gate,'The old runtime must actually accept the dispatched read');
  const gate=test.gate('hold_disable','disable','1.0.0',true);
  const beforeRelease=test.r.checks.disable.during;
  assert.equal(beforeRelease.db.install[0].enabled,0);
  assert.equal(beforeRelease.db.install[0].package_hash,packageHash['1.0.0']);
  const prior=beforeRelease.db.invocations.find(row=>row.operation_id===gate.operation);
  assert.equal(prior.state,'running');
  assert.equal(prior.error_code,null);
  const denied=test.error('new_call_while_disabled','APP_NOT_ENABLED','插件已停用',0);
  assert.equal(denied.error.effectState,'not-started');
  assert.equal(denied.uniqueRawToolResults,1);
  assert.equal(denied.capturedProviderCopies,1);
  assert.equal(denied.operationId,undefined);
  const refusedTurn=test.raw('new_call_while_disabled').turn;
  assert(refusedTurn.receipts.find(entry=>entry.condition==='plugin-call').at<gate.releasedAt);
  assert(!existsSync(join(test.retained,'new_call_while_disabled.arrived.json')));
  assert(!existsSync(join(test.retained,'new_call_while_disabled.returned.json')));
  const held=test.success('hold_disable','hold_disable','1.0.0');
  const oldRun=test.raw('hold_disable').run;
  assert.equal(held.runId,oldRun.run_id);
  assert.notEqual(denied.runId,oldRun.run_id);
  const initial=test.skill('initial','1.0.0');
  assert.deepEqual(test.skill('hold_disable','1.0.0'),initial);
  const siblingFrozen=test.skill('new_call_while_disabled','1.0.0');
  assert.notEqual(siblingFrozen.runId,initial.runId);
  const omitted=test.raw('new_run_disabled');
  assert.equal(omitted.inventory.advertised,false);
  assert(!(omitted.snapshot.snapshot.externalPlugins??[]).some(row=>row.appId===pluginId));
  assert.notEqual(omitted.run.binding_id,oldRun.binding_id);
  assert.notEqual(omitted.run.run_id,oldRun.run_id);

  const restarted=test.success('reenabled_old_run','reenabled_old_run','1.0.0');
  assert.deepEqual(test.skill('reenabled_old_run','1.0.0'),initial);
  const resumedRun=test.raw('reenabled_old_run').run;
  assert.deepEqual([resumedRun.binding_id,resumedRun.generation,resumedRun.run_id,resumedRun.native_id],
    [oldRun.binding_id,oldRun.generation,oldRun.run_id,oldRun.native_id]);
  assert.deepEqual(test.actual.install,[{installed:1,enabled:1,package_hash:packageHash['1.0.0']}]);
  assert.deepEqual(test.actual.changes.map(row=>row.kind),['install']);
  for(const text of ['停用','启用']){
    assert.equal(test.r.actions.filter(action=>action.text===text&&action.selector.includes('[role="menuitem"]')).length,1);
  }
  assert.equal(test.actual.calls.length,4);
  assert(test.actual.calls.every(row=>row.state==='succeeded'&&row.error_code===null&&row.attempt_count===1&&row.effect_state==='read-only'));
  const markers=['initial','new_current_contender','hold_disable','reenabled_old_run'];
  const realWrites=readdirSync(test.retained).filter(name=>name.endsWith('.arrived.json')).map(name=>name.split('.')[0]).sort();
  assert.deepEqual(realWrites,[...markers].sort());
  const uniqueOperations=markers.map(marker=>{
    const row=JSON.parse(readFileSync(join(test.retained,marker+'.returned.json'),'utf8'));
    assert.equal(row.label,marker);
    assert.equal(row.version,'1.0.0');
    const rows=test.actual.calls.filter(call=>call.operation_id===row.operationId&&call.run_id===row.runId);
    assert.equal(rows.length,1);
    assert.equal(test.raw(marker).output.filter(receipt=>receipt.kind==='plugin-call').length,1);
    assert.equal(test.raw(marker).turn.receipts.filter(receipt=>receipt.condition==='plugin-call').length,1);
    return row.operationId;
  });
  assert.equal(new Set(uniqueOperations).size,4);
  assert.equal(test.r.status,'passed');
  return {attempt,status:'passed',gate,held,denied,oldBinding:{bindingId:oldRun.binding_id,generation:oldRun.generation,nativeId:oldRun.native_id},
    frozenOld:initial,frozenSibling:siblingFrozen,newDisabledRunOmittedPlugin:true,reenabled:restarted,
    independentRuntimeOperations:uniqueOperations,evidence:test.finish()};
}

const checks={};
if(modes.disable)checks.disable=verifyDisable(modes.disable);
if(modes.update)checks.update=verifyUpdate(modes.update);
if(modes.uninstall)checks.uninstall=verifyUninstall(modes.uninstall);
console.log(JSON.stringify({caseId:'M14-A40',commit,asar,independentVerification:'A / persisted store, actual native rollout and private runtime files',
  handling:'Only previously created isolated evidence read, no App launch or listener changes',checks},null,2));
