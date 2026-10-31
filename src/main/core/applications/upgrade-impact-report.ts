import type {ApplicationUpgradeImpact} from '@shared/application-maintenance';
import {CapabilitySessionRegistry} from './session-registry';
import {HostApplicationRegistry,builtinHostApplications} from './host-application-registry';
import type {ActivationIssue,ActivationTarget} from './activation-preflight';
import type {PackageRegistry} from './package-registry';

/** Public display projection only. Never reads configuration, secrets or task
 * messages, and never adds presentation fields to the compatibility plan hash. */
export function describeActivationIssues(packages:PackageRegistry,issues:readonly ActivationIssue[],prospective:readonly ActivationTarget[]=[]):ApplicationUpgradeImpact[]{
 const db=packages.store.sqlite,hosts=new HostApplicationRegistry(builtinHostApplications);
 const sessions=new CapabilitySessionRegistry(packages.store,{assertInitialSelection:()=>{throw new Error('read-only report');},verifyExtraResource:()=>{throw new Error('read-only report');}});
 const knownSessions=new Map<string,ReturnType<CapabilitySessionRegistry['inspectCoordinated']>|null>();
 return issues.map(issue=>{
  let record:ActivationTarget|null=null,operations:string[]|null=null;
  try{if(issue.packageHash)record=prospective.find(item=>item.packageHash===issue.packageHash)??packages.get(issue.packageHash);}catch{/* Keep the original unknown identity visible. */}
  if(record){
   const metadata=record;
   if(issue.taskId){
    if(!knownSessions.has(issue.taskId))try{knownSessions.set(issue.taskId,sessions.inspectCoordinated(issue.taskId));}catch{knownSessions.set(issue.taskId,null);}
    const session=knownSessions.get(issue.taskId),pin=session?.snapshot.packages.find(pack=>pack.packageHash===issue.packageHash&&pack.appId===metadata.appId);
    if(session&&session.retention!=='hold'&&pin)operations=[...pin.allowedOperations].filter(permission=>metadata.manifest.permissions.includes(permission));
   }else operations=[...record.manifest.permissions];
  }
  const task=issue.taskId?db.prepare('SELECT title FROM tasks WHERE id=?').get(issue.taskId) as {title:string}|undefined:undefined;
  const connection=issue.connectionId?db.prepare('SELECT name,provider_id,app_id FROM application_connections WHERE id=?').get(issue.connectionId) as {name:string;provider_id:string;app_id:string}|undefined:undefined;
  if(issue.connectionId){
   try{const provider=connection&&hosts.provider(connection.provider_id);if(!connection||!provider||!record||connection.app_id!==record.appId||provider.appId!==record.appId)operations=null;else operations=operations?.filter(permission=>Object.values(provider.permissions).includes(permission))??null;}catch{operations=null;}
  }
  return{code:issue.code,...(issue.causeCode?{causeCode:issue.causeCode}:{}),...(issue.packageHash?{packageHash:issue.packageHash}:{}),...(issue.taskId?{taskId:issue.taskId}:{}),...(issue.connectionId?{connectionId:issue.connectionId}:{}),target:!issue.taskId&&prospective.some(item=>item.packageHash===issue.packageHash),appId:record?.appId??null,appName:record?.manifest.displayName??null,version:record?.manifest.version??null,taskTitle:task?.title??null,connectionName:connection?.name??null,operations:operations===null?null:[...new Set(operations)].sort(),scope:issue.connectionId?'connection':record?'package':'unknown',verified:record!==null&&operations!==null};
 });
}
