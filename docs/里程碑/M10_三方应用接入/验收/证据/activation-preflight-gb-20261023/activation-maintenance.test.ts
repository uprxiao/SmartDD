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
import {digest} from '../manifest';
let root:string,db:Database.Database,store:ResourceStore,lease:DatabaseAccessLease,packages:PackageRegistry,hash:string;
beforeEach(async()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-activation-maintenance-')));db=new Database(join(root,'smartdd.db'));db.pragma('journal_mode=WAL');runBundledMigrations(db);store=new ResourceStore(db,root);lease=await acquireDatabaseAccess(root,'maintenance');
 hash=(await new RuntimeRegistry(store).install({id:'applications',protocolMajor:1,bridgeEntry:'bridge.cjs',files:{'bridge.cjs':Buffer.from('module.exports={}')}})).contentHash;packages=new PackageRegistry(store,'test');
});
afterEach(()=>{lease.release();db.close();rmSync(root,{recursive:true,force:true});});
async function install(migration=false){const source=fixtureBundle();source.manifest.runtime.hash=hash;if(migration){const bytes=Buffer.from('trusted migration');source.files['migrations/one.sql']=bytes;source.manifest.files.push({path:'migrations/one.sql',size:bytes.length,sha256:digest(bytes),executable:false});source.manifest.migrations=[{id:'one',from:0,to:1,file:'migrations/one.sql',checksum:digest(bytes)}];}return packages.install(source);}
it.skipIf(process.platform!=='darwin')('backs up the live file and commits activation, operation receipt and maintenance release together',async()=>{
 const target=await install(),result=await activatePreparedPackages({packages,lease,buildId:'test-build',requests:[{hash:target.packageHash,expectedGeneration:0}]});
 expect(packages.active('zentao')).toEqual(result.result[0]);expect(db.prepare('SELECT maintenance_state,maintenance_operation_id FROM capability_store_state').get()).toEqual({maintenance_state:'ready',maintenance_operation_id:null});
 const operation=db.prepare('SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(result.operationId) as {state:string;plan_json:string};expect(operation.state).toBe('committed');const plan=JSON.parse(operation.plan_json);expect(plan.result).toEqual(result.result);expect(plan.backup.applications.defaults).toEqual([]);expect(existsSync(join(root,'backups/m10',result.operationId,'smartdd.db'))).toBe(true);
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
it.skipIf(process.platform!=='darwin')('refuses an existing resource consumer before writing an upgrade intent',async()=>{
 const target=await install();await store.use(target.resourceId,'ui','existing-consumer',async()=>{
  await expect(activatePreparedPackages({packages,lease,buildId:'test-build',requests:[{hash:target.packageHash,expectedGeneration:0}]})).rejects.toThrow('尚未停妥');
 });expect(db.prepare("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([]);expect(packages.active('zentao')).toBeNull();
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
 const preserved=db.serialize(),plan=planApplicationActivation(packages,requests);expect(plan.issues).toContainEqual({code:'HISTORICAL_REFERENCE_UNVERIFIED',taskId:'legacy'});expect(plan.issues).toContainEqual({code:'RETAINED_PACKAGE_INCOMPATIBLE',packageHash:'f'.repeat(64),taskId:'legacy'});expect(db.serialize()).toEqual(preserved);
});
