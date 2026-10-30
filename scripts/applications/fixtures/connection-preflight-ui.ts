// PC prerequisite only: real registry installs + synthetic non-executed retained snapshots.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {CapabilitySessionRegistry,applicationSkillContentHash} from '../../../src/main/core/applications/session-registry';
import {applicationNativeSkillName,applicationMcpServerName,capabilitySessionSnapshotSchema} from '../../../src/shared/application-session';
import {digest} from '../../../src/main/core/applications/manifest';
async function main(){
 const userData=realpathSync(process.argv[2]),projectId=process.argv[3],home=realpathSync(process.argv[4]);
 if(!userData.startsWith('/private/tmp/willyou-m10-connection-preflight-')||!userData.endsWith('/userdata')||home!==userData.slice(0,-9)+'/home')throw Error('Only PC own root');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))throw Error('Own project required');
  const store=new ResourceStore(db,userData),registry=new PackageRegistry(store,'PC isolated synthetic history'),active=registry.active('mail');if(!active)throw Error('Real initial bootstrap required');
  const current=registry.get(active.packageHash),sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{},verifyExtraResource:()=>{throw Error('No executable extra resource in PC UI prerequisite');}}),adapter=db.prepare("SELECT adapter_hash AS hash,version FROM capability_agent_adapters WHERE agent_id='codex' ORDER BY version LIMIT 1").get();if(!adapter)throw Error('Bundled adapter metadata required');
  const configs=db.prepare("SELECT id,name,identity_revision FROM application_connections WHERE provider_id='foxmail' ORDER BY name").all();if(configs.length!==3)throw Error('Three actual UI-created source connections required');const records=[];
  for(const [index,mode]of ['compatible','incompatible','unverified'].entries()){
   const connection=configs.find((c:{name:string})=>c.name==='PC '+mode+' · 合成');if(!connection)throw Error('Expected explicit UI source');
   const manifest=structuredClone(current.manifest);manifest.version='0.9.'+(index+1);manifest.description='PC public synthetic retained package;never launched or released';const contract=manifest.connectionContracts.find(c=>c.providerId==='foxmail');if(!contract)throw Error('Foxmail config contract');if(mode==='incompatible')contract.authModes=['password'];if(mode==='unverified')contract.configApiMajor=2;
   const files=Object.fromEntries(manifest.files.map(file=>[file.path,readFileSync(join(store.root,current.relativePath,file.path))])),installed=await registry.install({manifest,files}),taskId=randomUUID(),cwd=join(home,'synthetic-history'),stateRoot=join(home,'.codex');mkdirSync(cwd,{recursive:true});mkdirSync(stateRoot,{recursive:true});
   const serverName=applicationMcpServerName(digest(taskId)),snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId,projectId,createdAt:new Date().toISOString(),runner:'codex',adapterBinding:{id:'codex',version:adapter.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(manifest.tools.map(tool=>[tool.name,'mcp__'+serverName+'__'+tool.name]))},native:{sessionId:null,stateRoot,cwd},agentAtCreation:{version:'not-executed-PC-synthetic-history',adapterRevision:1},catalogGeneration:'PC explicit synthetic prerequisite',packages:[{appId:'mail',version:manifest.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(tool=>[tool.name,tool.contractMajor])),skills:manifest.skills.map(skill=>({skillId:skill.id,nativeName:applicationNativeSkillName('mail',skill.id,installed.packageHash),contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(home,'.agents/skills',applicationNativeSkillName('mail',skill.id,installed.packageHash),'SKILL.md')})),bindings:[{bindingId:'PC-public-binding-'+index,connectionId:connection.id,identityRevision:connection.identity_revision}],allowedOperations:manifest.permissions}],standardSkills:[],mcp:[{kind:'applications',serverName,protocolMajor:manifest.runtime.protocolMajor,runtimeHash:manifest.runtime.hash}],provenance:'created'});
   db.prepare("INSERT INTO tasks(id,project_id,cwd,runner,title,state_root,created_at,updated_at) VALUES(?,?,?,'codex',?,?,1,1)").run(taskId,projectId,cwd,'PC synthetic '+mode+' history',stateRoot);await sessions.create(snapshot,home);
   records.push({mode,taskId,connectionId:connection.id,version:manifest.version,packageHash:installed.packageHash,relativePath:installed.relativePath,schemaPath:join(store.root,installed.relativePath,contract.inputSchemaPath),snapshot});
  }
  if(registry.active('mail')?.packageHash!==current.packageHash)throw Error('Default must not change');console.log(JSON.stringify({layer:'I real registry install/synthetic retained history;no CLI or historic release claim',storeRoot:store.root,currentHash:current.packageHash,records}));
 }finally{db.close();}
}void main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
