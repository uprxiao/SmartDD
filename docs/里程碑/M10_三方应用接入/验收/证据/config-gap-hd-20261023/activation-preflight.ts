import type {InstalledApplicationPackage} from '@shared/applications';
import fs from 'node:fs';
import {dirname} from 'node:path';
import {assertHostCompatible,canonicalJson,digest} from './manifest';
import {CapabilitySessionRegistry} from './session-registry';
import {PackageRegistry} from './package-registry';
import {HostApplicationRegistry,builtinHostApplications} from './host-application-registry';

export type ActivationTarget=Pick<InstalledApplicationPackage,'packageHash'|'appId'|'manifest'|'resourceId'>;
export interface ActivationIssue {code:string;packageHash?:string;taskId?:string;connectionId?:string}
/** Read-only. No credentials/config bodies are retained in the resulting plan. */
export function planApplicationActivation(packages:PackageRegistry,requests:readonly {hash:string;expectedGeneration:number}[],prospective:readonly ActivationTarget[]=[],additionalStagingBytes=0){
 if(!Number.isSafeInteger(additionalStagingBytes)||additionalStagingBytes<0)throw new Error('升级物化空间预算无效');
 const db=packages.store.sqlite,issues:ActivationIssue[]=[],hosts=new HostApplicationRegistry(builtinHostApplications);
 const refs=db.prepare("SELECT task_id,ref_id,ref_hash FROM capability_session_refs WHERE ref_kind='application-package' ORDER BY task_id,ref_id").all() as {task_id:string;ref_id:string;ref_hash:string}[];
 const sessions=new CapabilitySessionRegistry(packages.store,{assertInitialSelection:()=>{throw new Error('read-only preflight');},verifyExtraResource:()=>{throw new Error('read-only preflight');}});
 for(const taskId of new Set(refs.map(ref=>ref.task_id)))try{if(sessions.inspectCoordinated(taskId).retention==='hold')throw new Error('unknown retention');}catch{issues.push({code:'HISTORICAL_REFERENCE_UNVERIFIED',taskId});}
 const lookup=(hash:string)=>prospective.find(item=>item.packageHash===hash)??packages.get(hash);
 const records=new Map<string,{taskId?:string}[]>();
 for(const ref of refs){const rows=records.get(ref.ref_hash)??[];rows.push({taskId:ref.task_id});records.set(ref.ref_hash,rows);}
 const selected=requests.map(request=>({request,record:lookup(request.hash)}));
 if(new Set(selected.map(item=>item.record.appId)).size!==selected.length)issues.push({code:'DUPLICATE_APPLICATION'});
 for(const {request,record} of selected){
  if((packages.active(record.appId)?.generation??0)!==request.expectedGeneration)issues.push({code:'DEFAULT_CHANGED',packageHash:request.hash});
  if(!records.has(request.hash))records.set(request.hash,[{}]);
 }
 const connections=db.prepare('SELECT id,app_id,provider_id,config_json,config_schema_version,revision FROM application_connections ORDER BY id').all() as {id:string;app_id:string;provider_id:string;config_json:string;config_schema_version:number;revision:number}[];
 for(const [hash,uses] of records){
  try{
   const record=lookup(hash);assertHostCompatible(record.manifest);
   const refMismatch=refs.some(ref=>ref.ref_hash===hash&&ref.ref_id!==record.resourceId);if(refMismatch)throw new Error('reference identity mismatch');
   for(const connection of connections.filter(connection=>connection.app_id===record.appId)){
    try{
     const config=hosts.parseConfig(JSON.parse(connection.config_json)),contract=record.manifest.connectionContracts.find(item=>item.providerId===connection.provider_id);
     if(config.kind!==connection.provider_id||connection.config_schema_version!==1||!contract||contract.configApiMajor!==1||contract.identityContractMajor!==1||!contract.authModes.includes(hosts.authMode(config)))throw new Error('contract mismatch');
    }catch{for(const use of uses)issues.push({code:'CONNECTION_CONTRACT_UNVERIFIED',packageHash:hash,connectionId:connection.id,...use});}
   }
  }catch{for(const use of uses)issues.push({code:'RETAINED_PACKAGE_INCOMPATIBLE',packageHash:hash,...use});}
 }
 const pageCount=Number(db.pragma('page_count',{simple:true})),pageSize=Number(db.pragma('page_size',{simple:true}));
 const materialized=new Map([...selected.map(({record})=>record),...prospective].map(record=>[record.packageHash,record]));
 const materializedBytes=[...materialized.values()].reduce((sum,record)=>sum+record.manifest.files.reduce((bytes,file)=>bytes+file.size,0),additionalStagingBytes);
 // Keep existing packages; reserve a full backup and an additional full DB-sized
 // migration/WAL allowance, plus staging bytes and 16 MiB metadata headroom.
 const requiredBytes=2*pageCount*pageSize+materializedBytes+16*1024*1024;
 const capacity=fs.statfsSync(dirname(packages.store.root),{bigint:true}),availableBytes=capacity.bavail*capacity.bsize;
 if(availableBytes<BigInt(requiredBytes))issues.push({code:'INSUFFICIENT_SPACE'});
 const referenceHash=digest(canonicalJson({refs,connections:connections.map(({id,revision,config_json})=>({id,revision,configurationHash:digest(config_json)}))}));
 const plan={requests,referenceHash,requiredBytes,availableBytes:availableBytes.toString(),issues};
 return{...plan,planHash:digest(canonicalJson(plan))};
}
