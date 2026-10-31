// Fault preparation and read-only observations for this batch's own synthetic data.
const fs=require('node:fs'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const Database=createRequire('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/package.json')('better-sqlite3');
const [file,mode,manifestPath]=process.argv.slice(2);
if(!file?.startsWith('/private/tmp/willyou-m10-snapshots-x-')||!file.endsWith('/userdata/smartdd.db'))throw Error('Expected this batch private database');
if(!['fault','read'].includes(mode))throw Error('Unknown test operation');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),db=new Database(file,{fileMustExist:true,readonly:mode==='read'}),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
function read(item){
 const task=db.prepare('SELECT id,project_id,runner,native_session_id,cwd,state_root,runtime_snapshot FROM tasks WHERE id=?').get(item.taskId);if(!task)throw Error('Task missing');
 const snapshot=db.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').get(item.taskId),refs=db.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(item.taskId),identity=db.prepare('SELECT * FROM capability_session_identities WHERE task_id=?').get(item.taskId),runs=db.prepare('SELECT run_id,state,pid,snapshot_hash FROM capability_runs WHERE task_id=? ORDER BY run_id').all(item.taskId);
 return {kind:item.kind,task,snapshot,refs,identity,runs,children:db.prepare('SELECT p.run_id,p.kind,p.state,p.pid,p.process_started_at FROM capability_run_processes p JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY p.process_id').all(item.taskId),leaseStates:db.prepare("SELECT l.state FROM capability_resource_leases l JOIN capability_runs r ON r.run_id=l.owner_id WHERE l.owner_kind='run' AND r.task_id=? ORDER BY l.lease_id").all(item.taskId),grants:db.prepare('SELECT COUNT(*) n FROM mail_send_grants').get().n,invocations:db.prepare('SELECT COUNT(*) n FROM application_invocations').get().n};
}
try{
 if(mode==='read'){process.stdout.write(JSON.stringify({mode,at:new Date().toISOString(),cases:manifest.cases.map(read)})+'\n');}
 else{
  const before=manifest.cases.map(read);for(const item of before){const saved=JSON.parse(item.snapshot.snapshot_json),pointer=JSON.parse(item.task.runtime_snapshot).sessionCapabilities;if(item.snapshot.schema_version!==2||sha(canonical(saved))!==item.snapshot.snapshot_hash||saved.taskId!==item.task.id||saved.projectId!==item.task.project_id||saved.native.sessionId!==item.task.native_session_id||pointer?.snapshotHash!==item.snapshot.snapshot_hash||item.identity.session_id!==saved.native.sessionId||item.identity.selection_hash!==sha(canonical({...saved,native:{...saved.native,sessionId:null}})))throw Error('Original UI-created snapshot is not fully valid before fault');}if(before.some(x=>x.runs.length!==1||x.runs[0].state!=='stopped'||x.leaseStates.some(l=>l.state!=='released')||!x.task.native_session_id))throw Error('Fault precondition requires stopped real UI-created native Tasks');
  db.transaction(()=>{for(const item of manifest.cases){const row=db.prepare('SELECT snapshot_json,snapshot_hash FROM capability_session_snapshots WHERE task_id=?').get(item.taskId);let bytes=row.snapshot_json,hash=row.snapshot_hash,version=2;
   if(item.kind==='bad-json')bytes='{ "private":"'+manifest.canary+'",';
   else if(item.kind==='unknown-schema'){version=999;bytes=canonical({...JSON.parse(bytes),schema:999,private:manifest.canary});hash=sha(bytes);}
   else if(item.kind==='bad-hash')hash='f'.repeat(64);
   else if(item.kind==='cross-project-snapshot'){bytes=canonical({...JSON.parse(bytes),projectId:manifest.otherProjectId});hash=sha(bytes);}
   else if(item.kind==='cross-project-task')db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(manifest.otherProjectId,item.taskId);
   else throw Error('Unknown fault fixture');
   db.prepare('UPDATE capability_session_snapshots SET schema_version=?,snapshot_json=?,snapshot_hash=? WHERE task_id=?').run(version,bytes,hash,item.taskId);
  }}).immediate();
  process.stdout.write(JSON.stringify({mode,at:new Date().toISOString(),faultBoundary:'Synthetic test-data corruption only;production package/authorization/native roots untouched;no manual repair',before,after:manifest.cases.map(read)})+'\n');
 }
}finally{db.close();}
