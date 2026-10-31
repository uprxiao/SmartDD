// Private T61 fixture: production M4 producer/retention, real owner and normal cleanup.
// No secret is stored; any cipher use is a fixture failure, never a plaintext fallback.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createInterface} from 'node:readline';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../src/main/db/schema';
import {SecretsStore} from '../../../src/main/secrets';
import {ProjectService} from '../../../src/main/core/projects/project-service';
import {CapabilityService,MCP_CAPABILITY} from '../../../src/main/core/capabilities/capability-service';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {CapabilitySessionRegistry} from '../../../src/main/core/applications/session-registry';
import {LegacyTaskRetention} from '../../../src/main/core/applications/legacy-task-retention';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {digest} from '../../../src/main/core/applications/manifest';

async function main(){
const input=JSON.parse(readFileSync(process.argv[2],'utf8')) as {root:string;userData:string;home:string;state:string;cwd:string;projectId:string;profileId:string;taskId:string;cli:string;flags:string[];processHelper:string;prompt:string};
assert(input.root.startsWith('/private/tmp/willyou-m10-legacy-history-'));
for(const path of [input.userData,input.home,input.state,input.cwd])assert(path.startsWith(input.root+'/'));
const sqlite=new Database(join(input.userData,'smartdd.db'));sqlite.pragma('foreign_keys=ON');
const db=drizzle(sqlite,{schema});let cipherCalls=0;
const forbidden=()=>{cipherCalls++;throw Error('No cipher access is allowed in this credential-free fixture');};
const secrets=new SecretsStore(db,{isAvailable:forbidden,encrypt:forbidden,decrypt:forbidden});
const projects=new ProjectService(db,secrets),capabilities=new CapabilityService({db,projects,secrets,userData:input.userData});
capabilities.setEnabled(input.projectId,MCP_CAPABILITY,false); // Standard Skills only; no project resource access.
const runtime=capabilities.prepare({projectId:input.projectId,taskId:input.taskId,runner:'codex',cwd:input.cwd,home:input.home,profileArgs:input.flags});
const raw=JSON.stringify(runtime.snapshot,null,2),at=Date.now();
sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,ai_profile_id,ai_profile_name,native_session_id,state_root,title,first_message,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,'codex',?,'Private legacy profile',NULL,?,'Known M4 fixture',?,?,?,?)").run(input.taskId,input.projectId,input.cwd,input.profileId,input.state,input.prompt,raw,at,at);
const oldSkills=runtime.snapshot.skills.filter(skill=>skill.enabled).map(skill=>({id:skill.skillId,name:skill.name,path:skill.path,hash:skill.hash,bodySha256:digest(readFileSync(skill.path)),body:readFileSync(skill.path,'utf8')}));assert(oldSkills.length>0);
const launch=runtime.wrap(input.cli,[...input.flags,...runtime.args,'exec','--json','--skip-git-repo-check',input.prompt]);
console.log(JSON.stringify({phase:'prepared',pid:process.pid,launch,env:runtime.env,raw,snapshot:runtime.snapshot,oldSkills}));
const lines=createInterface({input:process.stdin});
try{
 const line=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Private native execution did not return identity')),60000);lines.once('line',value=>{clearTimeout(timer);resolve(value);});});
 const message=JSON.parse(line);assert(typeof message.nativeId==='string'&&/^[a-f0-9-]{36}$/.test(message.nativeId));
 sqlite.prepare('UPDATE tasks SET native_session_id=?,native_history_observed=1 WHERE id=?').run(message.nativeId,input.taskId);
 const store=new ResourceStore(sqlite,input.userData,undefined,{processes:new MacProcessIdentityReader(input.processHelper)});
 const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('Legacy fixture must not select modern applications');}});
 const identity={taskId:input.taskId,projectId:input.projectId,runner:'codex' as const,stateRoot:input.state,cwd:input.cwd,sessionId:message.nativeId,home:input.home};
 await sessions.holdUnknown({...identity,reason:'history-unknown'});
 const retained=await new LegacyTaskRetention(store).prepare(identity,runtime.snapshot);assert.equal(retained.state,'prepared');assert.equal(cipherCalls,0);
 const manifestPath=runtime.snapshot.manifestPath;runtime.release();assert(!existsSync(manifestPath),'Normal original owner cleanup must remove the transient manifest');
 const removed=oldSkills[0];assert(removed.path.startsWith(join(input.home,'.agents/skills')+'/'));assert.equal(digest(readFileSync(removed.path)),removed.bodySha256);
 rmSync(dirname(removed.path),{recursive:true}); // Explicit missing-owned-H fixture; exact source retained above.
 assert(!existsSync(removed.path));
 const result={phase:'retained-and-cleaned',pid:process.pid,identity,retained,raw,oldSkills,removedPath:removed.path,cipherCalls,manifestAbsent:true};
 writeFileSync(join(input.root,'legacy-source-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{lines.close();capabilities.dispose();sqlite.close();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
