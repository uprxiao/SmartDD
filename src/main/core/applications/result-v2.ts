import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {applicationResourceRefSchema} from '@shared/application-data';
import {applicationResultV2Schema,type ApplicationResultV2} from '@shared/application-result';
interface ResultIdentity {
  capabilityId:string;appId:string;packageHash:string;semantics:'read'|'write'|'external-write';
  connections:ApplicationResultV2['source']['connections'];operationId:string;requestId:string|null;
  origin:ApplicationResultV2['operation']['origin'];
}
/** Only the host supplies source and operation identity; plugin output is business data. */
export function buildApplicationResultV2(identity:ResultIdentity,data:unknown):ApplicationResultV2{
    const object=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{},record=(value:unknown)=>value&&typeof value==='object'?value as Record<string,unknown>:{};
    const resources=new Map<string,ApplicationResultV2['resources'][number]>(),visit=(value:unknown):void=>{const parsed=applicationResourceRefSchema.safeParse(value);if(parsed.success){resources.set(parsed.data.id+':'+parsed.data.revision,parsed.data);return;}if(Array.isArray(value))for(const item of value)visit(item);else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);};
    if(!boundedJson(data))throw new ApplicationError('INVALID_RESPONSE','业务结果不是有界JSON');visit(data);
    const revision=record(object.reference).contentRevision??record(object.draft).revision??record(object.intent).reviewHash;
    const state=record(object.intent).state,missing=Array.isArray(object.missing)?object.missing.filter((v):v is string=>typeof v==='string'):[];
    return applicationResultV2Schema.parse({schema:'willyou-app-result-v2',contractMajor:2,status:'ok',capabilityId:identity.capabilityId,data,source:{appId:identity.appId,packageHash:identity.packageHash,connections:identity.connections,revision:typeof revision==='string'||typeof revision==='number'?String(revision):null},completeness:{complete:object.complete!==false&&missing.length===0,missing},pagination:Object.hasOwn(object,'nextCursor')?{nextCursor:typeof object.nextCursor==='string'?object.nextCursor:null,total:typeof object.total==='number'?object.total:null}:null,resources:[...resources.values()],operation:{id:identity.operationId,requestId:identity.requestId,origin:identity.origin,effectState:identity.semantics==='read'?'read-only':state==='unknown'?'unknown':'completed'}});
}
