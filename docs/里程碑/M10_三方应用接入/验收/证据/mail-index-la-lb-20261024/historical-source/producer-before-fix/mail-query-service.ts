import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { ApplicationConnection,ConnectionConfig } from '@shared/application-connections';
import type { LocalMailScan,LocalMailSummary,MailDateRange } from '@shared/application-mail';
import { ApplicationExecutionContexts,type ApplicationExecutionContext } from './execution-context';
import { MailCache } from './mail-cache';
import { MailCacheValues } from './mail-cache-values';
import { MailMessageIndex,mailSummarySchema } from './mail-message-index';
import { MailWorkerClient } from './providers/mail-worker-client';
import { localMailRange } from './providers/foxmail-source';
import { canonicalJson,digest } from './manifest';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const rangeSchema=z.object({days:z.number().int().min(1).max(100),timeZone:z.string(),startDate:z.string(),endDate:z.string(),start:z.string(),endExclusive:z.string()}).strict();
const itemSchema=z.object({id:z.string().regex(/^\d{1,20}$/),date:z.string(),revision:hash,batch:z.number().int().nonnegative(),index:z.number().int().nonnegative()}).strict();
const stateSchema=z.object({schema:z.literal(1),id:z.uuid(),sourceRevision:hash,queryHash:hash,range:rangeSchema,total:z.number().int().min(0).max(100000),nextOffset:z.number().int().nonnegative(),items:z.array(itemSchema).max(100000),blocks:z.array(hash).max(100000),problems:z.array(z.object({id:z.string().nullable(),code:z.string()}).strict()).max(200),problemCount:z.number().int().nonnegative(),checkedAt:z.string(),lastSuccessfulRefreshAt:z.string().nullable()}).strict();
export type MailQueryState=z.infer<typeof stateSchema>;
export interface MailQueryTarget {context:ApplicationExecutionContext;connection:ApplicationConnection;config:Extract<ConnectionConfig,{kind:'foxmail'}>;sourceKey:string;at:Date}
interface Result {state:MailQueryState;checkedAt:string;scan:LocalMailScan;at:string}
interface Job {parents:Set<ApplicationExecutionContext>;abort:AbortController;ready:Promise<ApplicationExecutionContext>;work:Promise<Result>}
export class MailQueryService {
 private readonly jobs=new Map<string,Job>();private readonly pending=new Set<Promise<unknown>>();private closed=false;
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly cache:()=>Promise<MailCache>,private readonly createWorker:()=>MailWorkerClient,private readonly options:{now?:()=>Date;batchSize?:number;workMs?:number;maxBatches?:number}={}){}
 private valid(context:ApplicationExecutionContext):boolean{try{this.contexts.require(context,'mail.read');return true;}catch{return false;}}
 async run(target:MailQueryTarget,text:string,retryFailed=true):Promise<Result>{
  if(this.closed)throw new ApplicationError('CANCELED','邮件查询服务已停止');this.contexts.require(target.context,'mail.read');
  const range=localMailRange(target.config.queryDays,target.at),key=digest(canonicalJson({source:target.sourceKey,config:target.config,range,text,parser:1,retryFailed}));let job=this.jobs.get(key);
  if(!job){
   const parents=new Set([target.context]),abort=new AbortController();let announce!:(context:ApplicationExecutionContext)=>void,refuse!:(error:unknown)=>void;
   const ready=new Promise<ApplicationExecutionContext>((resolve,reject)=>{announce=resolve;refuse=reject;});void ready.catch(()=>{});
   const work=this.contexts.withSharedIndex(()=>[...parents].filter(parent=>this.valid(parent)),'mail.read',abort.signal,async context=>{announce(context);return this.produce(context,target,text,range,retryFailed);});
   job={parents,abort,ready,work};this.jobs.set(key,job);this.pending.add(work);const owned=job;
   void work.catch(refuse);void work.finally(()=>{this.pending.delete(work);if(this.jobs.get(key)===owned)this.jobs.delete(key);}).catch(()=>{});
  }
  const selected=job;selected.parents.add(target.context);let index:ApplicationExecutionContext|undefined,state:'completed'|'cancelled'|'failed'='failed';
  let cleanup:()=>void=()=>{};const canceled=new Promise<never>((_,reject)=>{const abort=()=>reject(new ApplicationError('CANCELED','本次邮件查询等待已取消'));target.context.signal.addEventListener('abort',abort,{once:true});cleanup=()=>target.context.signal.removeEventListener('abort',abort);if(target.context.signal.aborted)abort();});
  // Cancellation ends this wait; the shared producer is retained by its other live parents.
  try{
   index=await Promise.race([selected.ready,canceled]);this.contexts.require(target.context,'mail.read');await this.contexts.linkIndexParent(index,target.context,target.sourceKey);
   const result=await Promise.race([selected.work,canceled]);this.contexts.require(target.context,'mail.read');state='completed';return result;
  }catch(error){if(target.context.signal.aborted||!this.valid(target.context))state='cancelled';throw error;}
  finally{cleanup?.();selected.parents.delete(target.context);if(![...selected.parents].some(parent=>this.valid(parent)))selected.abort.abort();if(index)await this.contexts.endIndexParent(index,target.context,state);}
 }
 private async produce(context:ApplicationExecutionContext,target:MailQueryTarget,text:string,range:MailDateRange,retryFailed:boolean):Promise<Result>{
  const cache=await this.cache(),values=new MailCacheValues(cache),index=new MailMessageIndex(cache,target.sourceKey,context.signal),queryHash=digest(canonicalJson({range,text,parser:1})),key='query:'+queryHash,worker=this.createWorker();
  try{
   this.contexts.require(context,'mail.read');const scan=await worker.beginScan(target.config,target.connection.identity,context.signal,target.at),saved=await values.load(target.sourceKey,key,stateSchema.parse);let expected=saved?.recordHash??null;
   let state:MailQueryState=saved?.value.sourceRevision===scan.sourceRevision&&saved.value.queryHash===queryHash&&saved.value.total===scan.metadataCount&&!(retryFailed&&saved.value.nextOffset===saved.value.total&&saved.value.problemCount>0)?saved.value:{schema:1,id:randomUUID(),sourceRevision:scan.sourceRevision,queryHash,range,total:scan.metadataCount,nextOffset:0,items:[],blocks:[],problems:[],problemCount:0,checkedAt:scan.checkedAt,lastSuccessfulRefreshAt:null};
   const until=performance.now()+(this.options.workMs??15000),seen=new Set(state.items.map(item=>item.id));let batches=0;
   while(state.nextOffset<state.total&&performance.now()<until&&batches<(this.options.maxBatches??Infinity)){
    this.contexts.require(context,'mail.read');const entries=await worker.scanEntries(target.config,scan.id,state.nextOffset,this.options.batchSize??50,context.signal),reuse=await index.read(entries);
    const batch=await worker.scanBatch(target.config,scan.id,state.nextOffset,this.options.batchSize??50,text,context.signal,reuse);await index.save(batch.indexed);
    if(batch.offset!==state.nextOffset||batch.nextOffset<=state.nextOffset||batch.nextOffset>state.total)throw new ApplicationError('INVALID_RESPONSE','邮件检查点未前进');
    const block=await cache.put(target.sourceKey,Buffer.from(canonicalJson(batch.records)),{signal:context.signal}),blockIndex=state.blocks.length;state.blocks.push(block.contentHash);
    for(let index=0;index<batch.records.length;index++){const item=batch.records[index];if(seen.has(item.id))throw new ApplicationError('INCOMPLETE_RESULT','邮件检查返回重复身份');seen.add(item.id);state.items.push({id:item.id,date:item.date,revision:item.sourceRevision,batch:blockIndex,index});}
    state.nextOffset=batch.nextOffset;state.problemCount+=batch.problemCount;for(const problem of batch.problems)if(state.problems.length<199)state.problems.push(problem);
    this.contexts.require(context,'mail.read');const written=await values.save(target.sourceKey,key,state,expected,context.signal);expected=written.recordHash;batches++;
   }
   const checked=await worker.finishScan(target.config,scan.id,context.signal);this.contexts.require(context,'mail.read');state.checkedAt=checked.checkedAt;
   if(state.nextOffset===state.total&&state.problemCount===0)state.lastSuccessfulRefreshAt=checked.checkedAt;
   if(batches||!saved||state.id!==saved.value.id)await values.save(target.sourceKey,key,state,expected,context.signal);
   await cache.maintain({signal:context.signal});return{state,checkedAt:checked.checkedAt,scan,at:target.at.toISOString()};
  }finally{await worker.close();}
 }
 async summaries(target:MailQueryTarget,result:Result,items:MailQueryState['items']):Promise<LocalMailSummary[]>{
  const cache=await this.cache(),rows:LocalMailSummary[]=[],blocks=new Map<number,LocalMailSummary[]>();let missing=false;
  for(const item of items){
   if(!blocks.has(item.batch)){const hash=result.state.blocks[item.batch],ref=hash?await cache.find(target.sourceKey,hash):null;if(!ref){missing=true;break;}const block=await cache.withRead(ref,bytes=>z.array(mailSummarySchema).max(100).parse(JSON.parse(bytes.toString('utf8'))),target.context.signal);blocks.set(item.batch,block);}
   const value=blocks.get(item.batch)![item.index];if(!value||value.id!==item.id||value.sourceRevision!==item.revision)throw new ApplicationError('HASH_MISMATCH','邮件索引引用与原批次不同');rows.push(value);
  }
  if(!missing){this.contexts.require(target.context,'mail.read');return rows;}
  const worker=this.createWorker();try{const scan=await worker.beginScan(target.config,target.connection.identity,target.context.signal,new Date(result.at));if(scan.sourceRevision!==result.state.sourceRevision)throw new ApplicationError('RESOURCE_STATE_CHANGED','读取列表时邮件来源变化，请重新查询');const values=await worker.scanSummaries(target.config,scan.id,items.map(i=>({id:i.id,revision:i.revision})),target.context.signal);await worker.finishScan(target.config,scan.id,target.context.signal);this.contexts.require(target.context,'mail.read');return values;}finally{await worker.close();}
 }
 async dispose():Promise<void>{this.closed=true;for(const job of this.jobs.values())job.abort.abort();await Promise.allSettled([...this.pending]);}
}
