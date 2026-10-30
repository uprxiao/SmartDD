// PH: exercise the original conservative recovery on one recorded failed U.
// Never invent an exit receipt, clear an armed window or signal a process.
import Database from 'better-sqlite3';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {recoverCapabilityRuns} from '../../../src/main/core/applications/run-recovery';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
async function main(){
 const[userData,helper,runId]=process.argv.slice(2);if(realpathSync(userData)!==userData||!userData.startsWith('/private/tmp/willyou-m10-native-terminal-cFQNRv/')||!userData.endsWith('/userdata')||runId!=='1e10e57e-d594-4565-b40a-34e247bad0f5'||!helper.startsWith('/private/tmp/willyou-m10-pg-package-20261028/')||!helper.endsWith('/native/willyou-process-identity'))throw Error('Only the recorded own PH failure is allowed');
 const db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  const processes=new MacProcessIdentityReader(helper),store=new ResourceStore(db,userData),snapshot=()=>Object.fromEntries(['tasks','projects','project_dirs','application_connections','application_project_settings','application_project_bindings','capability_active_packages','capability_session_snapshots','capability_session_refs','capability_session_identities','mail_drafts','mail_draft_revisions'].map(n=>[n,db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()])),before=snapshot(),run=db.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(runId) as {state:string;owner_pid:number;owner_started_at:string},children=db.prepare('SELECT process_id,state,pid,process_started_at FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(runId) as {state:string;pid:number|null;process_started_at:string|null}[];
  if(run.state!=='stopping'||children.length!==2||children.filter(c=>c.state==='armed'&&c.pid===null).length!==1||processes.state({pid:run.owner_pid,startedAt:run.owner_started_at})!=='stopped')throw Error('Original stopped owner/armed no-PID receipt must match');
  for(const child of children)if(child.pid&&child.process_started_at&&processes.state({pid:child.pid,startedAt:child.process_started_at})!=='stopped')throw Error('Known original child is not confirmed stopped');
  const result=await recoverCapabilityRuns(store,processes),after=db.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(runId) as {state:string;revocation_state:string;error_code:string},leases=db.prepare("SELECT owner_kind,owner_id,resource_id,state FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state<>'released'").all(runId),current=db.prepare('SELECT process_id,state,pid,process_started_at FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(runId);
  if(JSON.stringify(snapshot())!==JSON.stringify(before)||JSON.stringify(current)!==JSON.stringify(children)||after.state!=='orphaned'||after.revocation_state!=='revoked'||after.error_code!=='HOST_INTERRUPTED'||leases.length!==1||(leases[0] as {state:string}).state!=='recovery-required')throw Error('Original conservative recovery invariant failed');
  process.stdout.write(JSON.stringify({layer:'I original run-recovery module/current sources/native kernel identity;not packaged UI restart or an exit proof for unknown child',pid:process.pid,userData,runId,result,beforeRun:run,afterRun:after,children,retainedLeases:leases,businessSnapshotsRefsTasksUnchanged:true,noProcessSignalOrNewManagedLaunch:true,unknownArmedWindowRetained:true,at:new Date().toISOString()})+'\n');
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
