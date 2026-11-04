import {ApplicationError} from '@shared/applications';
import {browserCommandAuditSchema,type BrowserCommandAudit,type BrowserActivityDetails} from '@shared/browser-audit';
import type {BrowserOperations,BrowserOperation} from './operations';
import {browserHeaderValues} from './headers';

const REDACTED='已脱敏';
function marker(value:unknown){
  if(value&&typeof value==='object'&&'redacted'in value&&value.redacted===REDACTED&&'length'in value&&typeof value.length==='number'&&Number.isSafeInteger(value.length)&&value.length>=0)return{redacted:REDACTED,length:value.length,...('omitted'in value&&value.omitted===true?{omitted:true}:{})};
  return null;
}
const mask=(value:unknown)=>marker(value)??({redacted:REDACTED,length:typeof value==='string'?Array.from(value).length:JSON.stringify(value??null).length});
const sensitiveHeader=(key:string)=>/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i.test(key);
/** A detached, bounded JSON projection. Error messages are never arguments or
 * results in this journal. Uninspectable fill/exec input is masked initially. */
export function browserAuditValue(command:string,value:unknown,side:'arguments'|'result'):BrowserCommandAudit['arguments']{
  const secretValue=command==='cookie set'||command==='cookie get'||command.startsWith('storage ')||command==='fill'||command==='exec';
  const walk=(item:unknown,key='',depth=0):unknown=>{
    const previous=marker(item);if(previous)return previous;
    if(command==='set headers'&&key==='headers'&&typeof item==='string'){
      try{return walk(browserHeaderValues(item),key,depth+1);}catch{return mask(item);}
    }
    if(/headers$/i.test(key)&&item&&typeof item==='object'){
      // Header dictionaries and HAR-style name/value lists may also be returned
      // by network commands. Custom authentication header names are arbitrary;
      // retain names and lengths, rather than guessing which values are secrets.
      if((Array.isArray(item)?item.length:Object.keys(item).length)>100)return{...mask(item),omitted:true};
      if(Array.isArray(item))return item.map(header=>header&&typeof header==='object'?'name'in header&&typeof header.name==='string'&&'value'in header?{name:header.name,value:mask(header.value)}:mask(header):mask(header));
      return Object.fromEntries(Object.entries(item).map(([name,value])=>[name,mask(value)]));
    }
    if((secretValue&&key==='value')||command==='set credentials'&&/^(pass|password)$/i.test(key)||sensitiveHeader(key)||command==='exec'&&side==='arguments'&&key==='command')return mask(item);
    if(item===null||typeof item==='boolean'||typeof item==='number')return typeof item==='number'&&!Number.isFinite(item)?String(item):item;
    if(typeof item==='string')return command==='exec'&&side==='result'?mask(item):item.length<=1000?item:{omitted:true,length:Array.from(item).length};
    if(depth>=7)return{omitted:true};
    if(Array.isArray(item))return item.length<=100?item.map(v=>walk(v,'',depth+1)):{omitted:true,length:item.length};
    if(item&&typeof item==='object'){
      const entries=Object.entries(item);if(entries.length>100)return{omitted:true,fields:entries.length};
      return Object.fromEntries(entries.map(([name,v])=>[name,walk(v,name,depth+1)]));
    }
    return null;
  };
  const result=walk(value),json=JSON.stringify(result);
  // Keep the surrounding source/page/authorization metadata even for large
  // snapshots. Never replace the entire audit with a truncated secret payload.
  return JSON.parse(Buffer.byteLength(json)<=12000?json:JSON.stringify({omitted:true,length:Array.from(json).length}));
}

/** Trust the metadata envelope only for the host-owned audit namespace. Native
 * command results cannot claim to be a host audit by returning the same schema. */
export function protectBrowserSummary(command:string,summary:unknown,auditRecord=false):unknown{
  if(!auditRecord)return browserAuditValue(command,summary,'result');
  const parsed=browserCommandAuditSchema.safeParse(summary);if(!parsed.success)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原浏览器审计字段缺失或损坏');
  return{...parsed.data,arguments:browserAuditValue(command,parsed.data.arguments,'arguments'),result:browserAuditValue(command,parsed.data.result,'result')};
}

export class BrowserAudit {
  constructor(private readonly operations:BrowserOperations){}
  start(scope:{runId:string;requestId:string;taskId:string;projectId:string},command:string,args:Record<string,unknown>,read:boolean){
    const key='audit:'+scope.requestId,record=this.operations.begin(scope.runId,key,scope.taskId,null,command);
    let summary:BrowserCommandAudit={schema:'browser-audit-v1',actor:'agent',projectId:scope.projectId,targetTaskId:typeof args.task==='string'?args.task:scope.taskId,semantics:read?'read':'write',arguments:browserAuditValue(command,args,'arguments'),result:null,authorization:null,authorizations:[],passwordFill:null};
    const save=(state:BrowserOperation['state'],effect:string,code?:string)=>{if(!record.replay)this.operations.update(scope.runId,key,state,effect,{summary,code});};
    save('running',read?'read-only':'not-started');
    return{
      page:(pageId:string)=>{if(!record.replay)this.operations.page(scope.runId,key,pageId);},
      grant:(grant:NonNullable<BrowserCommandAudit['authorization']>,targetTaskId=summary.targetTaskId)=>{summary={...summary,authorization:{...grant},authorizations:[...summary.authorizations.filter(item=>item.grantId!==grant.grantId),{...grant,targetTaskId}]};save('running',read?'read-only':'not-started');},
      passwordFill:(value:boolean)=>{summary={...summary,passwordFill:value};save('running','not-started');},
      pending:(value:unknown)=>{summary={...summary,result:browserAuditValue(command,value,'result')};save('running','unknown');},
      success:(value:unknown)=>{summary={...summary,result:browserAuditValue(command,value,'result')};save('succeeded',read?'read-only':'completed');},
      failure:(error:unknown,dispatched:boolean)=>save(dispatched&&!read?'unknown':'failed',read?'read-only':dispatched?'unknown':'not-started',error instanceof ApplicationError?error.code:'BROWSER_ERROR'),
    };
  }
}
export function browserActivityDetails(row:BrowserOperation):BrowserActivityDetails{
  let summary:unknown=null;try{summary=row.summary===null?null:JSON.parse(row.summary);}catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原浏览器审计摘要损坏，未替换为当前结果');}
  if(row.request_id.startsWith('audit:'))summary=protectBrowserSummary(row.command,summary,true);
  const parsed=row.request_id.startsWith('audit:')?browserCommandAuditSchema.safeParse(summary):null;
  if(parsed?.success)return{command:row.command,pageId:row.page_id,targetTaskId:parsed.data.targetTaskId,durationMs:Math.max(0,row.updated_at-row.created_at),arguments:parsed.data.arguments,result:parsed.data.result,authorization:parsed.data.authorization,authorizations:parsed.data.authorizations,passwordFill:parsed.data.passwordFill};
  // Legacy write receipts and trusted UI events have no argument history. A
  // reader still projects their results through the current redaction policy.
  return{command:row.command,pageId:row.page_id,targetTaskId:row.task_id,durationMs:Math.max(0,row.updated_at-row.created_at),arguments:null,result:browserAuditValue(row.command,summary,'result'),authorization:null,passwordFill:null};
}
