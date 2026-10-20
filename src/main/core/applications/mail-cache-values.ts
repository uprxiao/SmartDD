import { ApplicationError } from '@shared/applications';
import { canonicalJson,digest } from './manifest';
import { MailCache,type MailCacheRef } from './mail-cache';
/** Larger index/checkpoint JSON is a budgeted immutable object, not main business-SQLite data. */
export class MailCacheValues {
 constructor(readonly cache:MailCache){}
 async load<T>(sourceKey:string,key:string,parse:(value:unknown)=>T):Promise<{value:T;recordHash:string}|null>{
  return this.cache.withRecord(sourceKey,key,async(descriptor,refs,load)=>{
   const record=descriptor as {format?:string;hash?:string};if(record?.format!=='json-v1'||refs.length!==1||record.hash!==refs[0].contentHash)throw new ApplicationError('HASH_MISMATCH','缓存检查点引用不符');
   return{value:parse(JSON.parse((await load(refs[0])).toString('utf8'))),recordHash:digest(canonicalJson(descriptor))};
  });
 }
 async save(sourceKey:string,key:string,value:unknown,expectedHash?:string|null,signal?:AbortSignal):Promise<{ref:MailCacheRef;recordHash:string}>{
  const bytes=Buffer.from(canonicalJson(value)),ref=await this.cache.put(sourceKey,bytes,{signal}),descriptor={format:'json-v1',hash:ref.contentHash};
  await this.cache.putRecord(sourceKey,key,descriptor,[ref],expectedHash===undefined?{}:{expectedHash});return{ref,recordHash:digest(canonicalJson(descriptor))};
 }
}
