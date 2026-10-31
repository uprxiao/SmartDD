// Isolated P09 prerequisites. Uses real immutable registries and complete Claude
// projection; records only host preparation of a canceled-before-launch run.
// No CLI/model/provider is started, and this is not a program-upgrade test.
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {AgentAdapterRegistry} from '../../../src/main/core/applications/agent-adapter-registry';
import {CapabilitySessionRegistry,applicationSkillContentHash} from '../../../src/main/core/applications/session-registry';
import {SessionCapabilityProjector} from '../../../src/main/core/applications/session-projector';
import {CapabilityRunRegistry} from '../../../src/main/core/applications/run-registry';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {ApplicationSessionDiagnostics} from '../../../src/main/core/applications/session-diagnostics';
import {ClaudeDeliveryCoordinator} from '../../../src/main/core/applications/claude-delivery';
import {capabilitySessionSnapshotSchema,applicationNativeSkillName,applicationMcpServerName} from '../../../src/shared/application-session';
import {digest} from '../../../src/main/core/applications/manifest';
async function main(){
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),root=realpathSync(process.argv[2]),projectId=process.argv[3],helper=process.argv[4];
 if(!root.startsWith('/private/tmp/willyou-m10-session-ui-')||!root.endsWith('/userdata'))throw new Error('This fixture is limited to its own driver userData');
 const db=new Database(join(root,'smartdd.db'));db.pragma('foreign_keys=ON');let runs:CapabilityRunRegistry|undefined;
 try{
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))throw new Error('Missing isolated project');
  const store=new ResourceStore(db,root),packages=new PackageRegistry(store,'private-session-precondition'),active=packages.active('mail');if(!active)throw new Error('App bootstrap required');
  const current=packages.get(active.packageHash),manifest=structuredClone(current.manifest);manifest.version='0.9.0';manifest.description='Private P09 previous-version fixture, not a published release';
  const files=Object.fromEntries(manifest.files.map(file=>[file.path,readFileSync(join(store.root,current.relativePath,file.path))])),old=await packages.install({manifest,files});
  const adapters=new AgentAdapterRegistry(store),adapter=db.prepare("SELECT adapter_hash AS hash,version FROM capability_agent_adapters WHERE agent_id='claude-code' ORDER BY version LIMIT 1").get() as {hash:string;version:string};if(!adapter)throw new Error('No original adapter');
  const taskId=randomUUID(),unknownTaskId=randomUUID(),home=join(root,'fixture-home'),cwd=join(root,'fixture-project');mkdirSync(join(home,'.claude'),{recursive:true});mkdirSync(cwd,{recursive:true});let projector:SessionCapabilityProjector;
  const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{},verifyExtraResource:(resource,snapshot)=>{if(resource.kind==='agent-adapter')adapters.verifyReference(resource,snapshot);else if(['session-projection','claude-projection-source','claude-projection-archive','claude-delivery'].includes(resource.kind))projector.verify(resource,snapshot);else throw new Error('Unexpected fixture resource');}});
  const mcp=applicationMcpServerName(digest(taskId)),plugin=join(store.root,'sessions',taskId,'claude/plugin');
  const snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId,projectId,createdAt:new Date().toISOString(),runner:'claude-code',adapterBinding:{id:'claude-code',version:adapter.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(manifest.tools.map(tool=>[tool.name,'mcp__'+mcp+'__'+tool.name]))},native:{sessionId:null,stateRoot:join(home,'.claude'),cwd},agentAtCreation:{version:'not-executed-fixture',adapterRevision:1},catalogGeneration:'private-precondition',packages:[{appId:'mail',version:old.version,packageHash:old.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(skill=>({skillId:skill.id,nativeName:applicationNativeSkillName('mail',skill.id,old.packageHash),contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(plugin,'skills',applicationNativeSkillName('mail',skill.id,old.packageHash),'SKILL.md')})),bindings:[],allowedOperations:manifest.permissions}],standardSkills:[],mcp:[{kind:'applications',serverName:mcp,protocolMajor:1,runtimeHash:manifest.runtime.hash}],provenance:'created'});
  const stored=await sessions.create(snapshot,home);projector=new SessionCapabilityProjector(store,sessions);await projector.claude(taskId);
  const now=Date.now(),put=db.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,native_session_id,state_root,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');put.run(taskId,projectId,cwd,'claude','M10 固定旧版诊断夹具',null,join(home,'.claude'),now,now);put.run(unknownTaskId,projectId,cwd,'codex','M10 未知历史诊断夹具','private-unmapped-history',join(home,'.codex'),now+1,now+1);
  runs=new CapabilityRunRegistry(store,sessions,{processes:new MacProcessIdentityReader(helper),assertCurrent:()=>{},revoke:()=>{}});const run=await runs.reserve({taskId,snapshotHash:stored.pointer.snapshotHash,bindings:[]});await run.prepare();
  // The CLI stays reserved, never armed/forked. Only file preparation is evidenced.
  const diagnostics=new ApplicationSessionDiagnostics(store,{} as never,{} as never,{runs:()=>runs});await diagnostics.prepared({schema:1,runId:run.runId,selectionHash:stored.selectionHash,cliVersion:null,adapterHash:adapter.hash,state:'prepared',issueCode:null,manifestPath:join(store.root,'sessions',taskId,'snapshot.json'),configPaths:[],preparedAt:new Date().toISOString()});await run.stop();
  let deliveryCopy:null|{relativePath:string;canarySha256:string}=null;
  if(process.env.M10_DELIVERY_COPY_FIXTURE==='1'){
   const coordinator=new ClaudeDeliveryCoordinator(store,sessions,projector,new MacProcessIdentityReader(helper),runs.instanceId),first=await coordinator.prepare(taskId,['mail']);await coordinator.cancel(first);
   const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='claude-delivery-install' AND state='committed' AND json_extract(plan_json,'$.slotId')=? ORDER BY rowid DESC LIMIT 1").get('claude-delivery-slot:'+taskId) as {plan_json:string};
   const relativePath=JSON.parse(row.plan_json).completedPending.backup,canary='Private synthetic unknown copy content; preserve';writeFileSync(join(root,relativePath,'unknown-fixture-canary'),canary);
   const next=await coordinator.prepare(taskId,['mail']);await coordinator.cancel(next);deliveryCopy={relativePath,canarySha256:digest(canary)};
  }
  if(runs.get(run.runId).state!=='stopped'||packages.active('mail')?.packageHash!==current.packageHash)throw new Error('Fixture must preserve default and start no CLI');
  console.log(JSON.stringify({kind:'non-tested prerequisite',method:'real PackageRegistry/SessionRegistry/complete Claude projection; host preparation then canceled-before-launch run, no CLI/model/provider; optional copy journal prepared through original coordinator',taskId,unknownTaskId,runId:run.runId,oldHash:old.packageHash,defaultHash:current.packageHash,selectionHash:stored.selectionHash,deliveryCopy}));
 }finally{await runs?.dispose();db.close();}
}void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
