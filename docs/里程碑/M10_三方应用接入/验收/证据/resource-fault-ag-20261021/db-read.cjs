const{createRequire}=require('node:module');
const Database=createRequire('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/package.json')('better-sqlite3');
const[file,taskId]=process.argv.slice(2);if(!file?.startsWith('/private/tmp/willyou-m10-cli-ag-')||!file.endsWith('/userdata/smartdd.db')||!taskId)throw Error('Expected this batch own database/task');
const db=new Database(file,{readonly:true,fileMustExist:true});
try{console.log(JSON.stringify({
 task:db.prepare('SELECT id,project_id,native_session_id,state_root,cwd,runtime_snapshot FROM tasks WHERE id=?').get(taskId),
 snapshot:db.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').get(taskId),
 identity:db.prepare('SELECT * FROM capability_session_identities WHERE task_id=?').get(taskId),
 refs:db.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(taskId),
 runs:db.prepare('SELECT run_id,state,pid,process_started_at,snapshot_hash,bindings_json FROM capability_runs WHERE task_id=? ORDER BY started_at,run_id').all(taskId),
 children:db.prepare('SELECT p.run_id,p.kind,p.state,p.pid,p.process_started_at FROM capability_run_processes p JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY p.process_id').all(taskId),
 leases:db.prepare("SELECT l.state,l.resource_id FROM capability_resource_leases l JOIN capability_runs r ON r.run_id=l.owner_id WHERE l.owner_kind='run' AND r.task_id=? ORDER BY l.lease_id").all(taskId),
 packages:db.prepare('SELECT * FROM capability_packages ORDER BY package_hash').all(),
 resources:db.prepare('SELECT resource_id,relative_path,generation,state,integrity FROM capability_resources ORDER BY resource_id').all(),
 defaults:db.prepare('SELECT * FROM capability_active_packages ORDER BY app_id').all(),
 proofs:db.prepare('SELECT * FROM capability_builtin_package_sources ORDER BY package_hash,source_index_hash').all(),
 restoration:db.prepare("SELECT operation_id,kind,state,error_code FROM capability_resource_operations WHERE kind LIKE 'restore-%' ORDER BY operation_id").all(),
 invocation:db.prepare('SELECT * FROM application_invocations ORDER BY started_at,operation_id').all(),
 grantCount:db.prepare('SELECT count(*) AS n FROM mail_send_grants').get().n
}));}finally{db.close();}
