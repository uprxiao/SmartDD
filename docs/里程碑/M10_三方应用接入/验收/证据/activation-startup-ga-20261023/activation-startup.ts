import {z} from 'zod';
import type {DatabaseAccessLease} from '../../db/database-access-gate';
import type {ResourceStore} from './resource-store';
import {CapabilityBundleSource} from './bundle-source';
import {BuiltinPackageRegistry} from './builtin-package-registry';
import {activatePreparedPackages} from './activation-maintenance';

/** Resolve only the current trusted distribution; an old operation cannot ask
 * a different host build to run arbitrary migration handlers or package bytes. */
export async function recoverBuiltinActivation(store:ResourceStore,lease:DatabaseAccessLease,operationId:string,sourceRoot:string):Promise<void>{
 const row=store.sqlite.prepare("SELECT plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=? AND kind='application-activation'").get(operationId,store.storeId) as {plan_json:string}|undefined;
 if(!row)throw new Error('待恢复应用升级操作不存在');
 const saved=z.object({buildId:z.string(),requests:z.array(z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),expectedGeneration:z.number().int().nonnegative()}).strict()).min(1)}).parse(JSON.parse(row.plan_json));
 const source=new CapabilityBundleSource(sourceRoot),buildId=`builtin:${source.index.build.appVersion}:${source.index.indexHash}`;
 if(saved.buildId!==buildId)throw new Error('待恢复应用升级需要原分发构建，请保留现场');
 const builtin=new BuiltinPackageRegistry(store);
 for(const request of saved.requests){
  const entry=source.index.apps.find(item=>item.hash===request.hash);if(!entry)throw new Error('升级目标不属于当前可信分发');
  source.application(entry);builtin.assertTrusted(request.hash);
 }
 await activatePreparedPackages({packages:builtin.packages,lease,operationId,buildId,requests:saved.requests});
}
