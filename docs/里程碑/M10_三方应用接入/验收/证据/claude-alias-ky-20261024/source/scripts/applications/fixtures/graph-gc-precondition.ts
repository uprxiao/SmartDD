// Non-tested synthetic setup; the App itself must perform cleanup/cancel/recovery.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {RuntimeRegistry} from '../../../src/main/core/applications/runtime-registry';
import {DiscoveryCatalog} from '../../../src/main/core/applications/discovery-catalog';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {applicationNativeSkillName,applicationMcpServerName,capabilitySessionSnapshotSchema} from '../../../src/shared/application-session';
import {applicationSkillContentHash,CapabilitySessionRegistry} from '../../../src/main/core/applications/session-registry';
import {projectSkillName,SessionCapabilityProjector} from '../../../src/main/core/applications/session-projector';
import {AgentAdapterRegistry} from '../../../src/main/core/applications/agent-adapter-registry';
import {bundledAgentAdapters} from '../../../src/main/core/applications/agent-assets';
import {ClaudeDeliveryCoordinator} from '../../../src/main/core/applications/claude-delivery';
import {readClaudeSlot} from '../../../src/main/core/applications/claude-delivery-state';
import {digest} from '../../../src/main/core/applications/manifest';
async function main(){
 const userData=realpathSync(process.argv[2]),home=realpathSync(process.argv[3]),helper=process.argv[4],mode=process.argv[5];
 if(!userData.startsWith('/private/tmp/willyou-m10-graph-app-')||!userData.endsWith('/userdata')||!home.startsWith(userData.slice(0,-9))||!helper.startsWith('/private/tmp/willyou-m10-'))throw Error('Only this private driver fixture is allowed');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  const processes=new MacProcessIdentityReader(helper),store=new ResourceStore(db,userData,undefined,{processes}),registry=new PackageRegistry(store,'graph-gc-private-fixture'),active=registry.active('zentao');if(!active)throw Error('App bootstrap required');
  const current=registry.get(active.packageHash),manifest=structuredClone(current.manifest);manifest.version='0.9.0';manifest.description='Synthetic unused GC graph '+mode;
  if(mode==='normal-last'){const runtime=store.get('runtime:'+manifest.runtime.hash),source=JSON.parse(readFileSync(join(store.directory(runtime),'runtime.json'),'utf8')),files=Object.fromEntries(source.files.map((f:{path:string})=>[f.path,readFileSync(join(store.directory(runtime),f.path))]));files[source.bridgeEntry]=Buffer.concat([files[source.bridgeEntry],Buffer.from('\n// isolated unused runtime fixture\n')]);manifest.runtime.hash=(await new RuntimeRegistry(store).install({id:source.id,protocolMajor:source.protocolMajor,bridgeEntry:source.bridgeEntry,files})).contentHash;}
  const files=Object.fromEntries(manifest.files.map(f=>[f.path,readFileSync(join(store.root,current.relativePath,f.path))])),old=await registry.install({manifest,files});
  const sources=manifest.skills.map(skill=>{const nativeName=applicationNativeSkillName(manifest.appId,skill.id,old.packageHash),prefix=skill.path+'/';return{nativeName,sourceHash:applicationSkillContentHash(manifest,skill.path),sourceResourceId:old.resourceId,files:Object.fromEntries(manifest.files.filter(f=>f.path.startsWith(prefix)).map(f=>{const name=f.path.slice(prefix.length),bytes=files[f.path];return[name,name==='SKILL.md'?projectSkillName(bytes,nativeName):bytes];})),executables:new Set(manifest.files.filter(f=>f.path.startsWith(prefix)&&f.executable).map(f=>f.path.slice(prefix.length)))};});
  const catalog=await new DiscoveryCatalog(store,home,processes).publish(sources);if(registry.active('zentao')?.packageHash!==current.packageHash)throw Error('Default must remain unchanged');
  let claudeFixture:unknown;
  if(mode==='claude-alias'){
   const projectId=process.argv[6],cwd=join(home,'project'),stateRoot=join(home,'.claude');mkdirSync(cwd,{mode:0o700,recursive:true});mkdirSync(stateRoot,{mode:0o700,recursive:true});if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))throw Error('Private project required');
   const adapters=new AgentAdapterRegistry(store),input=bundledAgentAdapters().find(a=>a.metadata.agentId==='claude-code')!,adapter=await adapters.install(input.metadata,input.files),taskId=randomUUID(),serverName=applicationMcpServerName(digest(taskId)),original=current.manifest;
   let projector:SessionCapabilityProjector;const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:s=>{if(s.packages.some(p=>registry.active(p.appId)?.packageHash!==p.packageHash))throw Error('Fixture default changed');},verifyExtraResource:(r,s)=>{if(r.kind==='agent-adapter')adapters.verifyReference(r,s);else projector.verify(r,s);}});projector=new SessionCapabilityProjector(store,sessions);
   const snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId,projectId,createdAt:new Date().toISOString(),runner:'claude-code',adapterBinding:{id:'claude-code',version:adapter.metadata.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(original.tools.map(t=>[t.name,'mcp__'+serverName+'__'+t.name]))},native:{sessionId:null,stateRoot,cwd},agentAtCreation:{version:adapter.metadata.cliVersions[0],adapterRevision:1},catalogGeneration:'synthetic-claude-gc-fixture',packages:[{appId:current.appId,version:current.version,packageHash:current.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:original.hostApi,dataApi:original.dataApi,runtimeHash:original.runtime.hash,toolContractMajors:Object.fromEntries(original.tools.map(t=>[t.name,t.contractMajor])),skills:original.skills.map(s=>({skillId:s.id,nativeName:applicationNativeSkillName(current.appId,s.id,current.packageHash),contentHash:applicationSkillContentHash(original,s.path),sourceRelativePath:s.path,projectionPath:join(store.root,'sessions',taskId,'claude/plugin/skills',applicationNativeSkillName(current.appId,s.id,current.packageHash),'SKILL.md')})),bindings:[],allowedOperations:original.permissions}],standardSkills:[],mcp:[{kind:'applications',serverName,protocolMajor:original.runtime.protocolMajor,runtimeHash:original.runtime.hash}],provenance:'created'});
   db.prepare("INSERT INTO tasks(id,cwd,runner,title,created_at,updated_at) VALUES(?,?,'claude','Synthetic retained Claude delivery fixture',1,1)").run(taskId,cwd);await sessions.create(snapshot,home);const full=await projector.claude(taskId);const coordinator=new ClaudeDeliveryCoordinator(store,sessions,projector,processes,store.instanceId),token=await coordinator.prepareIndependent(taskId);await coordinator.cancel(token);const slot=readClaudeSlot(store,taskId)!;
   claudeFixture={layer:'synthetic original S, full archive and real delivery coordinator; Claude CLI is absent and never invoked',taskId,slotId:'claude-delivery-slot:'+taskId,root:join(store.root,slot.root),archive:store.directory(store.get(`claude-projection-archive:${taskId}:${full.resource.contentHash}`)),snapshot};
  }
  console.log(JSON.stringify({layer:'synthetic unused package/runtime/H projections, actual registry and native kernel identity; no historical CLI session',storeId:store.storeId,oldHash:old.packageHash,currentHash:current.packageHash,oldRuntime:manifest.runtime.hash,currentRuntime:current.manifest.runtime.hash,oldRelativePath:old.relativePath,catalog,claudeFixture}));
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
