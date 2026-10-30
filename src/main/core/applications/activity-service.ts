import {mailAttachmentSourceSchema} from '@shared/application-attachments';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {applicationActivityQuerySchema,type ApplicationActivityDetail,type ApplicationActivityItem,type ApplicationActivityPage,type ApplicationActivityQuery} from '@shared/application-activity';
import {draftContentSchema} from '@shared/mail-drafts';
import type {ResourceStore} from './resource-store';
import {canonicalJson,digest} from './manifest';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid();
const cursorSchema=z.object({schema:z.literal(1),filter:hash,at:z.iso.datetime(),key:z.string().regex(/^(operation|send):[a-f0-9-]{36}$/)}).strict();
const subjectSchema=z.array(z.object({kind:z.enum(['connection','mail-send','mail-draft']),id}).strict()).max(200);
const targetSchema=z.array(z.object({id}).passthrough()).max(3);
const attachmentSchema=z.array(z.object({id,filename:z.string().max(1024),contentType:z.string().max(256),size:z.number().int().nonnegative(),contentHash:hash,createdAt:z.string()}).strict()).max(100);
const resultSchema=z.object({state:z.enum(['server-accepted','failed','unknown']),complete:z.boolean(),accepted:z.array(z.string().max(512)).max(100),rejected:z.array(z.string().max(512)).max(100),errorCode:z.string().nullable(),smtpCode:z.number().nullable(),messageId:z.string().max(2000)}).strict();
type Row={key:string;kind:'operation'|'send';id:string;app_id:'mail'|'zentao';project_id:string|null;task_id:string|null;run_id:string|null;job_id:string|null;parent_operation_id:string|null;caller_kind:ApplicationActivityItem['callerKind'];action:string;semantics:'read'|'write';state:string;attempt_count:number;error_code:string|null;effect_state:string|null;request_id:string|null;started_at:string;ended_at:string|null;targets_json:string;connection_id:string|null;subjects_json:string;draft_id:string|null;draft_revision:number|null;execution_id:string|null;execution_state:string|null;authorization_source:string|null;grant_state:string|null;updated_at:string|null};
/** A read-only union. The MCP transport and Data API share one operation identity;
 * SMTP execution remains a distinct, authoritative business record. No results,
 * user grants, scopes or provider calls are created by inspecting this history. */
const ledger=`
 SELECT 'operation:'||v.operation_id AS key,'operation' AS kind,v.operation_id AS id,v.app_id,v.project_id,v.task_id,v.run_id,o.job_id,o.parent_operation_id,'agent-run' AS caller_kind,v.tool_name AS action,v.semantics,v.state,v.attempt_count,v.error_code,v.effect_state,v.request_id,v.started_at,v.ended_at,COALESCE(o.targets_json,'[]') AS targets_json,v.connection_id,
 (SELECT json_group_array(json_object('kind',s.kind,'id',s.subject_id)) FROM application_activity_subjects s WHERE s.operation_id=v.operation_id) AS subjects_json,
 NULL AS draft_id,NULL AS draft_revision,NULL AS execution_id,NULL AS execution_state,NULL AS authorization_source,NULL AS grant_state,NULL AS updated_at
 FROM application_invocations v LEFT JOIN application_data_operations o ON o.operation_id=v.operation_id
 UNION ALL
 SELECT 'operation:'||o.operation_id,'operation',o.operation_id,o.app_id,o.project_id,o.task_id,o.run_id,o.job_id,o.parent_operation_id,o.caller_kind,o.action,o.semantics,o.state,o.attempt_count,o.error_code,NULL,NULL,o.started_at,o.ended_at,o.targets_json,NULL,
 (SELECT json_group_array(json_object('kind',s.kind,'id',s.subject_id)) FROM application_activity_subjects s WHERE s.operation_id=o.operation_id),NULL,NULL,NULL,NULL,NULL,NULL,NULL
 FROM application_data_operations o WHERE NOT EXISTS(SELECT 1 FROM application_invocations v WHERE v.operation_id=o.operation_id)
 UNION ALL
 SELECT 'send:'||s.id,'send',s.id,'mail',s.project_id,s.source_task_id,s.source_run_id,NULL,NULL,CASE WHEN s.source_run_id IS NULL THEN 'ui' ELSE 'agent-run' END,'mail.send','write',s.state,CASE WHEN e.id IS NULL THEN 0 ELSE 1 END,s.error_code,NULL,NULL,s.created_at,e.ended_at,'[]',s.connection_id,'[]',s.draft_id,s.draft_revision,s.execution_id,e.state,g.source,g.state,s.updated_at
 FROM mail_send_intents s LEFT JOIN mail_send_executions e ON e.id=s.execution_id AND e.intent_id=s.id LEFT JOIN mail_send_grants g ON g.id=s.grant_id AND g.intent_id=s.id`;
function stored<T>(raw:string,schema:z.ZodType<T>):T {try{return schema.parse(JSON.parse(raw));}catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原业务记录有字段缺失或损坏，未用当前配置替换');}}
export class ApplicationActivityService {
 constructor(private readonly store:ResourceStore){}
 private item(row:Row):ApplicationActivityItem {
  if(row.kind==='send'){
   const state=stored(JSON.stringify(row.state),z.enum(['preparing','awaiting-authorization','authorized','executing','server-accepted','failed','unknown','canceled','stale']));
   if((['executing','server-accepted','unknown'].includes(state)&&!row.execution_id)||(row.execution_id&&row.execution_state!==state))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发送阶段与执行账不一致，未判断为成功或再次执行');
  }
  const targets=stored(row.targets_json,targetSchema),subjects=stored(row.subjects_json,subjectSchema),ids=new Set([...targets.map(x=>x.id),...subjects.filter(s=>s.kind==='connection').map(s=>s.id),...(row.connection_id?[row.connection_id]:[])]);
  const project=row.project_id?this.store.sqlite.prepare('SELECT name FROM projects WHERE id=?').get(row.project_id) as {name:string}|undefined:undefined;
  const task=row.task_id?this.store.sqlite.prepare('SELECT title FROM tasks WHERE id=? AND project_id=?').get(row.task_id,row.project_id) as {title:string}|undefined:undefined;
  return {id:row.id,kind:row.kind,appId:row.app_id,projectId:row.project_id,projectName:project?.name??null,taskId:row.task_id,taskTitle:task?.title??null,runId:row.run_id,jobId:row.job_id,parentOperationId:row.parent_operation_id,callerKind:row.caller_kind,action:row.action,semantics:row.semantics,state:row.state,attemptCount:row.attempt_count,errorCode:row.error_code,effectState:row.effect_state,requestId:row.request_id,startedAt:row.started_at,endedAt:row.ended_at,
   connections:[...ids].map(id=>{const c=this.store.sqlite.prepare('SELECT name FROM application_connections WHERE id=? AND app_id=?').get(id,row.app_id) as {name:string}|undefined;return{id,name:c?.name??null};}),subjects,
   send:row.kind==='send'?{intentId:row.id,draftId:row.draft_id!,draftRevision:row.draft_revision!,executionId:row.execution_id,state:row.state as NonNullable<ApplicationActivityItem['send']>['state'],executionState:row.execution_state,authorizationSource:row.authorization_source,grantState:row.grant_state,updatedAt:row.updated_at!}:null};
 }
 list(input:ApplicationActivityQuery={}):ApplicationActivityPage {
  const args=applicationActivityQuerySchema.parse(input),filter=digest(canonicalJson({appId:args.appId??null,connectionId:args.connectionId??null,projectId:args.projectId??null}));
  let cursor:z.infer<typeof cursorSchema>|null=null;
  if(args.cursor)try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(args.cursor,'base64url').toString('utf8')));if(cursor.filter!==filter)throw new Error();}catch{throw new ApplicationError('INVALID_INPUT','调用记录游标不属于当前筛选条件');}
  const clauses:string[]=[],bindings:(string|number)[]=[];
  if(args.appId){clauses.push('l.app_id=?');bindings.push(args.appId);}
  if(args.projectId){clauses.push('l.project_id=?');bindings.push(args.projectId);}
  if(args.connectionId){
   const scope=(args.appId?' AND o.app_id=?':'')+(args.projectId?' AND o.project_id=?':'');
   const unsafe=this.store.sqlite.prepare(`SELECT 1 FROM application_data_operations o WHERE (NOT json_valid(o.targets_json) OR json_type(CASE WHEN json_valid(o.targets_json) THEN o.targets_json ELSE 'null' END)!='array' OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(o.targets_json) THEN o.targets_json ELSE '[]' END) t WHERE t.type!='object' OR COALESCE(json_type(CASE WHEN t.type='object' THEN t.value ELSE '{}' END,'$.id'),'null')!='text')) ${scope} LIMIT 1`).get(...[...(args.appId?[args.appId]:[]),...(args.projectId?[args.projectId]:[])]);
   if(unsafe)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','部分原来源记录损坏，不能确认连接筛选已完整');
  }
  if(args.connectionId){clauses.push(`(l.connection_id=? OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(l.targets_json) THEN l.targets_json ELSE '[]' END) t WHERE json_extract(CASE WHEN t.type='object' THEN t.value ELSE '{}' END,'$.id')=?) OR EXISTS(SELECT 1 FROM json_each(l.subjects_json) t WHERE json_extract(t.value,'$.kind')='connection' AND json_extract(t.value,'$.id')=?))`);bindings.push(args.connectionId,args.connectionId,args.connectionId);}
  if(cursor){clauses.push('(l.started_at<? OR (l.started_at=? AND l.key<?))');bindings.push(cursor.at,cursor.at,cursor.key);}
  const rows=this.store.sqlite.prepare(`WITH ledger AS (${ledger}) SELECT * FROM ledger l ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY l.started_at DESC,l.key DESC LIMIT ?`).all(...bindings,args.limit+1) as Row[];
  const page=rows.slice(0,args.limit),last=page.at(-1);
  return{items:page.map(row=>this.item(row)),nextCursor:rows.length>args.limit&&last?Buffer.from(canonicalJson({schema:1,filter,at:last.started_at,key:last.key})).toString('base64url'):null,checkedAt:new Date().toISOString()};
 }
 detail(kind:'operation'|'send',value:string):ApplicationActivityDetail {
  z.enum(['operation','send']).parse(kind);id.parse(value);
  const row=this.store.sqlite.prepare(`WITH ledger AS (${ledger}) SELECT * FROM ledger WHERE key=?`).get(kind+':'+value) as Row|undefined;
  if(!row)throw new ApplicationError('NOT_FOUND','本机没有这条调用记录');const item=this.item(row);
  if(kind!=='send'){
   const provenance=item.appId==='mail'&&item.projectId&&item.state==='succeeded'?this.store.sqlite.prepare("SELECT provenance_json FROM application_mail_operation_sources WHERE operation_id=? AND operation_kind IN ('read','resource')").get(item.id) as {provenance_json:string}|undefined:undefined;
   if(provenance){const raw=stored(provenance.provenance_json,z.object({reference:z.unknown(),queryDays:z.unknown().optional()}).passthrough()),source=mailAttachmentSourceSchema.safeParse({reference:raw.reference,...(raw.queryDays===undefined?{}:{queryDays:raw.queryDays})});if(!source.success)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原邮件附件来源记录损坏，未替换为当前邮件');return{item,send:null,mailAttachmentSource:source.data};}
   return{item,send:null};
  }
  const data=this.store.sqlite.prepare('SELECT review_json,review_hash,draft_id,draft_revision,message_id FROM mail_send_intents WHERE id=?').get(value) as {review_json:string|null;review_hash:string|null;draft_id:string;draft_revision:number;message_id:string};
  const execution=item.send?.executionId?this.store.sqlite.prepare('SELECT result_json FROM mail_send_executions WHERE id=? AND intent_id=?').get(item.send.executionId,value) as {result_json:string|null}|undefined:undefined;
  let review:Record<string,unknown>|null=null;
  if(data.review_json){try{review=JSON.parse(data.review_json);if(!review||digest(canonicalJson(review))!==data.review_hash||review.intentId!==value||review.projectId!==item.projectId||review.draftId!==data.draft_id||review.draftRevision!==data.draft_revision)throw new Error();}catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发送审阅修订缺失或损坏，未改用当前草稿');}}
  const result=execution?.result_json?stored(execution.result_json,resultSchema):null;if(result&&result.state!==item.state||item.send?.executionId&&['server-accepted','failed','unknown'].includes(item.state)&&!result)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发送结果与执行阶段不一致，未判断为成功');
  return{item,send:{messageId:data.message_id,fromAddress:review?stored(JSON.stringify(review.fromAddress),z.email().max(512)):null,draftRevision:data.draft_revision,content:review?stored(JSON.stringify(review.content),draftContentSchema):null,attachments:review?stored(JSON.stringify(review.attachments),attachmentSchema):[],result,priorUnknownExecutionIds:review?stored(JSON.stringify(review.priorUnknownExecutionIds),z.array(id).max(100)):[]}};
 }
}
