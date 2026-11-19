import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { asar, attempt361, bindingId, commit, executable, frozenFiles, home, nativeHistory,
  nativeId, prior, priorGenerations, root, sha, taskId, transcriptHash, userData, work } from './contract.mjs';

export const nativeHelper=join(dirname(executable),'../Resources/native/willyou-process-identity');
export const nativeHelperHash='3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040';
export const claudeHash='e214ad76dcc0e846b03be28ed1c2734aacd4e27acb527cb7f8a9e2bed644e837';
export const database=join(userData,'smartdd.db');
const dbPreflightHash='c9071a97da2db6703e38d5700ad15a0408349b52ee9216089f1a98b04ee175cd'; // after attempt 361
const sqlProgram='from pathlib import Path; import sqlite3, sys, json;'
  +' c=sqlite3.connect(Path(sys.argv[1]).as_uri()+"?mode=ro"+("&immutable=1" if sys.argv[2]=="immutable" else ""),uri=True);'
  +' c.row_factory=sqlite3.Row;'
  +' print(json.dumps([dict(x) for x in c.execute(sys.argv[3],json.loads(sys.argv[4]))])); c.close()';

export function readDb(sql,args=[],immutable=false) {
  assert.equal(realpathSync(database),database);
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',sqlProgram,database,immutable?'immutable':'live',sql,JSON.stringify(args)],
    {encoding:'utf8',timeout:4000,env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}}));
}

export function readState(immutable=false) {
  const query=(sql,args=[taskId])=>readDb(sql,args,immutable);
  const bindings=query('SELECT binding_id,native_id,created_at,state_root,driver_id,profile_id FROM agent_bindings WHERE task_id=? ORDER BY created_at');
  const runs=query('SELECT run_id,binding_id,generation,pid,process_started_at,state,owner_pid,owner_started_at FROM capability_runs WHERE task_id=? ORDER BY generation');
  const processes=query('SELECT p.run_id,p.kind,p.pid,p.process_started_at,p.state FROM capability_run_processes p JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY r.generation,p.kind');
  const turns=query("SELECT turn_id,run_id,status,native_turn_id,json_extract(input_ref,'$.text') AS input FROM agent_turns WHERE task_id=? AND source_kind='user' ORDER BY rowid");
  const node=query("SELECT item_id,run_id,node_id,revision,terminal_state,json_extract(payload_ref,'$.state') AS state FROM agent_items WHERE task_id=? AND type='subagent_status' ORDER BY ordinal");
  const providers=query("SELECT p.preset,p.endpoints,(p.secret_ref IS NULL) no_stored_secret,c.default_model,c.source,t.kind,t.version,t.custom_path FROM agent_bindings b JOIN ai_run_configs c ON c.profile_id=b.profile_id JOIN ai_providers p ON p.id=c.provider_id JOIN ai_tools t ON t.id=c.tool_id WHERE b.task_id=?");
  const transfers=query('SELECT count(*) AS count FROM agent_transfers WHERE task_id=?')[0].count;
  return {bindings,runs,processes,turns,node,providers,transfers};
}

export function verifySource(){
  assert.equal(realpathSync(process.cwd()),join(root,'source'),'Use the same frozen source checkout');
  for(const path of [executable,home,userData,work,prior,database])assert.equal(realpathSync(path),path);
  const wal=database+'-wal', shm=database+'-shm';
  if(existsSync(wal))assert.equal(statSync(wal).size,0,'Do not resume if nonempty WAL contains uncheckpointed results');
  const sidecars={walBytes:existsSync(wal)?statSync(wal).size:null,shmBytes:existsSync(shm)?statSync(shm).size:null};
  assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commit);
  assert.equal(sha(readFileSync(join(dirname(executable),'../Resources/app.asar'))),asar);
  assert.equal(sha(readFileSync(nativeHelper)),nativeHelperHash);
  const dbHash=sha(readFileSync(database));
  assert.equal(dbHash,dbPreflightHash,'The database changed after attempt 361; re-evaluate before resuming');
  const release361=JSON.parse(readFileSync(join(attempt361,'verified-release.json')));
  assert.deepEqual(release361.exit,{pid:23849,code:0,signal:null});
  assert.equal(release361.port3425Released,true);
  for(const [name,hash] of Object.entries(frozenFiles))assert.equal(sha(readFileSync(join(prior,name))),hash,'Changed original evidence '+name);
  const original=JSON.parse(readFileSync(join(prior,'result.json')));
  const release=JSON.parse(readFileSync(join(prior,'verified-release.json')));
  assert.equal(original.status,'pass');
  assert.equal(original.sourceCommit,commit);
  assert.equal(original.asar,asar);
  assert.equal(original.home,home);
  assert.equal(original.userData,userData);
  assert.equal(original.scope,work);
  assert.equal(original.ids.taskId,taskId);
  assert.deepEqual(original.appRuns.map(entry=>entry.exit),release.apps);
  assert.deepEqual(release.apps,[{pid:17421,code:0,signal:null}]);
  assert.equal(release.port3425Released,true);
  assert.equal(original.claudeTool.sha256,claudeHash);
  const foreground=original.observations.find(row=>row.name==='exact ordinary foreground stop receipt and original background after stop');
  const background=original.observations.find(row=>row.name==='background stops only after second explicit UI action with original node and PID');
  assert(foreground && background?.background?.state==='stopped');
  const backgroundBirth=original.observations.find(row=>row.name==='native Bash stays alive after actual foreground ends').background;
  assert(Number.isSafeInteger(backgroundBirth.pid)&&backgroundBirth.pid>1);
  assert.match(backgroundBirth.startedAt,/^darwin-proc-v1:\d+:\d+$/);

  const state=readState(true);
  assert.equal(state.bindings.length,1);
  const [binding]=state.bindings;
  assert.equal(binding.binding_id,bindingId);
  assert.equal(binding.native_id,nativeId);
  assert.equal(binding.driver_id,'claude-sdk');
  assert(binding.state_root.startsWith(join(userData,'agents/claude')+'/'));
  assert.equal(realpathSync(binding.state_root),binding.state_root);
  const transcript=join(binding.state_root,'projects',
    '-private-tmp-willyou-m14-stage6-WRvdST-g04-attempt-357-runtime-uKigbq-project',nativeId+'.jsonl');
  assert.equal(realpathSync(transcript),transcript);
  const transcriptBytes=readFileSync(transcript);
  assert.equal(sha(transcriptBytes),transcriptHash);
  const savedHistory=nativeHistory(transcriptBytes);
  assert.deepEqual(state.runs.map(run=>run.generation),priorGenerations);
  assert(state.runs.every(run=>run.state==='stopped'&&run.owner_pid===(run.generation<3?17421:23849)&&run.binding_id===bindingId));
  assert.equal(state.processes.length,6);
  const originalProcesses=state.processes.map(({pid,process_started_at:birth,state:status})=>{
    assert.equal(status,'exited');
    assert([...release.processes,...release361.processes].some(record=>record.pid===pid&&record.birth===birth&&record.observed==='stopped'));
    return {pid,birth};
  });
  assert.deepEqual(state.turns.map(turn=>turn.status),['completed','completed','completed','interrupted','completed','failed']);
  assert.equal(state.transfers,0);
  assert.equal(state.node.length,2);
  assert(state.node.every(row=>row.terminal_state==='failed'&&row.state==='interrupted'&&row.node_id===state.node[0].node_id));
  assert.deepEqual(state.node.map(row=>row.run_id),state.runs.filter(row=>row.generation<3).map(row=>row.run_id));
  assert.equal(state.providers.length,1);
  const [provider]=state.providers;
  assert.deepEqual(JSON.parse(provider.endpoints),{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'});
  assert.equal(provider.source,'provider');
  assert.equal(provider.kind,'claude');
  assert.equal(provider.preset,'magpie');
  assert.equal(provider.no_stored_secret,1);
  assert.equal(provider.default_model,'deepseek-flash');
  assert.equal(provider.version,'2.1.326');
  assert.match(provider.custom_path,/^\/Users\/[^/]+\/\.local\/share\/claude\/versions\/2\.1\.326$/);
  return {state,dbHash,sidecars,transcript,savedHistory,originalProcesses,
    originalOwner:{pid:state.runs[0].owner_pid,birth:state.runs[0].owner_started_at},
    background:{pid:backgroundBirth.pid,birth:backgroundBirth.startedAt},provider};
}

