import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import { connectionConfigSchema,type ApplicationConnection } from '@shared/application-connections';
import { zentaoSourceRefSchema, type ZentaoSourceRef, type ZentaoWorkData, type ZentaoDetailData } from '@shared/application-zentao';
import type { ApplicationResourceRef,ApplicationResourceChunk } from '@shared/application-data';
import type { ApplicationDataHost,ApplicationDataBinding } from './application-adapter-registry';
import type { HostToolOperation } from './tool-service';
import type { RunContext } from './run-registry';
import type { ApplicationSelectionService } from './selection-service';
import { ApplicationExecutionContexts,type ApplicationExecutionContext } from './execution-context';
import { ApplicationDataResources,type ApplicationResourceBacking } from './data-resources';
import { canonicalJson,digest } from './manifest';
import { withResourceLock } from './resource-lock';
import { ZentaoClient,zentaoId,zentaoDetailRevision,type ZentaoKind,type ZentaoDetail } from './providers/zentao';
const kindSchema=z.enum(['bug','story']);
const listSchema=z.object({connectionId:z.uuid().nullable().optional(),kind:kindSchema,cursor:z.string().max(8192).nullable().optional(),limit:z.number().int().min(1).max(200).default(50)}).strict();
const getSchema=z.object({kind:kindSchema,reference:zentaoSourceRefSchema}).strict();
interface ObjectRow {object_key:string;project_id:string;connection_id:string;identity_revision:number;object_kind:ZentaoKind;native_id:string;content_revision:string;representation:'summary'|'detail';payload_json:string;fetched_at:string}
interface CursorRow {cursor_id:string;project_id:string;target_json:string;object_kind:ZentaoKind;page_size:number;page_no:number;expected_total:number;seen_json:string;expires_at:string}
interface FileCandidate {id:string;filename:string;size:number|null}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fieldsBody=(detail:ZentaoDetail)=>Object.fromEntries(['steps','spec','description','verify','verifyCriteria'].filter(k=>detail.fields[k]!==undefined).map(k=>[k,detail.fields[k]]));
const fieldPart=(key:string)=>'field-'+digest(key);
const bodyBytes=(detail:ZentaoDetail)=>Buffer.from(canonicalJson(fieldsBody(detail)),'utf8');
const jsonBytes=(value:unknown)=>Buffer.from(canonicalJson(value),'utf8');
function inlineFileId(raw:string,base:string):string|null{
  try{
    const decoded=raw.replace(/&(?:amp|quot|apos|#([0-9]+)|#x([0-9a-f]+));/gi,(s,decimal,hex)=>decimal||hex?String.fromCodePoint(parseInt(decimal??hex,decimal?10:16)):s.toLowerCase()==='&amp;'?'&':s.toLowerCase()==='&quot;'?'"':"'");
    const url=new URL(decoded,base),origin=new URL(base);if(url.origin!==origin.origin||url.username||url.password)return null;
    for(const [key,value] of url.searchParams)if(key.toLowerCase()==='fileid')return zentaoId(value);
    const match=/(?:\/files\/|file-(?:read|download)-)([0-9]{1,64})(?:[^0-9]|$)/i.exec(url.pathname);return match?zentaoId(match[1]):null;
  }catch{return null;}
}
/** Extract only IDs declared by the authorized object's server content; never follow its URLs. */
export function zentaoFiles(detail:ZentaoDetail,base:string):{files:FileCandidate[];missing:string[]}{
  const files=new Map<string,FileCandidate>(),missing:string[]=[];
  const add=(value:unknown)=>{
    if(!Array.isArray(value)&&!record(value)){if(value!==null&&value!==undefined)missing.push('attachment-metadata');return;}
    for(const [key,item] of Object.entries(value)){
      if(!record(item)){missing.push('attachment-metadata');continue;}
      let id:string;try{id=zentaoId(item.id??item.fileID??(!Array.isArray(value)?key:undefined));}catch{missing.push('attachment-identity');continue;}
      const hint=['title','name','filename','fileName'].map(k=>item[k]).find(v=>typeof v==='string'&&v.length>0);
      let name=typeof hint==='string'?hint:'file-'+id;const extension=typeof item.extension==='string'?item.extension.replace(/^\./,''):'';
      if(extension&&/^[a-z0-9]{1,20}$/i.test(extension)&&!name.toLowerCase().endsWith('.'+extension.toLowerCase()))name+='.'+extension;
      name=name.replace(/[\x00-\x1f\x7f/\\]/g,'_');if(name.length>1024){name='file-'+id;missing.push('attachment-filename:'+id);}
      const size=typeof item.size==='number'?item.size:typeof item.size==='string'&&/^\d+$/.test(item.size)?Number(item.size):null;
      if(size!==null&&(!Number.isSafeInteger(size)||size<0)){missing.push('attachment-size:'+id);continue;}
      files.set(id,{id,filename:name,size});
    }
  };
  add(detail.files);
  const actions=Array.isArray(detail.actions)?detail.actions:record(detail.actions)?Object.values(detail.actions):[];
  for(const action of actions)if(record(action)&&action.files!==undefined)add(action.files);
  const queue:unknown[]=[detail.fields,detail.actions];let nodes=0;
  while(queue.length&&nodes++<20000){
    const value=queue.pop();if(typeof value==='string'){
      const attrs=/\b(?:src|href|data-src|data-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;let match:RegExpExecArray|null;
      while((match=attrs.exec(value))){const id=inlineFileId(match[1]??match[2]??match[3],base);if(id&&!files.has(id))files.set(id,{id,filename:'file-'+id,size:null});}
    }else if(record(value)||Array.isArray(value))queue.push(...Object.values(value));
  }
  if(queue.length)missing.push('inline-scan-budget');if(files.size>200)missing.push('attachment-count-budget');
  return{files:[...files.values()].slice(0,200),missing};
}
/** Current assigned-self reads share the same services for UI and actual fixed Agent tools. */
export class ZentaoDataService implements ApplicationDataHost {
  constructor(private readonly contexts:ApplicationExecutionContexts,private readonly resources:ApplicationDataResources,private readonly selections:ApplicationSelectionService){
    resources.registerProvider({kind:'zentao-object-v1',appId:'zentao',contractMajor:1,permission:'zentao.read',read:(context,backing)=>this.resource(context,backing)});
  }
  private get store(){return this.contexts.store;}
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>):HostToolOperation{
    if(version!==1||binding.appId!=='zentao'||!['zentao.work.list','zentao.object.get','zentao.resource.read'].includes(method))throw new ApplicationError('CAPABILITY_UNAVAILABLE','该禅道Data API尚未接入');
    const authorize=(run:RunContext,connectionId:string|null)=>{
      const selected=run.snapshot.packages.find(p=>p.appId==='zentao'&&p.packageHash===binding.packageHash);if(!selected?.allowedOperations.includes('zentao.read'))throw new ApplicationError('SCOPE_DENIED','原会话未选用该禅道读取能力');
      this.selections.requireApplicationEnabled(run.run.projectId,'zentao');const slot=this.selections.connectionSlot(run.run.projectId,'zentao','zentao');if(connectionId&&connectionId!==slot.connectionId)throw new ApplicationError('SCOPE_DENIED','请求来源不是当前项目明确选用的禅道连接');
    };
    return{semantics:'read',retry:'safe-read',authorize,authorizeReceipt:(run,id,_connection,signal)=>this.contexts.withReadReceipt(run,binding,id,scope=>this.receipt(scope,id),signal),execute:(run,args,operation)=>this.contexts.withAgent(run,binding,operation,'read',scope=>this.execute(scope,method,args))};
  }
  private async using<T>(context:ApplicationExecutionContext,expectedId:string|null,work:(client:ZentaoClient,connection:ApplicationConnection)=>Promise<T>):Promise<T>{
    const {connection,secret,configView}=await this.contexts.connection(context,'zentao',expectedId),view=connectionConfigSchema.parse(configView.view);
    if(view.kind!=='zentao')throw new ApplicationError('CONFIG_INCOMPATIBLE','当前来源不是禅道连接');
    const client=new ZentaoClient(view,secret,connection.identity);
    try{const result=await work(client,connection);this.contexts.require(context,'zentao.read');await this.contexts.connectionHealth(context,connection,null);return result;}
    catch(error){if(error instanceof ApplicationError&&['AUTH_FAILED','AUTH_REQUIRED','IDENTITY_CHANGE_REQUIRES_SELECTION','CONNECTION_UNAVAILABLE','TRANSIENT_FAILURE','TIMEOUT'].includes(error.code))try{await this.contexts.connectionHealth(context,connection,error.code);}catch{/* A revoked or newer connection must not inherit a stale health result. */}throw error;}
    finally{client.close();}
  }
  private target(context:ApplicationExecutionContext,connection:ApplicationConnection):string{return canonicalJson({connectionId:connection.id,identityRevision:connection.identityRevision,configRevision:connection.configRevision,policyRevision:connection.policyRevision,bindingRevision:this.selections.connectionSlot(context.projectId!,'zentao','zentao').revision,applicationPolicy:this.selections.policyStamp(context.projectId!,'zentao')});}
  private ref(row:ObjectRow):ZentaoSourceRef{return{connectionId:row.connection_id,identityRevision:row.identity_revision,nativeId:row.native_id,contentRevision:row.content_revision};}
  private save(context:ApplicationExecutionContext,connection:ApplicationConnection,kind:ZentaoKind,id:string,revision:string,payload:unknown,representation:'summary'|'detail'):Promise<ObjectRow>{
    if(!boundedJson(payload))throw new ApplicationError('INVALID_RESPONSE','禅道对象超过结构预算或包含不安全字段');const full=payload as ZentaoDetail,stored=representation==='detail'?{kind,id,fields:full.fields,actions:full.actions,files:full.files}:payload,source=canonicalJson(stored);if(digest(source)!==revision)throw new ApplicationError('HASH_MISMATCH','禅道来源内容摘要不同');const key=digest(canonicalJson({project:context.projectId,connection:connection.id,identity:connection.identityRevision,kind,id,revision,representation}));
    return withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      this.contexts.require(context,'zentao.read');const old=this.store.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE object_key=?').get(key) as ObjectRow|undefined;
      if(old&&old.payload_json!==source)throw new ApplicationError('HASH_MISMATCH','原来源修订已有其他内容，未覆盖历史');
      if(!old)this.store.sqlite.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,context.projectId,connection.id,connection.identityRevision,kind,id,revision,representation,source,new Date().toISOString());
      this.store.sqlite.prepare('INSERT OR IGNORE INTO application_zentao_operation_objects VALUES(?,?)').run(context.operationId,key);return this.store.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE object_key=?').get(key) as ObjectRow;
    }).immediate());
  }
  private known(context:Pick<ApplicationExecutionContext,'projectId'>,kind:ZentaoKind,reference:ZentaoSourceRef):ObjectRow{
    const row=this.store.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE project_id=? AND connection_id=? AND identity_revision=? AND object_kind=? AND native_id=? AND content_revision=? LIMIT 1').get(context.projectId,reference.connectionId,reference.identityRevision,kind,reference.nativeId,reference.contentRevision) as ObjectRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','当前项目没有该原来源对象引用，请先从本人列表查询');try{const value=JSON.parse(row.payload_json);if(!boundedJson(value)||digest(canonicalJson(value))!==row.content_revision||value.kind!==row.object_kind||value.id!==row.native_id)throw new Error();}catch{throw new ApplicationError('HASH_MISMATCH','原禅道来源引用内容损坏');}return row;
  }
  /** Local identity/hash check; callers must separately enforce current project policy. */
  assertStoredReference(projectId:string,kind:ZentaoKind,reference:ZentaoSourceRef):void{this.known({projectId},kind,reference);}
  execute(context:ApplicationExecutionContext,method:'zentao.work.list',input:unknown):Promise<ZentaoWorkData>;
  execute(context:ApplicationExecutionContext,method:'zentao.object.get',input:unknown):Promise<ZentaoDetailData>;
  execute(context:ApplicationExecutionContext,method:'zentao.resource.read',input:unknown):Promise<ApplicationResourceChunk>;
  execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>;
  async execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>{
    this.contexts.require(context,'zentao.read');if(context.scopeKind!=='project')throw new ApplicationError('SCOPE_DENIED','禅道业务读取需要真实项目');
    if(method==='zentao.resource.read')return this.resources.read(context,input);
    if(method==='zentao.work.list'){
      const parsed=listSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','禅道分页输入无效');const args=parsed.data;
      return this.using(context,args.connectionId??null,async(client,connection):Promise<ZentaoWorkData>=>{
        const target=this.target(context,connection);let pageNo=1,total:number|null=null,seen:string[]=[];
        if(args.cursor){if(!z.uuid().safeParse(args.cursor).success)throw new ApplicationError('INVALID_INPUT','禅道游标无效');const cursor=this.store.sqlite.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=?').get(args.cursor) as CursorRow|undefined;
          if(!cursor||cursor.project_id!==context.projectId)throw new ApplicationError('NOT_FOUND','当前项目没有该禅道游标');if(cursor.target_json!==target||cursor.object_kind!==args.kind||cursor.page_size!==args.limit||Date.parse(cursor.expires_at)<=Date.now())throw new ApplicationError('REVISION_CONFLICT','来源、分页条件或游标已变化，请重新查询');
          try{seen=z.array(z.string().regex(/^[0-9]{1,64}$/)).max(10000).parse(JSON.parse(cursor.seen_json));}catch{throw new ApplicationError('HASH_MISMATCH','原分页记录已损坏');}pageNo=cursor.page_no;total=cursor.expected_total;
        }
        const page=await client.page(args.kind,pageNo,args.limit,context.signal),ids=page.records.map(item=>zentaoId(item.id));this.contexts.require(context,'zentao.read');
        const expected=Math.max(0,Math.min(args.limit,page.total-(pageNo-1)*args.limit));
        if(total!==null&&page.total!==total||ids.some(id=>seen.includes(id))||ids.length!==expected||seen.length+ids.length>10000)return{kind:args.kind,items:[],total:page.total,nextCursor:null,complete:false,checkedAt:new Date().toISOString(),problems:[{code:'INCOMPLETE_RESULT',objectId:null}]};
        const items:ZentaoWorkData['items']=[];
        for(const fields of page.records){const id=zentaoId(fields.id);if(typeof fields.title!=='string'||fields.title.length>8192||typeof fields.status!=='string'||fields.status.length>120)throw new ApplicationError('INVALID_RESPONSE','禅道标题或状态字段不符合原契约');
          const payload={kind:args.kind,id,fields},row=await this.save(context,connection,args.kind,id,digest(canonicalJson(payload)),payload,'summary');items.push({id,title:fields.title,status:fields.status,assignedTo:(connection.config as {username:string}).username,reference:this.ref(row)});
        }
        const complete=pageNo>=Math.max(1,page.pageTotal);let nextCursor:string|null=null;
        if(!complete){nextCursor=randomUUID();await withResourceLock(this.store.root,()=>{this.contexts.require(context,'zentao.read');this.store.sqlite.prepare('DELETE FROM application_zentao_cursors WHERE expires_at<=?').run(new Date().toISOString());this.store.sqlite.prepare('INSERT INTO application_zentao_cursors VALUES(?,?,?,?,?,?,?,?,?)').run(nextCursor,context.projectId,target,args.kind,args.limit,pageNo+1,page.total,canonicalJson([...seen,...ids]),new Date(Date.now()+10*60000).toISOString());});}
        return{kind:args.kind,items,total:page.total,nextCursor,complete,checkedAt:new Date().toISOString(),problems:[]};
      });
    }
    if(method==='zentao.object.get'){
      const parsed=getSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','禅道对象引用无效');const args=parsed.data;this.known(context,args.kind,args.reference);
      return this.using(context,args.reference.connectionId,async(client,connection)=>{if(connection.identityRevision!==args.reference.identityRevision)throw new ApplicationError('SCOPE_DENIED','原对象来源身份已变化');const detail=await client.detail(args.kind,args.reference.nativeId,context.signal),row=await this.save(context,connection,detail.kind,detail.id,detail.contentRevision,detail,'detail');return this.view(context,client,connection,row,detail);});
    }
    throw new ApplicationError('CAPABILITY_UNAVAILABLE','该禅道Data API尚未接入');
  }
  private detail(row:ObjectRow):ZentaoDetail{
    try{const value=JSON.parse(row.payload_json) as ZentaoDetail;if(!boundedJson(value)||value.kind!==row.object_kind||value.id!==row.native_id||!record(value.fields)||digest(canonicalJson(value))!==row.content_revision)throw new Error();return zentaoDetailRevision(value.kind,value.id,value.fields,value.actions,value.files);}catch{throw new ApplicationError('HASH_MISMATCH','原禅道对象修订损坏');}
  }
  private async reference(context:ApplicationExecutionContext,row:ObjectRow,part:string,mediaType:string,bytes:Uint8Array,revision=row.content_revision):Promise<ApplicationResourceRef>{return this.resources.register(context,{kind:'zentao-object-v1',objectId:row.object_key,objectRevision:revision,part},mediaType,bytes);}
  private async view(context:ApplicationExecutionContext,client:ZentaoClient,connection:ApplicationConnection,row:ObjectRow,detail:ZentaoDetail):Promise<ZentaoDetailData>{
    const fields:Record<string,unknown>={};
    for(const [key,value] of Object.entries(detail.fields)){
      if(['steps','spec','description','verify','verifyCriteria','actions','files'].includes(key))continue;
      if(['__proto__','constructor','prototype'].includes(key))throw new ApplicationError('INVALID_RESPONSE','禅道字段名不安全');const bytes=jsonBytes(value);fields[key]=bytes.length>8192?await this.reference(context,row,fieldPart(key),'application/json',bytes):value;
    }
    const body=Object.keys(fieldsBody(detail)).length?await this.reference(context,row,'body','application/json',bodyBytes(detail)):null;
    const history=Array.isArray(detail.actions)||record(detail.actions)?await this.reference(context,row,'history','application/json',jsonBytes(detail.actions)):null;
    const described=zentaoFiles(detail,(connection.config as {baseUrl:string}).baseUrl),missing=[...detail.missing,...described.missing],attachments:ZentaoDetailData['attachments']=[];let remaining=64*1024*1024;
    for(const file of described.files){
      if(file.size!==null&&(file.size>25*1024*1024||file.size>remaining)){missing.push('attachment:'+file.id+':TOO_LARGE');continue;}
      if(remaining===0){missing.push('attachment:'+file.id+':BUDGET');continue;}
      try{
        const downloaded=await client.file(file.id,context.signal,Math.min(remaining,25*1024*1024));remaining-=downloaded.bytes.length;
        if(file.size!==null&&file.size!==downloaded.bytes.length)throw new ApplicationError('INCOMPLETE_RESULT','附件内容长度与原元数据不符');const hash=digest(downloaded.bytes);
        await withResourceLock(this.store.root,()=>{this.contexts.require(context,'zentao.read');this.store.sqlite.prepare('INSERT OR IGNORE INTO application_zentao_files VALUES(?,?,?,?,?,?,?)').run(row.object_key,file.id,hash,downloaded.bytes,downloaded.mediaType,downloaded.bytes.length,new Date().toISOString());});
        attachments.push({filename:file.filename,resource:await this.reference(context,row,'file:'+file.id,downloaded.mediaType,downloaded.bytes,row.content_revision+':'+hash)});
      }catch(error){if(context.signal.aborted)throw error;missing.push('attachment:'+file.id+':'+(error instanceof ApplicationError?error.code:'CONNECTION_UNAVAILABLE'));}
    }
    const problems=[...new Set(missing)];if(problems.length>200)throw new ApplicationError('INCOMPLETE_RESULT','来源缺失项超过原工具响应预算，未返回不完整的缺项清单');
    return{kind:detail.kind,id:detail.id,reference:this.ref(row),fields,body,history,attachments,complete:problems.length===0,missing:problems};
  }
  private async resource(context:ApplicationExecutionContext,backing:Readonly<ApplicationResourceBacking>):Promise<Uint8Array>{
    const row=this.store.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE object_key=? AND project_id=? AND representation=\'detail\'').get(backing.objectId,context.projectId) as ObjectRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','当前项目没有此禅道资源');const original=this.detail(row);
    return this.using(context,row.connection_id,async(client,connection)=>{
      if(connection.identityRevision!==row.identity_revision)throw new ApplicationError('SCOPE_DENIED','原禅道资源身份不可用');const current=await client.detail(row.object_kind,row.native_id,context.signal);
      await withResourceLock(this.store.root,()=>{this.contexts.require(context,'zentao.read');this.store.sqlite.prepare('INSERT OR IGNORE INTO application_zentao_operation_objects VALUES(?,?)').run(context.operationId,row.object_key);const serialized=canonicalJson(backing),old=this.store.sqlite.prepare('SELECT backing_json FROM application_zentao_operation_resources WHERE operation_id=?').get(context.operationId) as {backing_json:string}|undefined;if(old&&old.backing_json!==serialized)throw new ApplicationError('REVISION_CONFLICT','同一读取不能替换原资源');this.store.sqlite.prepare('INSERT OR IGNORE INTO application_zentao_operation_resources VALUES(?,?)').run(context.operationId,serialized);});
      if(backing.part.startsWith('file:')){
        const id=zentaoId(backing.part.slice(5)),parts=backing.objectRevision.split(':');if(parts.length!==2||parts[0]!==row.content_revision||!zentaoFiles(current,(connection.config as {baseUrl:string}).baseUrl).files.some(f=>f.id===id))throw new ApplicationError('SOURCE_UNAVAILABLE','原附件已不在当前本人对象中');
        const file=this.store.sqlite.prepare('SELECT bytes,content_hash,byte_size FROM application_zentao_files WHERE object_key=? AND file_id=? AND content_hash=?').get(row.object_key,id,parts[1]) as {bytes:Buffer;content_hash:string;byte_size:number}|undefined;
        if(!file||file.bytes.length!==file.byte_size||digest(file.bytes)!==file.content_hash)throw new ApplicationError('HASH_MISMATCH','原禅道附件副本已损坏或缺失');return file.bytes;
      }
      if(backing.objectRevision!==row.content_revision)throw new ApplicationError('HASH_MISMATCH','原禅道资源修订不同');
      if(backing.part==='body')return bodyBytes(original);if(backing.part==='history')return jsonBytes(original.actions);
      const field=Object.keys(original.fields).find(k=>fieldPart(k)===backing.part);if(field!==undefined)return jsonBytes(original.fields[field]);throw new ApplicationError('NOT_FOUND','原禅道资源字段不存在');
    });
  }
  private async receipt(context:ApplicationExecutionContext,originalOperationId:string):Promise<void>{
    const rows=this.store.sqlite.prepare('SELECT r.* FROM application_zentao_operation_objects o JOIN application_zentao_revisions r ON r.object_key=o.object_key WHERE o.operation_id=? AND r.project_id=?').all(originalOperationId,context.projectId) as ObjectRow[];
    const resource=this.store.sqlite.prepare('SELECT backing_json FROM application_zentao_operation_resources WHERE operation_id=?').get(originalOperationId) as {backing_json:string}|undefined;
    if(resource){let backing:ApplicationResourceBacking;try{backing=z.object({kind:z.literal('zentao-object-v1'),objectId:z.string().regex(/^[a-f0-9]{64}$/),objectRevision:z.string(),part:z.string()}).strict().parse(JSON.parse(resource.backing_json));}catch{throw new ApplicationError('HASH_MISMATCH','原资源回执的来源记录损坏');}await this.resource(context,backing);return;}
    if(!rows.length)return;
    const method=(this.store.sqlite.prepare('SELECT action FROM application_data_operations WHERE operation_id=?').get(originalOperationId) as {action:string}).action;
    await this.using(context,rows[0].connection_id,async client=>{
      if(rows.some(r=>r.connection_id!==rows[0].connection_id||r.identity_revision!==rows[0].identity_revision))throw new ApplicationError('HASH_MISMATCH','原读取回执混入其他来源');
      if(method==='smartdd_zentao_work_list_v1'){
        const remaining=new Set(rows.map(r=>r.native_id));for(let n=1;n<=50;n++){const page=await client.page(rows[0].object_kind,n,200,context.signal);for(const r of page.records)remaining.delete(zentaoId(r.id));this.contexts.require(context,'zentao.read');if(!remaining.size)return;if(n>=Math.max(1,page.pageTotal))throw new ApplicationError('SCOPE_DENIED','原列表对象已不全在当前本人范围');}throw new ApplicationError('INCOMPLETE_RESULT','原列表回执的当前归属未在预算内核实');
      }
      for(const row of rows)await client.detail(row.object_kind,row.native_id,context.signal);
    });
  }
}
