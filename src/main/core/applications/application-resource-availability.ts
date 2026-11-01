import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {BuiltinPackageRegistry} from './builtin-package-registry';
import {RuntimeRegistry} from './runtime-registry';
import type {ResourceStore} from './resource-store';
type FixedApplication=Pick<CapabilitySessionSnapshot['packages'][number],'appId'|'version'|'packageHash'|'runtimeHash'>;
export interface ApplicationResourceAvailability {appId:string;packageHash:string;runtimeHash:string;state:'ready'|'unavailable';code:ApplicationError['code']|null}
/** Inspect only the fixed selection. A ready result is not runtime authority:
 * preparation and each call must still verify resources, leases and policy.
 * Keep failures local to an app; shared runtime failure naturally affects each
 * app that actually depends on it. Never repair, reselect or quarantine here. */
export function inspectApplicationResources(store:ResourceStore,applications:readonly FixedApplication[]):ApplicationResourceAvailability[]{
 if(new Set(applications.map(p=>p.appId)).size!==applications.length)throw new ApplicationError('SNAPSHOT_CORRUPT','原应用选择包含重复身份');
 const packages=new BuiltinPackageRegistry(store),runtimes=new RuntimeRegistry(store);
 return applications.map(selected=>{
  const base={appId:selected.appId,packageHash:selected.packageHash,runtimeHash:selected.runtimeHash};
  try{
   const installed=packages.assertTrusted(selected.packageHash);
   if(installed.appId!==selected.appId||installed.version!==selected.version||installed.manifest.runtime.hash!==selected.runtimeHash)throw new ApplicationError('SNAPSHOT_CORRUPT','原应用与固定选择身份不同');
   runtimes.verify(selected.runtimeHash);return{...base,state:'ready' as const,code:null};
  }catch(error){if(!(error instanceof ApplicationError)||error.code==='CANCELED')throw error;return{...base,state:'unavailable' as const,code:error.code};}
 });
}
