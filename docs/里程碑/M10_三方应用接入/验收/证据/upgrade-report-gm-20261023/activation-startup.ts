import {z} from 'zod';
import {planApplicationActivation} from './activation-preflight';
import {RuntimeRegistry,validateRuntime} from './runtime-registry';
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
 const bundles=saved.requests.map(request=>{
  const entry=source.index.apps.find(item=>item.hash===request.hash);if(!entry)throw new Error('升级目标不属于当前可信分发');
  return{entry,bundle:source.application(entry)};
 });
 await activatePreparedPackages({packages:builtin.packages,lease,operationId,buildId,requests:saved.requests,prepare:{
  additionalStagingBytes:runtimeStagingBytes(source),
  recoveryResources:['runtime:'+validateRuntime(source.runtime()).hash,...bundles.map(({bundle})=>'app:'+bundle.packageHash)],
  targets:bundles.map(({bundle})=>({packageHash:bundle.packageHash,appId:bundle.manifest.appId,resourceId:'app:'+bundle.packageHash,manifest:bundle.manifest})),
  materialize:()=>materializeBuiltinSet(store,source,bundles),
 }});
}

/** Current distribution is validated before any database operation is registered. */
export async function activateBuiltinDistribution(store:ResourceStore,lease:DatabaseAccessLease,sourceRoot:string):Promise<void>{
 const source=new CapabilityBundleSource(sourceRoot),builtin=new BuiltinPackageRegistry(store);
 const bundles=source.index.apps.map(entry=>({entry,bundle:source.application(entry)}));
 const requests=bundles.filter(({entry})=>builtin.packages.active(entry.appId)?.packageHash!==entry.hash).map(({entry})=>({hash:entry.hash,expectedGeneration:builtin.packages.active(entry.appId)?.generation??0}));
 if(!requests.length)return;
 source.runtime(); // Validate all new runtime bytes before registering an upgrade.
 await activatePreparedPackages({packages:builtin.packages,lease,buildId:`builtin:${source.index.build.appVersion}:${source.index.indexHash}`,requests,prepare:{
  additionalStagingBytes:runtimeStagingBytes(source),
  recoveryResources:['runtime:'+validateRuntime(source.runtime()).hash,...bundles.map(({bundle})=>'app:'+bundle.packageHash)],
  targets:bundles.map(({bundle})=>({packageHash:bundle.packageHash,appId:bundle.manifest.appId,resourceId:'app:'+bundle.packageHash,manifest:bundle.manifest})),
  materialize:()=>materializeBuiltinSet(store,source,bundles),
 }});
}

async function materializeBuiltinSet(store:ResourceStore,source:CapabilityBundleSource,bundles:{entry:CapabilityBundleSource['index']['apps'][number];bundle:ReturnType<CapabilityBundleSource['application']>}[]):Promise<void>{
 const runtime=source.runtime(),runtimes=new RuntimeRegistry(store),runtimeId='runtime:'+validateRuntime(runtime).hash;
 const pending=(id:string)=>store.sqlite.prepare("SELECT operation_id FROM capability_resources WHERE resource_id=? AND state IN ('staged','verified','recovery-required')").get(id) as {operation_id:string}|undefined;
 const previous=pending(runtimeId);if(previous)await runtimes.recoverInstall(runtime,previous.operation_id);else await runtimes.install(runtime);
 const builtin=new BuiltinPackageRegistry(store);
 for(const {entry,bundle} of bundles){const old=pending('app:'+bundle.packageHash);if(old)await builtin.packages.recoverInstall(bundle,old.operation_id);await builtin.install(source,entry);}
}

/** Recomputed read-only report; never exposes connection configuration or credentials. */
export function builtinActivationReport(store:ResourceStore,sourceRoot:string){
 const source=new CapabilityBundleSource(sourceRoot),builtin=new BuiltinPackageRegistry(store);
 const bundles=source.index.apps.map(entry=>source.application(entry));
 const targets=bundles.filter(bundle=>builtin.packages.active(bundle.manifest.appId)?.packageHash!==bundle.packageHash);
 const requests=targets.map(bundle=>({hash:bundle.packageHash,expectedGeneration:builtin.packages.active(bundle.manifest.appId)?.generation??0}));
 const descriptions=targets.map(bundle=>({appId:bundle.manifest.appId,version:bundle.manifest.version,packageHash:bundle.packageHash}));
 if(!requests.length)return{targets:descriptions,preflight:null};
 const preflight=planApplicationActivation(builtin.packages,requests,bundles.map(bundle=>({packageHash:bundle.packageHash,appId:bundle.manifest.appId,resourceId:'app:'+bundle.packageHash,manifest:bundle.manifest})),runtimeStagingBytes(source));
 return{targets:descriptions,preflight};
}
export function builtinActivationRequired(store:ResourceStore,sourceRoot:string):boolean{
 const report=builtinActivationReport(store,sourceRoot);
 if(!report.preflight)return false;
 if(report.preflight.issues.length){console.warn('[applications] Upgrade deferred:',report.preflight.issues.map(issue=>issue.code).join(','));return false;}
 return true;
}

function runtimeStagingBytes(source:CapabilityBundleSource):number{
 return validateRuntime(source.runtime()).manifest.files.reduce((sum,file)=>sum+file.size,0);
}
