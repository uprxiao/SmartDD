const fs=require('node:fs'),{createRequire}=require('node:module');
const Database=createRequire('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/package.json')('better-sqlite3');
const file=process.argv[2];
if(!file?.startsWith('/private/tmp/willyou-m10-restore-ad-')||!file.endsWith('/userdata/smartdd.db'))throw Error('Expected this batch isolated database');
const db=new Database(file,{readonly:true,fileMustExist:true});
try{console.log(JSON.stringify({
 packages:db.prepare('SELECT * FROM capability_packages ORDER BY package_hash').all(),
 defaults:db.prepare('SELECT * FROM capability_active_packages ORDER BY app_id').all(),
 proofs:db.prepare('SELECT * FROM capability_builtin_package_sources ORDER BY package_hash,source_index_hash').all(),
 resources:db.prepare('SELECT resource_id,relative_path,generation,state,integrity FROM capability_resources ORDER BY resource_id').all(),
 restorations:db.prepare("SELECT operation_id,kind,state,error_code,plan_json FROM capability_resource_operations WHERE kind LIKE 'restore-%' ORDER BY operation_id").all(),
 held:db.prepare("SELECT count(*) AS n FROM capability_resource_leases WHERE state<>'released'").get().n,
 counts:Object.fromEntries(['tasks','capability_session_snapshots','capability_session_refs','application_invocations','mail_send_grants','application_connections'].map(t=>[t,db.prepare('SELECT count(*) AS n FROM '+t).get().n]))
}));}finally{db.close();}
