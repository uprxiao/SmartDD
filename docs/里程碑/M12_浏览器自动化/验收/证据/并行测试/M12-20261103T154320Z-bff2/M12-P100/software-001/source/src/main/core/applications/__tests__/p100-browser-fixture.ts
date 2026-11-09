import {EventEmitter} from 'node:events';
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {applicationNativeSkillName} from '@shared/application-session';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {SecretsStore} from '../../../secrets';
import * as schema from '../../../db/schema';
import {ProjectService} from '../../projects/project-service';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {CapabilityBundleSource} from '../bundle-source';
import {canonicalJson,digest,validatePackageBundle} from '../manifest';
import {builtinApplicationModules} from '../modules';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {applicationSkillContentHash} from '../session-registry';
import {CapabilityRunRegistry} from '../run-registry';
import {createApplicationRunPlan} from '../run-plan';
import {ApplicationService} from '../application-service';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {MacProcessIdentityReader} from '../process-identity';

/** Real module/data/SQLite/plan composition; CLI binary, peer kernel reader and native Agent are fixtures. */
export async function installBrowserFixturePackage(store:import('../resource-store').ResourceStore,distribution:string){
 cpSync(resolve('out/capability-bundles'),distribution,{recursive:true});
 const source=new CapabilityBundleSource(distribution),entry=source.index.apps.find(a=>a.appId==='browser')!,bundle=source.application(entry);if(bundle.manifest.schema!=='smartdd-app-package-v2')throw Error('Actual Browser v2 required');
 await new RuntimeRegistry(store).install(source.runtime());const trusted=new BuiltinPackageRegistry(store),installed=await trusted.install(source,entry);await trusted.packages.activate(installed.packageHash,trusted.packages.active('browser')?.generation??0);return{manifest:bundle.manifest,installed,source};
}

export async function browserListFixture(options:{nativeRoot?:boolean}={}){
 const f=await agentFixture(),reader=new FixtureProcessReader(),{manifest,installed}=await installBrowserFixturePackage(f.store,join(f.root,'browser-list-distribution'));
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),sender={sender:Object.assign(new EventEmitter(),{id:123,isDestroyed:()=>false})};
 const applications=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-executed-worker'),foxmailNative:join(f.root,'not-executed-native'),processes:reader});await applications.recover();await applications.selections.setAdded('browser',true,0);await applications.selections.select({projectId:'p1',appId:'browser',enabled:true,expectedRevision:0,connections:{}});
 const base=f.plan('codex'),adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.2.0')!,toolMajors=Object.fromEntries(applicationToolDeclarations(manifest).map(t=>[t.name,t.contractMajor])),bridge=base.mcp.find(m=>m.kind==='applications')!;
 const snapshot:CapabilitySessionSnapshot={...base,schema:3,agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{id:'codex',version:adapter.metadata.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(Object.keys(toolMajors).map(name=>[name,`mcp__${bridge.serverName}__${name}`]))},packages:[{appId:'browser',version:manifest.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:toolMajors,capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'cli',skills:manifest.skills.map(skill=>{const nativeName=applicationNativeSkillName('browser',skill.id,installed.packageHash);return{skillId:skill.id,nativeName,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions}],mcp:base.mcp.filter(m=>Object.keys(toolMajors).length>0||m.kind!=='applications').map(m=>m.kind==='applications'?{...m,runtimeHash:manifest.runtime.hash}:m)};
 const session=await f.sessions.create(snapshot,f.home),runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(selected,hash,runId)=>createApplicationRunPlan({runId,snapshot:selected,snapshotHash:hash,applications:[{manifest,packageHash:installed.packageHash,capabilities:manifest.capabilities}],skills:[],available:{mcp:true,cli:true}})});applications.attachRuns(runs);
 const run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();const rootPid=options.nativeRoot?process.pid:921001,rootBirth=options.nativeRoot?new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')).read(rootPid)?.startedAt:'darwin-proc-v1:2026:921001';if(!rootBirth)throw Error('Owned native test process identity unavailable');reader.identities.set(rootPid,rootBirth);await run.cli.attach(rootPid);
 const cli=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,applications.data),{entry:'cli',retryDelays:[0,0]}),mcp=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,applications.data),{retryDelays:[0,0]});
 const executable=join(f.root,'willyou-app');writeFileSync(executable,'Synthetic fixed binary identity; not executed\n',{mode:0o700});
 return{...f,reader,applications,sender,runs,run,cli,mcp,snapshot,executable,executableHash:digest('Synthetic fixed binary identity; not executed\n'),cleanup:async()=>{await run.cli.exited();await applications.dispose();f.cleanup();}};
}
