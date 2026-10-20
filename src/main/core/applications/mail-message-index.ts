import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { LocalMailIndexEntry,LocalMailScanEntry } from '@shared/application-mail';
import { MailCache } from './mail-cache';
import { MailCacheValues } from './mail-cache-values';
import { canonicalJson } from './manifest';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const mailSummarySchema=z.object({id:z.string().regex(/^\d{1,20}$/),subject:z.string().max(8192),from:z.string().max(2000),to:z.string().max(8192),date:z.iso.datetime(),messageId:z.string().max(2000).nullable(),sourceRevision:hash,hasAttachments:z.boolean()}).strict();
const entrySchema=z.object({id:z.string().regex(/^\d{1,20}$/),fingerprint:hash,summary:mailSummarySchema,searchText:z.string().max(16*1024*1024).nullable()}).strict();
const pointerSchema=z.object({id:z.string().regex(/^\d{1,20}$/),fingerprint:hash,block:hash,index:z.number().int().min(0).max(99),fulltext:z.boolean()}).strict();
const catalogueSchema=z.object({schema:z.literal(1),entries:z.array(pointerSchema).max(100000)}).strict();
type Catalogue=z.infer<typeof catalogueSchema>;
/** Optional, quota-governed hints. Every reuse is bound to a fresh Worker source snapshot. */
export class MailMessageIndex {
 private readonly values:MailCacheValues;
 private catalogue?:{value:Catalogue;recordHash:string}|null;
 private pointers=new Map<string,z.infer<typeof pointerSchema>>();
 constructor(private readonly cache:MailCache,private readonly sourceKey:string,private readonly signal:AbortSignal){this.values=new MailCacheValues(cache);}
 private async load(){this.catalogue=await this.values.load(this.sourceKey,'message-index-v1',catalogueSchema.parse);this.pointers=new Map(this.catalogue?.value.entries.map(entry=>[entry.id,entry])??[]);}
 async read(entries:LocalMailScanEntry[]):Promise<LocalMailIndexEntry[]>{
  if(this.catalogue===undefined)await this.load();
  const blocks=new Map<string,LocalMailIndexEntry[]|null>(),result:LocalMailIndexEntry[]=[];let bytes=0,blockBytes=0;
  for(const entry of entries){
   const pointer=this.pointers.get(entry.id);if(!pointer||pointer.fingerprint!==entry.fingerprint)continue;
   if(!blocks.has(pointer.block)){
    const ref=await this.cache.find(this.sourceKey,pointer.block);
    if(ref&&blockBytes+ref.size>32*1024*1024){blocks.set(pointer.block,null);continue;}if(ref)blockBytes+=ref.size;
    blocks.set(pointer.block,ref?await this.cache.withRead(ref,value=>z.array(entrySchema).max(100).parse(JSON.parse(value.toString('utf8'))),this.signal):null);
   }
   const value=blocks.get(pointer.block)?.[pointer.index];if(!value)continue;
   if(value.id!==entry.id||value.fingerprint!==entry.fingerprint||value.summary.id!==entry.id)throw new ApplicationError('HASH_MISMATCH','邮件索引块与当前文件身份不符');
   const size=Buffer.byteLength(canonicalJson(value));if(bytes+size<=16*1024*1024){result.push(value);bytes+=size;}
  }
  return result;
 }
 async save(input:LocalMailIndexEntry[]):Promise<void>{
  if(!input.length)return;if(this.catalogue===undefined)await this.load();const entries=z.array(entrySchema).min(1).max(100).parse(input),ref=await this.cache.put(this.sourceKey,Buffer.from(canonicalJson(entries)),{signal:this.signal});
  for(let attempt=0;attempt<3;attempt++){
   const merged=new Map(this.pointers);
   for(const [index,entry] of entries.entries()){
    const old=merged.get(entry.id);if(old?.fingerprint===entry.fingerprint&&old.fulltext&&entry.searchText===null)continue;
    merged.delete(entry.id);merged.set(entry.id,{id:entry.id,fingerprint:entry.fingerprint,block:ref.contentHash,index,fulltext:entry.searchText!==null});
   }
   // Old deleted identities are hints only; a bounded catalogue cannot grow beyond source inventory budget.
   while(merged.size>100000)merged.delete(merged.keys().next().value!);
   const value:Catalogue={schema:1,entries:[...merged.values()]};
   try{const saved=await this.values.save(this.sourceKey,'message-index-v1',value,this.catalogue?.recordHash??null,this.signal);this.catalogue={value,recordHash:saved.recordHash};this.pointers=merged;return;}
   catch(error){if(!(error instanceof ApplicationError)||error.code!=='REVISION_CONFLICT')throw error;await this.load();}
  }
  throw new ApplicationError('REVISION_CONFLICT','邮件缓存索引正被其他执行者更新，请重试');
 }
}
