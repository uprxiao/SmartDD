import {randomUUID} from 'node:crypto';
import {FixtureProcessReader} from './run-fixture';
import {z} from 'zod';
import {connectionConfigSchema} from '@shared/application-connections';
import fs from 'node:fs';
import {builtinConfigViews,ConfigViewRegistry} from '../config-view-registry';
import Database from 'better-sqlite3';
import {mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {openManagedDatabase} from '../../../db/managed-client';
import {runBundledMigrations} from '../../../db/migrations';
import {acquireDatabaseAccess,type DatabaseAccessLease} from '../../../db/database-access-gate';
import {ResourceStore} from '../resource-store';
import {RuntimeRegistry} from '../runtime-registry';
import {PackageRegistry} from '../package-registry';
import {planApplicationActivation} from '../activation-preflight';
import {activatePreparedPackages} from '../activation-maintenance';
import {fixtureBundle} from './fixtures';
import {canonicalJson,digest,validateBundle} from '../manifest';
let root:string,db:Database.Database,store:ResourceStore,lease:DatabaseAccessLease,packages:PackageRegistry,hash:string;
beforeEach(async()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-activation-maintenance-')));db=new Database(join(root,'smartdd.db'));db.pragma('journal_mode=WAL');runBundledMigrations(db);store=new ResourceStore(db,root);lease=await acquireDatabaseAccess(root,'maintenance');
 hash=(await new RuntimeRegistry(store).install({id:'applications',protocolMajor:1,bridgeEntry:'bridge.cjs',files:{'bridge.cjs':Buffer.from('module.exports={}')}})).contentHash;packages=new PackageRegistry(store,'test');
});
afterEach(()=>{lease.release();db.close();rmSync(root,{recursive:true,force:true});});
async function install(migration=false){const source=fixtureBundle();source.manifest.runtime.hash=hash;const schema=Buffer.from(JSON.stringify({type:'object',properties:{kind:{const:'zentao'},baseUrl:{type:'string'},username:{type:'string'},authMode:{const:'token'}},required:['kind','baseUrl','username','authMode'],additionalProperties:false}));source.files['schemas/connection.json']=schema;Object.assign(source.manifest.files.find(f=>f.path==='schemas/connection.json')!,{size:schema.length,sha256:digest(schema)});if(migration){const bytes=Buffer.from('trusted migration');source.files['migrations/one.sql']=bytes;source.manifest.files.push({path:'migrations/one.sql',size:bytes.length,sha256:digest(bytes),executable:false});source.manifest.migrations=[{id:'one',from:0,to:1,file:'migrations/one.sql',checksum:digest(bytes)}];}return packages.install(source);}
it.skipIf(process.platform!=='darwin')('backs up the live file and commits activation, operation receipt and maintenance release together',async()=>{
 const target=await install(),result=await activatePreparedPackages({packages,lease,buildId:'test-build',requests:[{hash:target.packageHash,expectedGeneration:0}]});
 expect(packages.active('zentao')).toEqual(result.result[0]);expect(db.prepare('SELECT maintenance_state,maintenance_operation_id FROM capability_store_state').get()).toEqual({maintenance_state:'ready',maintenance_operation_id:null});
 const operation=db.prepare('SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(result.operationId) as {state:string;plan_json:string};expect(operation.state).toBe('committed');const plan=JSON.parse(operation.plan_json);expect(plan.result).toEqual(result.result);expect(plan.preflight.issues).toEqual([]);expect(plan.preflight.planHash).toMatch(/^[a-f0-9]{64}$/);expect(plan.backup.applications.defaults).toEqual([]);expect(existsSync(join(root,'backups/m10',result.operationId,'smartdd.db'))).toBe(true);
},15000);
it.skipIf(process.platform!=='darwin')('retains verified backup and pending ownership when an application migration fails, with no partial default or schema',async()=>{
 const target=await install(true);packages=new PackageRegistry(store,'test',[{appId:'zentao',id:'one',checksum:digest('trusted migration'),run:connection=>{connection.exec('CREATE TABLE attempted(value TEXT)');throw new Error('migration failed');}}]);
 await expect(activatePreparedPackages({packages,lease,buildId:'test-build',requests:[{hash:target.packageHash,expectedGeneration:0}]})).rejects.toThrow('migration failed');
 expect(packages.active('zentao')).toBeNull();expect(db.prepare("SELECT name FROM sqlite_master WHERE name='attempted'").get()).toBeUndefined();expect(db.prepare("SELECT state FROM capability_resource_operations WHERE kind='application-activation'").get()).toEqual({state:'verified'});expect(db.prepare('SELECT maintenance_state FROM capability_store_state').get()).toEqual({maintenance_state:'pending'});
 await expect(packages.activate(target.packageHash,0)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
 const pending=db.prepare("SELECT operation_id,plan_json FROM capability_resource_operations WHERE kind='application-activation'").get() as {operation_id:string;plan_json:string};
 const originalBackup=JSON.parse(pending.plan_json).backup;
 db.close();db=new Database(join(root,'smartdd.db'));store=new ResourceStore(db,root);let runs=0;
 packages=new PackageRegistry(store,'test',[{appId:'zentao',id:'one',checksum:digest('trusted migration'),run:connection=>{runs++;connection.exec('CREATE TABLE attempted(value TEXT)');}}]);
 const resumed=await activatePreparedPackages({packages,lease,buildId:'test-build',operationId:pending.operation_id,requests:[{hash:target.packageHash,expectedGeneration:0}]});
 expect(resumed.operationId).toBe(pending.operation_id);expect(runs).toBe(1);
 const committed=db.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(pending.operation_id) as {plan_json:string};expect(JSON.parse(committed.plan_json).backup).toEqual(originalBackup);
 db.exec("INSERT INTO attempted VALUES('new business after upgrade')");
 expect(await activatePreparedPackages({packages,lease,buildId:'test-build',operationId:pending.operation_id,requests:[{hash:target.packageHash,expectedGeneration:0}]})).toEqual(resumed);
 expect(runs).toBe(1);expect(db.prepare('SELECT * FROM attempted').all()).toEqual([{value:'new business after upgrade'}]);

},15000);
it.skipIf(process.platform!=='darwin').each(['ui','index-job'])('refuses an active %s resource consumer and activates only after it releases',async ownerKind=>{
 const target=await install(),requests=[{hash:target.packageHash,expectedGeneration:0}];
 await store.use(target.resourceId,ownerKind,'existing-consumer',async()=>{
  const before=db.prepare('SELECT * FROM capability_active_packages').all();
  await expect(activatePreparedPackages({packages,lease,buildId:'test-build',requests})).rejects.toThrow('尚未停妥');
  expect(db.prepare("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([]);
  expect(db.prepare('SELECT * FROM capability_active_packages').all()).toEqual(before);
  expect(db.prepare("SELECT owner_kind,state FROM capability_resource_leases WHERE owner_id='existing-consumer'").get()).toEqual({owner_kind:ownerKind,state:'active'});
 });
 expect(db.prepare("SELECT state FROM capability_resource_leases WHERE owner_id='existing-consumer'").get()).toEqual({state:'released'});
 const result=await activatePreparedPackages({packages,lease,buildId:'test-build',requests});
 expect(packages.active('zentao')).toEqual(result.result[0]);
 expect(db.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='application-activation' AND state='committed'").get()).toEqual({n:1});
},15000);

it.skipIf(process.platform!=='darwin')('retries a failed backup under the same operation using a new immutable backup identity',async()=>{
 const target=await install(),requests=[{hash:target.packageHash,expectedGeneration:0}];const spy=vi.spyOn(db,'backup').mockRejectedValueOnce(new Error('copy interrupted'));
 try{await expect(activatePreparedPackages({packages,lease,buildId:'test-build',requests})).rejects.toThrow('copy interrupted');}finally{spy.mockRestore();}
 const row=db.prepare("SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'").get() as {operation_id:string;state:string};expect(row.state).toBe('preparing');
 await expect(activatePreparedPackages({packages,lease,buildId:'different-build',operationId:row.operation_id,requests})).rejects.toThrow('计划');
 const result=await activatePreparedPackages({packages,lease,buildId:'test-build',operationId:row.operation_id,requests});expect(result.operationId).toBe(row.operation_id);
 const operation=db.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(row.operation_id) as {plan_json:string};expect(JSON.parse(operation.plan_json).backup.operationId).not.toBe(row.operation_id);expect(existsSync(join(root,'backups/m10',row.operation_id,'operation.json'))).toBe(true);
},15000);

it.skipIf(process.platform!=='darwin')('runs pending activation recovery under exclusive startup ownership before returning a live client',async()=>{
 const target=await install(),requests=[{hash:target.packageHash,expectedGeneration:0}],spy=vi.spyOn(db,'backup').mockRejectedValueOnce(new Error('initial backup interrupted'));
 try{await expect(activatePreparedPackages({packages,lease,buildId:'test-build',requests})).rejects.toThrow('initial backup interrupted');}finally{spy.mockRestore();}
 db.close();lease.release();let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined,called=false;
 try{
  await expect(openManagedDatabase(join(root,'smartdd.db'))).rejects.toThrow('应用升级待恢复');
  client=await openManagedDatabase(join(root,'smartdd.db'),{recoverActivation:async(reopened,maintenance,id)=>{expect(maintenance.mode).toBe('maintenance');called=true;await activatePreparedPackages({packages:new PackageRegistry(reopened,'test'),lease:maintenance,operationId:id,buildId:'test-build',requests});}});
  expect(called).toBe(true);expect(client.sqlite.prepare('SELECT maintenance_state FROM capability_store_state').get()).toEqual({maintenance_state:'ready'});expect(client.sqlite.prepare('SELECT package_hash FROM capability_active_packages').get()).toEqual({package_hash:target.packageHash});
 }finally{client?.close();db=new Database(join(root,'smartdd.db'));}
},20000);

it('preflights without writes and refuses changed default generations or unverifiable historical references',async()=>{
 const target=await install(),requests=[{hash:target.packageHash,expectedGeneration:0}],before=db.serialize();
 expect(planApplicationActivation(packages,requests).issues).toEqual([]);expect(db.serialize()).toEqual(before);
 expect(planApplicationActivation(packages,[{hash:target.packageHash,expectedGeneration:1}]).issues).toContainEqual({code:'DEFAULT_CHANGED',packageHash:target.packageHash});
 db.prepare("INSERT INTO capability_session_snapshots VALUES('legacy',2,'{}','unknown','now','unknown','hold')").run();db.prepare("INSERT INTO capability_session_refs VALUES('legacy','application-package',?,?,?)").run(target.resourceId,'f'.repeat(64),target.relativePath);
 const preserved=db.serialize(),plan=planApplicationActivation(packages,requests);expect(plan.issues).toContainEqual({code:'HISTORICAL_REFERENCE_UNVERIFIED',taskId:'legacy'});expect(plan.issues).toContainEqual({code:'RETAINED_PACKAGE_INCOMPATIBLE',causeCode:'NOT_FOUND',packageHash:'f'.repeat(64),taskId:'legacy'});expect(db.serialize()).toEqual(preserved);
});

it.skipIf(process.platform!=='darwin')('rejects insufficient space before creating an upgrade intent',async()=>{
 const target=await install(),stat=fs.statfsSync(root,{bigint:true}),spy=vi.spyOn(fs,'statfsSync').mockReturnValue({...stat,bavail:0n});
 try{
  expect(planApplicationActivation(packages,[{hash:target.packageHash,expectedGeneration:0}]).issues).toContainEqual({code:'INSUFFICIENT_SPACE'});
  await expect(activatePreparedPackages({packages,lease,buildId:'test',requests:[{hash:target.packageHash,expectedGeneration:0}]})).rejects.toThrow('INSUFFICIENT_SPACE');
 }finally{spy.mockRestore();}
 expect(db.prepare("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([]);expect(packages.active('zentao')).toBeNull();
},15000);
it.skipIf(process.platform!=='darwin')('reports invalid current connection contracts without exposing their configuration or creating upgrade intent',async()=>{
 const target=await install();db.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('test-connection','zentao','zentao','fixture',?,1,1,1,'{}','identity',1,1,1,'connected','healthy','now','now')").run('{"kind":"zentao","secretCanary":"must-not-appear"}');
 const requests=[{hash:target.packageHash,expectedGeneration:0}],plan=planApplicationActivation(packages,requests);expect(plan.issues).toContainEqual({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'CONFIG_INCOMPATIBLE',packageHash:target.packageHash,connectionId:'test-connection'});expect(JSON.stringify(plan)).not.toContain('must-not-appear');
 await expect(activatePreparedPackages({packages,lease,buildId:'test',requests})).rejects.toThrow('CONNECTION_CONTRACT_UNVERIFIED');expect(db.prepare("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([]);
},15000);

it.skipIf(process.platform!=='darwin')('verifies the backup before materializing a prospective package and only then switches its default',async()=>{
 const source=fixtureBundle('3.0.0');source.manifest.runtime.hash=hash;const candidate=validateBundle(source),requests=[{hash:candidate.packageHash,expectedGeneration:0}];
 let prepared=false;
 const result=await activatePreparedPackages({packages,lease,buildId:'test-build',requests,prepare:{targets:[{packageHash:candidate.packageHash,appId:candidate.manifest.appId,resourceId:'app:'+candidate.packageHash,manifest:candidate.manifest}],materialize:async()=>{
  const operation=db.prepare("SELECT state,plan_json FROM capability_resource_operations WHERE kind='application-activation'").get() as {state:string;plan_json:string};expect(operation.state).toBe('verified');const saved=JSON.parse(operation.plan_json);expect(existsSync(join(root,'backups/m10',saved.backup.operationId,'smartdd.db'))).toBe(true);expect(packages.active('zentao')).toBeNull();expect(packages.list()).toEqual([]);
  await packages.install(source);prepared=true;
 }}});
 expect(prepared).toBe(true);expect(packages.active('zentao')).toEqual(result.result[0]);
},15000);

it.skipIf(process.platform!=='darwin')('includes runtime staging in capacity and blocks before intent or materialization',async()=>{
 const target=await install(),requests=[{hash:target.packageHash,expectedGeneration:0}];
 const baseline=planApplicationActivation(packages,requests),extra=32*1024*1024;
 const stat=fs.statfsSync(root,{bigint:true});const spy=vi.spyOn(fs,'statfsSync').mockReturnValue({...stat,bsize:1n,bavail:BigInt(baseline.requiredBytes+extra-1)});
 const materialize=vi.fn(async()=>{});
 try{
  expect(planApplicationActivation(packages,requests,[],extra).requiredBytes).toBe(baseline.requiredBytes+extra);
  await expect(activatePreparedPackages({packages,lease,buildId:'capacity',requests,prepare:{targets:[],additionalStagingBytes:extra,materialize}})).rejects.toThrow('INSUFFICIENT_SPACE');
  expect(materialize).not.toHaveBeenCalled();expect(db.prepare("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([]);
 }finally{spy.mockRestore();}
},15000);

it('binds upgrade preflight to converter evidence and reports missing converters without disclosing configuration',async()=>{
 const target=await install();const config={kind:'zentao',baseUrl:'https://example.test/private/',username:'private-user-canary',authMode:'token'};
 db.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('converter-connection','zentao','zentao','fixture',?,1,1,1,'{}','identity',1,1,1,'connected','healthy','now','now')").run(JSON.stringify(config));
 const identity={providerId:'zentao',serviceId:'isolated-service',accountId:'tester',contractMajor:1};db.prepare('UPDATE application_connections SET verified_identity_json=?,identity_hash=? WHERE id=?').run(JSON.stringify(identity),digest(canonicalJson(identity)),'converter-connection');
 const requests=[{hash:target.packageHash,expectedGeneration:0}],before=db.serialize(),initial=planApplicationActivation(packages,requests);expect(initial.issues).toEqual([]);
 const schemaPath=target.manifest.connectionContracts[0].inputSchemaPath,schemaBytes=fs.readFileSync(join(store.root,target.relativePath,schemaPath));
 const prospective={packageHash:target.packageHash,appId:target.appId,resourceId:target.resourceId,manifest:target.manifest,schemaSources:{[schemaPath]:schemaBytes}};
 const preview=planApplicationActivation(packages,requests,[prospective]);expect(preview.issues).toEqual([]);expect(preview.referenceHash).toBe(initial.referenceHash);
 for(const schemaSources of [{},{[schemaPath]:Buffer.from('{}')}])expect(planApplicationActivation(packages,requests,[{...prospective,schemaSources}]).issues).toContainEqual({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'HASH_MISMATCH',packageHash:target.packageHash,connectionId:'converter-connection'});

 const original=builtinConfigViews.resolve.bind(builtinConfigViews),spy=vi.spyOn(builtinConfigViews,'resolve');
 try{spy.mockImplementation((...args)=>({...original(...args),converterHash:'f'.repeat(64)}));const changed=planApplicationActivation(packages,requests);expect(changed.referenceHash).not.toBe(initial.referenceHash);expect(changed.planHash).not.toBe(initial.planHash);
 spy.mockImplementation(()=>{throw Error('private-user-canary');});const missing=planApplicationActivation(packages,requests);expect(missing.issues).toContainEqual({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'CAPABILITY_UNAVAILABLE',packageHash:target.packageHash,connectionId:'converter-connection'});expect(JSON.stringify(missing)).not.toContain('private-user-canary');expect(db.serialize()).toEqual(before);
 }finally{spy.mockRestore();}
});

it('uses the same trusted schema2 converter in upgrade preview and final activation recheck',async()=>{
 const target=await install(),schema=z.object({kind:z.literal('zentao'),serviceUrl:z.url(),username:z.string(),authMode:z.literal('token')}).strict();
 const physical={kind:'zentao',serviceUrl:'https://fixture.example.test/',username:'test',authMode:'token'};
 db.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,config_schema_version,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('schema2','zentao','zentao','fixture',?,2,1,1,1,'{}','identity',1,1,1,'connected','healthy','now','now')").run(JSON.stringify(physical));
 const views=new ConfigViewRegistry([{providerId:'zentao',sourceSchemaVersion:2,targetApiMajor:1,identityContractMajor:1,implementationVersion:'upgrade-fixture-2',sourceSchema:schema,targetSchema:connectionConfigSchema,authentication:()=> 'token',outputAuthentication:()=> 'token',authModes:['token'],convert:(value:unknown)=>{const c=schema.parse(value);return{kind:c.kind,baseUrl:c.serviceUrl,username:c.username,authMode:c.authMode};}}]);
 const identity={providerId:'zentao',serviceId:'isolated-service',accountId:'tester',contractMajor:1};db.prepare('UPDATE application_connections SET verified_identity_json=?,identity_hash=? WHERE id=?').run(JSON.stringify(identity),digest(canonicalJson(identity)),'schema2');
 const configuration={parseConfig:(input:unknown)=>schema.parse(input),views},requests=[{hash:target.packageHash,expectedGeneration:0}];
 expect(planApplicationActivation(packages,requests).issues).toContainEqual({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'CONFIG_INCOMPATIBLE',packageHash:target.packageHash,connectionId:'schema2'});
 expect(planApplicationActivation(packages,requests,[],0,configuration).issues).toEqual([]);
 const result=await activatePreparedPackages({packages,lease,buildId:'schema2-build',requests,configuration});
 expect(packages.active('zentao')).toEqual(result.result[0]);
 expect(db.prepare("SELECT config_json,config_schema_version FROM application_connections WHERE id='schema2'").get()).toEqual({config_json:JSON.stringify(physical),config_schema_version:2});
},15000);

it.each(['empty','wrong-provider','unsupported-contract','hash-mismatch'])('refuses %s persisted connection identity before claiming upgrade compatibility',async fault=>{
 const target=await install(),config={kind:'zentao',baseUrl:'https://identity.example.test/',username:'tester',authMode:'token'};
 db.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('unknown-identity','zentao','zentao','fixture',?,1,1,1,'{}','identity',1,1,1,'connected','healthy','now','now')").run(JSON.stringify(config));
 const identity={providerId:fault==='wrong-provider'?'smtp':'zentao',serviceId:'https://identity.example.test/',accountId:'tester',contractMajor:fault==='unsupported-contract'?2:1};
 if(fault!=='empty')db.prepare("UPDATE application_connections SET verified_identity_json=?,identity_hash=? WHERE id='unknown-identity'").run(JSON.stringify(identity),fault==='hash-mismatch'?'changed':digest(canonicalJson(identity)));
 const before=db.serialize(),plan=planApplicationActivation(packages,[{hash:target.packageHash,expectedGeneration:0}]);
 expect(plan.issues).toContainEqual({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'AUTH_REQUIRED',packageHash:target.packageHash,connectionId:'unknown-identity'});
 expect(db.serialize()).toEqual(before);
});

it.skipIf(process.platform!=='darwin')('rejects identity drift between final preview and the activation transaction',async()=>{
 const target=await install(),config={kind:'zentao',baseUrl:'https://race.example.test/',username:'tester',authMode:'token'},identity={providerId:'zentao',serviceId:'https://race.example.test/',accountId:'tester',contractMajor:1};
 db.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('identity-race','zentao','zentao','fixture',?,1,1,1,?,?,1,1,1,'connected','healthy','now','now')").run(JSON.stringify(config),JSON.stringify(identity),digest(canonicalJson(identity)));
 const original=packages.activateSet.bind(packages);
 vi.spyOn(packages,'activateSet').mockImplementationOnce(async(...args)=>{
  // Simulate a writer completing while activation waits to enter its transaction.
  db.prepare("UPDATE application_connections SET identity_revision=identity_revision+1 WHERE id='identity-race'").run();
  return original(...args);
 });
 await expect(activatePreparedPackages({packages,lease,buildId:'identity-race',requests:[{hash:target.packageHash,expectedGeneration:0}]})).rejects.toThrow('兼容状态变化');
 expect(packages.active('zentao')).toBeNull();
 expect(db.prepare("SELECT state FROM capability_resource_operations WHERE kind='application-activation'").get()).toEqual({state:'verified'});
 expect(db.prepare("SELECT identity_revision FROM application_connections WHERE id='identity-race'").get()).toEqual({identity_revision:2});
},15000);

async function qrActivationOwner(){
 const target=await install(),operationId=randomUUID(),oldIdentity='darwin-proc-v1:100:1',processes=new FixtureProcessReader();
 const plan={operationId,storeId:store.storeId,requests:[{hash:target.packageHash,expectedGeneration:0}]};
 db.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'application-activation',?,'verified',?,'now','now')").run(operationId,store.storeId,canonicalJson(plan));
 db.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'application-activation',?,'stopped-owner',?,?,'active','now')").run(randomUUID(),target.resourceId,operationId,process.pid,oldIdentity);
 processes.identities.set(process.pid,'darwin-proc-v1:100:2');return{operationId,processes,scoped:new ResourceStore(db,root,undefined,{processes})};
}
it('QR checks stopped activation identities outside the business transaction',async()=>{
 const x=await qrActivationOwner(),state=x.processes.state.bind(x.processes);let calls=0;const watch=vi.spyOn(x.processes,'state').mockImplementation(identity=>{calls++;expect(db.inTransaction).toBe(false);return state(identity);});
 try{await x.scoped.recoverActivationLeases(x.operationId,lease);expect(calls).toBeGreaterThan(0);expect(db.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='application-activation' AND owner_id=?").all(x.operationId)).toEqual([{state:'released'}]);}
 finally{watch.mockRestore();}
});
it('QR preserves an activation lease when its plan changes during the identity query',async()=>{
 const x=await qrActivationOwner(),state=x.processes.state.bind(x.processes);let changed=false;const watch=vi.spyOn(x.processes,'state').mockImplementation(identity=>{if(!changed){changed=true;const row=db.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(x.operationId) as {plan_json:string};const plan=JSON.parse(row.plan_json);plan.concurrentMarker='preserve';db.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(canonicalJson(plan),x.operationId);}return state(identity);});
 try{await expect(x.scoped.recoverActivationLeases(x.operationId,lease)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(changed).toBe(true);expect(db.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='application-activation' AND owner_id=?").all(x.operationId)).toEqual([{state:'active'}]);}
 finally{watch.mockRestore();}
});
