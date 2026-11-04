import {validateConfigViewSchema,validateConfigViewBytes} from './config-view-schema';
import {builtinConfigViews,type ConfigViewRegistry} from './config-view-registry';
import type {InstalledApplicationPackage} from '@shared/applications';
import fs from 'node:fs';
import {dirname} from 'node:path';
import {assertHostCompatible,canonicalJson,digest} from './manifest';
import {CapabilitySessionRegistry} from './session-registry';
import {PackageRegistry} from './package-registry';
import {HostApplicationRegistry,builtinHostApplications} from './host-application-registry';
import {ApplicationError} from '@shared/applications';
import type {ApplicationUpgradeIssue} from '@shared/application-maintenance';

export type ActivationTarget=Pick<InstalledApplicationPackage,'packageHash'|'appId'|'manifest'|'resourceId'>&{schemaSources?:Readonly<Record<string,Buffer>>};
export interface ActivationConfiguration {parseIdentity?:(input:unknown,providerId:string)=>{providerId:string;contractMajor:number};parseConfig:(input:unknown)=>{kind:string};views:Pick<ConfigViewRegistry<{kind:string}>,'resolve'>}
export type ActivationIssue=ApplicationUpgradeIssue;
const publicCauses=new Set(['HOST_INCOMPATIBLE','CONFIG_INCOMPATIBLE','CONFIG_COMPATIBILITY_UNVERIFIED','AUTH_REQUIRED','HASH_MISMATCH','NOT_FOUND','RESOURCE_RECOVERY_REQUIRED','SNAPSHOT_CORRUPT']);
const compatibilityCause=(error:unknown)=>error instanceof SyntaxError||error instanceof ApplicationError&&error.code==='INVALID_INPUT'?'CONFIG_INCOMPATIBLE':error instanceof ApplicationError&&publicCauses.has(error.code)?error.code:'CAPABILITY_UNAVAILABLE';
/** Read-only. No credentials/config bodies are retained in the resulting plan. */
export function planApplicationActivation(packages:PackageRegistry,requests:readonly {hash:string;expectedGeneration:number}[],prospective:readonly ActivationTarget[]=[],additionalStagingBytes=0,configuration?:ActivationConfiguration){
 if(!Number.isSafeInteger(additionalStagingBytes)||additionalStagingBytes<0)throw new Error('升级物化空间预算无效');
 const db=packages.store.sqlite,issues:ActivationIssue[]=[],hosts=new HostApplicationRegistry(builtinHostApplications),configSource=configuration??{parseConfig:(input:unknown)=>hosts.parseConfig(input),views:builtinConfigViews};
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
 const conversions:{packageHash:string;connectionId:string;converterHash:string;viewDigest:string;schemaHash:string}[]=[];
 const connections=db.prepare('SELECT id,app_id,provider_id,config_json,config_schema_version,revision,verified_identity_json,identity_hash,identity_revision FROM application_connections ORDER BY id').all() as {id:string;app_id:string;provider_id:string;config_json:string;config_schema_version:number;revision:number;verified_identity_json:string;identity_hash:string;identity_revision:number}[];
 for(const [hash,uses] of records){
  try{
   const record=lookup(hash);assertHostCompatible(record.manifest);
   const refMismatch=refs.some(ref=>ref.ref_hash===hash&&ref.ref_id!==record.resourceId);if(refMismatch)throw new ApplicationError('HASH_MISMATCH','reference identity mismatch');
   for(const connection of connections.filter(connection=>connection.app_id===record.appId)){
    try{
     const config=configSource.parseConfig(JSON.parse(connection.config_json)),contract=record.manifest.connectionContracts.find(item=>item.providerId===connection.provider_id);
     if(config.kind!==connection.provider_id||!contract)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','contract mismatch');
     const identity=(configuration?.parseIdentity??((value:unknown,providerId:string)=>hosts.parseIdentity(value,providerId)))(JSON.parse(connection.verified_identity_json),connection.provider_id);
     if(identity.providerId!==connection.provider_id||identity.contractMajor!==contract.identityContractMajor||digest(canonicalJson(identity))!==connection.identity_hash)throw new ApplicationError('AUTH_REQUIRED','connection identity unverified');
     const view=configSource.views.resolve({providerId:connection.provider_id,sourceSchemaVersion:connection.config_schema_version,targetApiMajor:contract.configApiMajor,identityContractMajor:contract.identityContractMajor},config,contract.authModes);
     const prospectiveRecord=prospective.find(item=>item.packageHash===hash);
     const schemaHash=prospectiveRecord?validateConfigViewBytes(record,connection.provider_id,view.view,prospectiveRecord.schemaSources?.[contract.inputSchemaPath]??Buffer.alloc(0)):validateConfigViewSchema(packages.store,packages.get(hash),connection.provider_id,view.view);
     conversions.push({packageHash:hash,connectionId:connection.id,converterHash:view.converterHash,viewDigest:view.viewDigest,schemaHash});
    }catch(error){for(const use of uses)issues.push({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:compatibilityCause(error),packageHash:hash,connectionId:connection.id,...use});}
   }
  }catch(error){for(const use of uses)issues.push({code:'RETAINED_PACKAGE_INCOMPATIBLE',causeCode:compatibilityCause(error),packageHash:hash,...use});}
 }
 const pageCount=Number(db.pragma('page_count',{simple:true})),pageSize=Number(db.pragma('page_size',{simple:true}));
 const materialized=new Map([...selected.map(({record})=>record),...prospective].map(record=>[record.packageHash,record]));
 const materializedBytes=[...materialized.values()].reduce((sum,record)=>sum+record.manifest.files.reduce((bytes,file)=>bytes+file.size,0),additionalStagingBytes);
 // Keep existing packages; reserve a full backup and an additional full DB-sized
 // migration/WAL allowance, plus staging bytes and 16 MiB metadata headroom.
 const requiredBytes=2*pageCount*pageSize+materializedBytes+16*1024*1024;
 const capacity=fs.statfsSync(dirname(packages.store.root),{bigint:true}),availableBytes=capacity.bavail*capacity.bsize;
 if(availableBytes<BigInt(requiredBytes))issues.push({code:'INSUFFICIENT_SPACE'});
 const referenceHash=digest(canonicalJson({refs,conversions,connections:connections.map(({id,revision,config_json,verified_identity_json,identity_hash,identity_revision})=>({id,revision,configurationHash:digest(config_json),identityHash:identity_hash,identityRevision:identity_revision,identityRecordHash:digest(verified_identity_json)}))}));
 const plan={requests,referenceHash,requiredBytes,availableBytes:availableBytes.toString(),issues};
 return{...plan,planHash:digest(canonicalJson(plan))};
}
