// Private acceptance setup only: install a complete old-version fixture through
// the real registry. This is not proof of a program upgrade or historical release.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {CapabilitySessionRegistry,applicationSkillContentHash} from '../../../src/main/core/applications/session-registry';
import {applicationNativeSkillName,applicationMcpServerName,capabilitySessionSnapshotSchema} from '../../../src/shared/application-session';
import {digest} from '../../../src/main/core/applications/manifest';
import {RuntimeRegistry} from '../../../src/main/core/applications/runtime-registry';
import type {ApplicationManifest} from '../../../src/shared/applications';
async function main(){
const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3');
const userData=realpathSync(process.argv[2]);
if(!(userData.startsWith('/private/tmp/willyou-m10-versions-ui-')||process.argv[3]==='maintenance-wait-ui'&&userData.startsWith('/private/tmp/willyou-m10-maintenance-ui-'))||!userData.endsWith('/userdata'))throw new Error('Only this driver private fixture is allowed');
const db=new Database(join(userData,'smartdd.db'));
db.pragma('foreign_keys=ON');
try{
 const store=new ResourceStore(db,userData),registry=new PackageRegistry(store,'private-version-precondition'),active=registry.active('zentao');
 if(!active)throw new Error('Initial isolated App bootstrap is required');
 const mode=process.argv[3],projectId=process.argv[4],home=process.argv[5];
 const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{},verifyExtraResource:()=>{throw Error('No execution resource verification in a synthetic UI prerequisite');}});
 if(mode==='hold-only'||mode==='retention-matrix'||mode==='maintenance-wait-ui'){
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)||!home||!realpathSync(home).startsWith(userData.slice(0,-9)+'/'))throw Error('Private home and project required');
 }
 if(mode==='hold-only'){
  const taskId=randomUUID(),cwd=join(home,'retention-project'),stateRoot=join(home,'.codex');mkdirSync(cwd,{recursive:true});mkdirSync(stateRoot,{recursive:true});
  db.prepare("INSERT INTO tasks(id,project_id,cwd,runner,title,native_session_id,state_root,created_at,updated_at) VALUES(?,?,?,'codex','Synthetic unknown history fixture',?,?,1,1)").run(taskId,projectId,cwd,'unknown-ui-fixture-'+taskId,stateRoot);
  await sessions.holdUnknown({taskId,projectId,runner:'codex',stateRoot,cwd,sessionId:'unknown-ui-fixture-'+taskId,reason:'history-unknown'});
  console.log(JSON.stringify({kind:'non-tested prerequisite',mode,taskId,method:'Real SessionRegistry.holdUnknown; no native CLI history or process created'}));return;
 }
 const current=registry.get(active.packageHash),manifest=structuredClone(current.manifest) as ApplicationManifest;
 manifest.version='0.9.0';manifest.description='Private acceptance old-version fixture; not a published release';
 const files=Object.fromEntries(manifest.files.map(file=>[file.path,readFileSync(join(store.root,current.relativePath,file.path))]));
 let privateRuntime:{hash:string;relativePath:string}|null=null;
 if(mode==='maintenance-wait-ui'){
  const runtime=store.get('runtime:'+manifest.runtime.hash),source=JSON.parse(readFileSync(join(store.root,runtime.relativePath,'runtime.json'),'utf8')),runtimeFiles:Record<string,Buffer>=Object.fromEntries(source.files.map((file:{path:string})=>[file.path,readFileSync(join(store.root,runtime.relativePath,file.path))]));
  runtimeFiles[source.bridgeEntry]=Buffer.concat([runtimeFiles[source.bridgeEntry],Buffer.from('\n// Isolated unused maintenance UI prerequisite; never executed.\n')]);const installed=await new RuntimeRegistry(store).install({id:source.id,protocolMajor:source.protocolMajor,bridgeEntry:source.bridgeEntry,files:runtimeFiles});manifest.runtime.hash=installed.contentHash;privateRuntime={hash:installed.contentHash,relativePath:installed.relativePath};
 }
 const previous=await registry.install({manifest,files});
 const retained=[];
 if(mode==='retention-matrix'){
  const adapter=db.prepare("SELECT adapter_hash AS hash,version FROM capability_agent_adapters WHERE agent_id='codex' ORDER BY version LIMIT 1").get() as {hash:string;version:string}|undefined;if(!adapter)throw Error('Actual bundled Codex adapter required');
  for(const [version,deleted] of [['0.9.1',false],['0.9.2',true]] as const){
   const input=structuredClone(current.manifest);input.version=version;input.description='Synthetic valid retained UI snapshot; never launched or released';const installed=await registry.install({manifest:input,files});
   const taskId=randomUUID(),cwd=join(home,'retention-project'),stateRoot=join(home,'.codex');mkdirSync(cwd,{recursive:true});mkdirSync(stateRoot,{recursive:true});const serverName=applicationMcpServerName(digest(taskId));
   const snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId,projectId,createdAt:new Date().toISOString(),runner:'codex',adapterBinding:{id:'codex',version:adapter.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(input.tools.map(tool=>[tool.name,'mcp__'+serverName+'__'+tool.name]))},native:{sessionId:null,stateRoot,cwd},agentAtCreation:{version:'not-executed-ui-fixture',adapterRevision:1},catalogGeneration:'synthetic-retention-ui',packages:[{appId:'zentao',version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:input.hostApi,dataApi:input.dataApi,runtimeHash:input.runtime.hash,toolContractMajors:Object.fromEntries(input.tools.map(tool=>[tool.name,tool.contractMajor])),skills:input.skills.map(skill=>({skillId:skill.id,nativeName:applicationNativeSkillName('zentao',skill.id,installed.packageHash),contentHash:applicationSkillContentHash(input,skill.path),sourceRelativePath:skill.path,projectionPath:join(home,'.agents/skills',applicationNativeSkillName('zentao',skill.id,installed.packageHash),'SKILL.md')})),bindings:[],allowedOperations:input.permissions}],standardSkills:[],mcp:[{kind:'applications',serverName,protocolMajor:input.runtime.protocolMajor,runtimeHash:input.runtime.hash}],provenance:'created'});
   db.prepare("INSERT INTO tasks(id,project_id,cwd,runner,title,state_root,created_at,updated_at) VALUES(?,?,?,'codex',?,?,1,1)").run(taskId,projectId,cwd,'Synthetic retained snapshot '+version,stateRoot);await sessions.create(snapshot,home);
   if(deleted){await sessions.tombstone(taskId);db.prepare('DELETE FROM tasks WHERE id=?').run(taskId);}
   retained.push({version,taskId,packageHash:installed.packageHash,relativePath:installed.relativePath,deleted});
  }
 }
 if(registry.active('zentao')?.packageHash!==current.packageHash)throw new Error('Fixture must not switch the real default');
 console.log(JSON.stringify({kind:'non-tested prerequisite',method:'Real PackageRegistry.install; optional valid S/tombstone or unused distinct runtime, no native CLI or program-upgrade claim',mode,storeId:store.storeId,oldHash:previous.packageHash,currentHash:current.packageHash,oldRelativePath:previous.relativePath,privateRuntime,retained}));
}finally{db.close();}
}void main().catch(error=>{process.stderr.write(String(error)+'\\n');process.exitCode=1;});
