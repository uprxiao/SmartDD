import {randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {zentaoConfigSchema,verifiedConnectionIdentitySchema} from '@shared/application-connections';
import {applicationResourceRefSchema} from '@shared/application-data';
import {zentaoSourceRefSchema,type ZentaoSourceRef,type ZentaoPresentation} from '@shared/application-zentao';
import {pluginExecutionScopeSchema,type PluginExecutionScope} from '@shared/plugin-session';
import {canonicalJson,digest} from '../../../src/main/core/applications/manifest';
import {ZentaoClient,zentaoId,zentaoDetailRevision,type ZentaoKind,type ZentaoDetail} from './client';
import {zentaoFiles,fieldsBody,fieldPart,bodyBytes,jsonBytes} from './attachments';
import {ZENTAO_RESOURCE_TABLE_SQL} from './storage';

const kind=z.enum(['bug','story']);
const listInput=z.object({kind,connectionId:z.uuid().nullable().optional(),cursor:z.uuid().nullable().optional(),limit:z.number().int().min(1).max(200).default(50)}).strict();
const detailInput=z.object({kind,reference:zentaoSourceRefSchema}).strict();
const resourceInput=z.object({resource:applicationResourceRefSchema,offset:z.number().int().safe().nonnegative().default(0),length:z.number().int().min(1).max(262144).default(131072)}).strict();
const sourceConnection=z.object({id:z.uuid(),provider:z.literal('zentao'),config:z.object({baseUrl:z.string(),username:z.string()}).strict(),identityRevision:z.number().int().safe().positive(),configRevision:z.number().int().safe().nonnegative(),policyRevision:z.number().int().safe().nonnegative(),identity:verifiedConnectionIdentitySchema,authMode:z.enum(['token','password']),secret:z.string().min(1).max(65536)}).strict();
type Connection=z.infer<typeof sourceConnection>;
interface ObjectRow {object_key:string;project_id:string;connection_id:string;identity_revision:number;object_kind:ZentaoKind;native_id:string;content_revision:string;representation:'summary'|'detail';payload_json:string}
interface ResourceRow {resource_id:string;project_id:string;connection_id:string;identity_revision:number;object_key:string;object_revision:string;part:string;content_hash:string;byte_size:number;media_type:string}
interface CursorRow {project_id:string;target_json:string;object_kind:ZentaoKind;page_size:number;page_no:number;expected_total:number;seen_json:string;expires_at:string}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validation=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','禅道插件参数不符合契约');return parsed.data;};

/** All domain reads and immutable copies live in this independently packaged process, never in the host database. */
export class ZentaoPluginRuntime {
  private readonly db:DatabaseSync;
  private readonly presentations=new Map<string,{until:number;value:ZentaoPresentation}>();
  constructor(directory:string,schemaSql:string){
    if(realpathSync(directory)!==directory||!lstatSync(directory).isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','禅道私有目录归属无效');
    const path=join(directory,'zentao.sqlite');let fd:number;
    try{fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;fd=openSync(path,constants.O_RDWR|constants.O_NOFOLLOW);}
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||realpathSync(path)!==path)throw new ApplicationError('OWNERSHIP_CONFLICT','禅道私有数据库不是受管普通文件');}finally{closeSync(fd);}
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;');
    this.db.exec(schemaSql);
    this.db.exec(ZENTAO_RESOURCE_TABLE_SQL);
  }
  close(){this.presentations.clear();this.db.close();}
  async verify(input:unknown,signal:AbortSignal){
    const parsed=validation(z.object({provider:z.literal('zentao'),config:z.object({baseUrl:z.string(),username:z.string()}).strict(),authMode:z.enum(['token','password']),secret:z.string().min(1).max(65536)}).strict(),input);
    const config=validation(zentaoConfigSchema,{kind:'zentao',...parsed.config,authMode:parsed.authMode}),client=new ZentaoClient(config,parsed.secret);
    try{const identity=await client.verify(signal);return{identity:{serviceId:identity.serviceId,accountId:identity.accountId}};}finally{client.close();}
  }
  private using<T>(connection:Connection,signal:AbortSignal,work:(client:ZentaoClient)=>Promise<T>):Promise<T>{
    const config=validation(zentaoConfigSchema,{kind:'zentao',...connection.config,authMode:connection.authMode});
    if(connection.identity.providerId!=='zentao')throw new ApplicationError('SCOPE_DENIED','禅道连接来源身份不符');
    const client=new ZentaoClient(config,connection.secret,connection.identity);return(async()=>{try{return await work(client);}finally{client.close();}})();
  }
  private ref(row:ObjectRow):ZentaoSourceRef{return{connectionId:row.connection_id,identityRevision:row.identity_revision,nativeId:row.native_id,contentRevision:row.content_revision};}
  private known(projectId:string,objectKind:ZentaoKind,reference:ZentaoSourceRef):ObjectRow{
    const row=this.db.prepare('SELECT * FROM application_zentao_revisions WHERE project_id=? AND connection_id=? AND identity_revision=? AND object_kind=? AND native_id=? AND content_revision=? LIMIT 1').get(projectId,reference.connectionId,reference.identityRevision,objectKind,reference.nativeId,reference.contentRevision) as unknown as ObjectRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','当前项目没有该原来源对象，请先从本人列表查询');
    const value=JSON.parse(row.payload_json);if(!boundedJson(value)||digest(canonicalJson(value))!==row.content_revision||value.kind!==row.object_kind||value.id!==row.native_id)throw new ApplicationError('HASH_MISMATCH','原禅道对象修订损坏');return row;
  }
  private save(scope:PluginExecutionScope,connection:Connection,objectKind:ZentaoKind,id:string,revision:string,payload:unknown,representation:'summary'|'detail'):ObjectRow{
    if(!boundedJson(payload))throw new ApplicationError('INVALID_RESPONSE','禅道对象超过结构预算');const source=canonicalJson(payload);
    if(digest(source)!==revision)throw new ApplicationError('HASH_MISMATCH','禅道来源摘要不符');
    const key=digest(canonicalJson({project:scope.projectId,connection:connection.id,identity:connection.identityRevision,kind:objectKind,id,revision,representation})),prior=this.db.prepare('SELECT * FROM application_zentao_revisions WHERE object_key=?').get(key) as unknown as ObjectRow|undefined;
    if(prior&&prior.payload_json!==source)throw new ApplicationError('HASH_MISMATCH','原来源修订已有其他内容');
    if(!prior)this.db.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,scope.projectId,connection.id,connection.identityRevision,objectKind,id,revision,representation,source,new Date().toISOString());
    this.db.prepare('INSERT OR IGNORE INTO application_zentao_operation_objects VALUES(?,?)').run(scope.operationId,key);
    return this.db.prepare('SELECT * FROM application_zentao_revisions WHERE object_key=?').get(key) as unknown as ObjectRow;
  }
  private async presentation(scope:PluginExecutionScope,connection:Connection,client:ZentaoClient,objectKind:ZentaoKind,signal:AbortSignal){
    const key=canonicalJson({project:scope.projectId,connection:connection.id,identity:connection.identityRevision,config:connection.configRevision,kind:objectKind}),cached=this.presentations.get(key);if(cached&&cached.until>Date.now())return cached.value;
    try{const value=await client.presentation(objectKind,signal);this.presentations.set(key,{until:Date.now()+300000,value});while(this.presentations.size>32)this.presentations.delete(this.presentations.keys().next().value!);return value;}
    catch(error){if(signal.aborted)throw error;return{available:false,labels:{},choices:{}};}
  }
  private resource(row:ObjectRow,part:string,mediaType:string,bytes:Uint8Array,revision=row.content_revision){
    const hash=digest(bytes),old=this.db.prepare('SELECT * FROM plugin_resources WHERE project_id=? AND connection_id=? AND identity_revision=? AND object_key=? AND object_revision=? AND part=?').get(row.project_id,row.connection_id,row.identity_revision,row.object_key,revision,part) as unknown as ResourceRow|undefined;
    if(old&&(old.content_hash!==hash||old.byte_size!==bytes.length||old.media_type!==mediaType))throw new ApplicationError('HASH_MISMATCH','原资源修订已有其他内容');
    const id=old?.resource_id??randomUUID();if(!old)this.db.prepare('INSERT INTO plugin_resources VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,row.project_id,row.connection_id,row.identity_revision,row.object_key,revision,part,hash,bytes.length,mediaType);
    return{id,revision:hash,mediaType,size:bytes.length};
  }
  async execute(capability:string,input:unknown,rawConnections:unknown,rawScope:unknown,signal:AbortSignal):Promise<unknown>{
    const scope=validation(pluginExecutionScopeSchema,rawScope),connections=validation(z.object({zentao:sourceConnection}).strict(),rawConnections),connection=connections.zentao;
    if(capability==='zentao.object.list'){
      const args=validation(listInput,input);if(args.connectionId&&args.connectionId!==connection.id)throw new ApplicationError('SCOPE_DENIED','请求不能替换宿主选用的连接');
      return this.using(connection,signal,async client=>{
        const target=canonicalJson({project:scope.projectId,connection:connection.id,identity:connection.identityRevision,config:connection.configRevision,policy:connection.policyRevision});let pageNo=1,total:number|null=null,seen:string[]=[];
        if(args.cursor){const cursor=this.db.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=? AND project_id=?').get(args.cursor,scope.projectId) as unknown as CursorRow|undefined;
          if(!cursor)throw new ApplicationError('NOT_FOUND','当前项目没有该禅道游标');if(cursor.target_json!==target||cursor.object_kind!==args.kind||cursor.page_size!==args.limit||Date.parse(cursor.expires_at)<=Date.now())throw new ApplicationError('REVISION_CONFLICT','来源或分页条件已变化，请重新查询');seen=validation(z.array(z.string().regex(/^[0-9]{1,64}$/)).max(10000),JSON.parse(cursor.seen_json));pageNo=cursor.page_no;total=cursor.expected_total;}
        const page=await client.page(args.kind,pageNo,args.limit,signal),ids=page.records.map(item=>zentaoId(item.id)),expected=Math.max(0,Math.min(args.limit,page.total-(pageNo-1)*args.limit));
        if(total!==null&&page.total!==total||ids.some(id=>seen.includes(id))||ids.length!==expected||seen.length+ids.length>10000)return{kind:args.kind,items:[],total:page.total,nextCursor:null,complete:false,checkedAt:new Date().toISOString(),problems:[{code:'INCOMPLETE_RESULT',objectId:null}]};
        const items=page.records.map(fields=>{const id=zentaoId(fields.id);if(typeof fields.title!=='string'||fields.title.length>8192||typeof fields.status!=='string'||fields.status.length>120)throw new ApplicationError('INVALID_RESPONSE','禅道标题或状态不符合契约');const payload={kind:args.kind,id,fields},row=this.save(scope,connection,args.kind,id,digest(canonicalJson(payload)),payload,'summary');return{id,title:fields.title,status:fields.status,assignedTo:connection.config.username,reference:this.ref(row)};});
        const complete=pageNo>=Math.max(1,page.pageTotal);let nextCursor:string|null=null;
        if(!complete){nextCursor=randomUUID();this.db.prepare('DELETE FROM application_zentao_cursors WHERE expires_at<=?').run(new Date().toISOString());this.db.prepare('INSERT INTO application_zentao_cursors VALUES(?,?,?,?,?,?,?,?,?)').run(nextCursor,scope.projectId,target,args.kind,args.limit,pageNo+1,page.total,canonicalJson([...seen,...ids]),new Date(Date.now()+600000).toISOString());}
        return{kind:args.kind,items,total:page.total,nextCursor,complete,checkedAt:new Date().toISOString(),problems:[],...(items.length&&scope.callerKind==='ui'?{presentation:await this.presentation(scope,connection,client,args.kind,signal)}:{})};
      });
    }
    if(capability==='zentao.object.get'){
      const args=validation(detailInput,input);if(args.reference.connectionId!==connection.id||args.reference.identityRevision!==connection.identityRevision)throw new ApplicationError('SCOPE_DENIED','原对象来源与宿主选用连接不符');this.known(scope.projectId,args.kind,args.reference);
      return this.using(connection,signal,async client=>{
        const detail=await client.detail(args.kind,args.reference.nativeId,signal),payload={kind:detail.kind,id:detail.id,fields:detail.fields,actions:detail.actions,files:detail.files},row=this.save(scope,connection,detail.kind,detail.id,detail.contentRevision,payload,'detail'),fields:Record<string,unknown>={};
        for(const [key,value]of Object.entries(detail.fields)){if(['steps','spec','description','verify','verifyCriteria','actions','files'].includes(key))continue;if(['__proto__','constructor','prototype'].includes(key))throw new ApplicationError('INVALID_RESPONSE','禅道字段名不安全');const bytes=jsonBytes(value);fields[key]=bytes.length>8192?this.resource(row,fieldPart(key),'application/json',bytes):value;}
        const body=Object.keys(fieldsBody(detail)).length?this.resource(row,'body','application/json',bodyBytes(detail)):null,history=Array.isArray(detail.actions)||record(detail.actions)?this.resource(row,'history','application/json',jsonBytes(detail.actions)):null,described=zentaoFiles(detail,connection.config.baseUrl),missing=[...detail.missing,...described.missing],attachments:{filename:string;resource:ReturnType<ZentaoPluginRuntime['resource']>}[]=[];let remaining=64*1024*1024;
        for(const file of described.files){if(file.size!==null&&(file.size>25*1024*1024||file.size>remaining)||!remaining){missing.push('attachment:'+file.id+':TOO_LARGE');continue;}
          try{const downloaded=await client.file(file.id,signal,Math.min(remaining,25*1024*1024));remaining-=downloaded.bytes.length;if(file.size!==null&&file.size!==downloaded.bytes.length)throw new ApplicationError('INCOMPLETE_RESULT','附件长度与原元数据不符');const hash=digest(downloaded.bytes);this.db.prepare('INSERT OR IGNORE INTO application_zentao_files VALUES(?,?,?,?,?,?,?)').run(row.object_key,file.id,hash,downloaded.bytes,downloaded.mediaType,downloaded.bytes.length,new Date().toISOString());attachments.push({filename:file.filename,resource:this.resource(row,'file:'+file.id,downloaded.mediaType,downloaded.bytes,row.content_revision+':'+hash)});}
          catch(error){if(signal.aborted)throw error;missing.push('attachment:'+file.id+':'+(error instanceof ApplicationError?error.code:'CONNECTION_UNAVAILABLE'));}}
        const problems=[...new Set(missing)];if(problems.length>200)throw new ApplicationError('INCOMPLETE_RESULT','来源缺失项超过响应预算');return{kind:detail.kind,id:detail.id,reference:this.ref(row),fields,body,history,attachments,complete:problems.length===0,missing:problems,...(scope.callerKind==='ui'?{presentation:await this.presentation(scope,connection,client,detail.kind,signal)}:{})};
      });
    }
    if(capability==='zentao.resource.read')return this.read(scope,connection,input,signal);
    throw new ApplicationError('CAPABILITY_UNAVAILABLE','禅道插件未声明该能力');
  }
  private async read(scope:PluginExecutionScope,connection:Connection,input:unknown,signal:AbortSignal){
    const args=validation(resourceInput,input),ref=args.resource,row=this.db.prepare('SELECT * FROM plugin_resources WHERE resource_id=? AND project_id=? AND connection_id=? AND identity_revision=?').get(ref.id,scope.projectId,connection.id,connection.identityRevision) as unknown as ResourceRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','当前项目和连接没有该原资源');if(row.content_hash!==ref.revision||row.byte_size!==ref.size||row.media_type!==ref.mediaType)throw new ApplicationError('HASH_MISMATCH','不能替换资源修订或类型');
    const object=this.db.prepare("SELECT * FROM application_zentao_revisions WHERE object_key=? AND project_id=? AND representation='detail'").get(row.object_key,scope.projectId) as unknown as ObjectRow|undefined;
    if(!object)throw new ApplicationError('NOT_FOUND','原资源所属对象不存在');const payload=JSON.parse(object.payload_json);if(!boundedJson(payload)||digest(canonicalJson(payload))!==object.content_revision)throw new ApplicationError('HASH_MISMATCH','原对象修订损坏');
    const original=zentaoDetailRevision(object.object_kind,object.native_id,payload.fields,payload.actions,payload.files);
    return this.using(connection,signal,async client=>{
      const current=await client.detail(object.object_kind,object.native_id,signal);let bytes:Buffer;
      if(row.part.startsWith('file:')){const id=zentaoId(row.part.slice(5)),parts=row.object_revision.split(':');if(parts.length!==2||parts[0]!==object.content_revision||!zentaoFiles(current,connection.config.baseUrl).files.some(f=>f.id===id))throw new ApplicationError('SOURCE_UNAVAILABLE','原附件已不在当前本人对象中');const file=this.db.prepare('SELECT bytes,byte_size FROM application_zentao_files WHERE object_key=? AND file_id=? AND content_hash=?').get(object.object_key,id,parts[1]);if(!file||!(file.bytes instanceof Uint8Array)||file.bytes.length!==file.byte_size)throw new ApplicationError('HASH_MISMATCH','原附件副本缺失或损坏');bytes=Buffer.from(file.bytes);}
      else if(row.object_revision!==object.content_revision)throw new ApplicationError('HASH_MISMATCH','原资源修订不符');
      else if(row.part==='body')bytes=bodyBytes(original);else if(row.part==='history')bytes=jsonBytes(original.actions);else{const key=Object.keys(original.fields).find(k=>fieldPart(k)===row.part);if(key===undefined)throw new ApplicationError('NOT_FOUND','原资源字段不存在');bytes=jsonBytes(original.fields[key]);}
      if(bytes.length!==row.byte_size||digest(bytes)!==row.content_hash)throw new ApplicationError('HASH_MISMATCH','原资源内容已变化');if(args.offset>bytes.length)throw new ApplicationError('INVALID_INPUT','资源读取位置超出原内容');
      this.db.prepare('INSERT OR IGNORE INTO application_zentao_operation_objects VALUES(?,?)').run(scope.operationId,object.object_key);
      let size=Math.min(args.length,131072,bytes.length-args.offset);
      while(true){const chunk=bytes.subarray(args.offset,args.offset+size);let encoding:'utf8'|'base64'='base64',data=chunk.toString('base64');if(row.media_type.startsWith('text/')||row.media_type==='application/json')try{data=new TextDecoder('utf-8',{fatal:true}).decode(chunk);encoding='utf8';}catch{/* Preserve split UTF8 bytes in base64. */}
        const next=args.offset+size,eof=next===bytes.length,result={resourceId:ref.id,revision:ref.revision,mediaType:row.media_type,offset:args.offset,length:size,encoding,data,nextOffset:eof?null:next,eof,truncated:!eof};if(Buffer.byteLength(JSON.stringify(result))<=224*1024)return result;if(size<2)throw new ApplicationError('TOO_LARGE','资源结果无法放入协议帧');size=Math.floor(size/2);}
    });
  }
}

export function packagedZentaoRuntime(dataDirectory:string,packageDirectory:string){return new ZentaoPluginRuntime(dataDirectory,readFileSync(join(packageDirectory,'runtime/schema.sql'),'utf8'));}
