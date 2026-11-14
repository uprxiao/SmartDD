import {z} from '/private/tmp/willyou-m14-owner-probe/node_modules/zod/index.js';
import {createHash} from 'node:crypto';
export const Id=z.string().min(1).max(128).regex(/^[^\u0000\r\n]+$/),Hash=z.string().regex(/^[a-f0-9]{64}$/),Revision=z.number().int().positive(),Seq=z.number().int().nonnegative();
export const Scope=z.strictObject({taskId:Id,bindingId:Id,runId:Id,generation:Revision});
export const Target=z.strictObject({profileId:Id,executionRevision:Revision,configSourceHash:Hash,model:Id,capabilityHash:Hash,resourceManifestHash:Hash});
export const Block=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('text'),text:z.string()}),
 z.strictObject({kind:z.literal('reference'),token:Id,revision:Revision,contentHash:Hash}),
 z.strictObject({kind:z.literal('attachment'),token:Id,contentHash:Hash}),
]);
const Blocks=z.array(Block).min(1);
const RuntimeAnswer=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('approval'),optionId:Id}),
 z.strictObject({kind:z.literal('questions'),answers:z.record(Id,z.array(z.string()))}),
 z.strictObject({kind:z.literal('form'),action:z.enum(['accept','decline','cancel']),values:z.record(Id,z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string())])).optional()}),
 z.strictObject({kind:z.literal('url'),action:z.enum(['decline','cancel'])}),
]);
export const Reply=z.discriminatedUnion('source',[
 z.strictObject({source:z.literal('runtime'),value:RuntimeAnswer}),
 z.strictObject({source:z.literal('business'),actionId:Id,reviewHash:Hash,displayReceipt:Id}),
]);
const named=(method,shape)=>z.strictObject({protocol:z.literal(1),method:z.literal(method),commandId:Id,...shape});
export const CommandSchemas={
 'task.create':named('task.create',{projectId:Id,directoryId:Id,target:Target,initialDraft:z.array(Block)}),
 'task.open':named('task.open',{taskId:Id,expectedSelectionRevision:Revision}),
 'task.rename':named('task.rename',{taskId:Id,title:z.string().trim().min(1).max(256)}),
 'task.archive':named('task.archive',{taskId:Id,archived:z.boolean()}),
 'task.delete':named('task.delete',{taskId:Id}),
 'draft.save':named('draft.save',{taskId:Id,expectedDraftRevision:Seq,blocks:z.array(Block)}),
 'input.submit':named('input.submit',{taskId:Id,expectedSelectionRevision:Revision,expectedDraftRevision:Seq,clientInputId:Id,blocks:Blocks}),
 'selection.preview':named('selection.preview',{taskId:Id,expectedSelectionRevision:Revision,target:Target}),
 'selection.apply':named('selection.apply',{taskId:Id,expectedSelectionRevision:Revision,target:Target,previewToken:Id}),
 'request.respond':named('request.respond',{requestId:Id,expectedScope:Scope,requestRevision:Revision,response:Reply}),
 'run.interrupt':named('run.interrupt',{scope:Scope,turnId:Id}),
 'run.close':named('run.close',{scope:Scope}),
 'background.stop':named('background.stop',{scope:Scope,nodeId:Id,expectedRevision:Revision}),
 'delegation.create':named('delegation.create',{target:Target,blocks:Blocks,workspace:z.discriminatedUnion('mode',[z.strictObject({mode:z.literal('shared'),directoryId:Id}),z.strictObject({mode:z.literal('git-worktree'),directoryId:Id,baseRef:Id})])}),
 'delegation.cancel':named('delegation.cancel',{delegationId:Id,scope:z.enum(['turn','subtree'])}),
};
export const Command=z.discriminatedUnion('method',Object.values(CommandSchemas));
const query=(method,shape)=>z.strictObject({protocol:z.literal(1),method:z.literal(method),requestId:Id,...shape});
export const Query=z.discriminatedUnion('method',[
 query('task.snapshot',{taskId:Id}),query('task.history',{taskId:Id,cursor:z.string().max(2048).nullable(),limit:Revision.max(200)}),
 query('task.events',{taskId:Id,databaseId:Id,afterSeq:Seq,throughSeq:Seq}),
 query('delegation.status',{delegationId:Id}),query('driver.catalog',{projectId:Id,directoryId:Id}),query('skill.catalog',{taskId:Id}),
]).superRefine((q,c)=>{if(q.method==='task.events'&&q.throughSeq<q.afterSeq)c.addIssue({code:'custom',message:'REVERSED_RANGE'});});
export const featureNames=['turns','resume','historyInjection','inlineHistory','steer','runtimeRequests','hostTools','nativeProvenance','nativeSubagents','backgroundInspection','backgroundStop','enforcedReadOnly'];
const capability=z.strictObject({state:z.enum(['supported','unsupported','unverified','unavailable']),reason:z.string()}).superRefine((v,c)=>{if(v.state!=='supported'&&!v.reason.trim())c.addIssue({code:'custom',message:'CAPABILITY_REASON_REQUIRED'});});
export const Capabilities=z.strictObject(Object.fromEntries(featureNames.map(n=>[n,capability])));
export const DriverDescription=z.strictObject({driverId:Id,protocol:z.literal(1),configSchemaVersion:Revision,sdkVersion:Id.nullable(),nativeVersion:Id.nullable(),adapterVersion:Id,capabilities:Capabilities});
export const CapabilityPointer=z.strictObject({capabilitySessionId:Id,sourceSnapshotHash:Hash,currentSnapshotHash:Hash});
const InternalInput=z.strictObject({inputId:Id,origin:z.enum(['ui-user','history-transfer','agent-delegation','automatic-followup','child-result']),blocks:Blocks,contentHash:Hash});
const call=(method,shape)=>z.strictObject({protocol:z.literal(1),method:z.literal(method),scope:Scope,...shape});
export const DriverCall=z.discriminatedUnion('method',[
 call('open',{mode:z.enum(['new','resume']),nativeSessionId:Id.nullable(),capability:CapabilityPointer,target:Target,launchReceiptId:Id,launchPlanHash:Hash}),
 call('startTurn',{turnId:Id,capability:CapabilityPointer,target:Target,input:InternalInput}),
 call('injectHistory',{transferId:Id,contentHash:Hash,items:z.array(z.strictObject({sourceTaskId:Id,itemId:Id,revision:Revision})),omissions:z.array(z.strictObject({itemId:Id,reason:Id})),payloadToken:Id}),
 call('steer',{turnId:Id,input:InternalInput}),
 call('respond',{requestId:Id,requestRevision:Revision,value:RuntimeAnswer}),
 call('interrupt',{turnId:Id}),call('closeRun',{}),call('readHistory',{cursor:z.string().max(2048).nullable()}),
 call('inspectBackground',{}),call('stopBackground',{nodeId:Id,expectedRevision:Revision}),
]).superRefine((c,ctx)=>{if(c.method==='open'&&(c.mode==='new'&&c.nativeSessionId!==null||c.mode==='resume'&&c.nativeSessionId===null))ctx.addIssue({code:'custom',message:'NATIVE_OPEN_MODE_MISMATCH'});});
export const DeliveryOutcome=z.discriminatedUnion('state',[
 z.strictObject({state:z.literal('not-sent'),reason:Id}),
 z.strictObject({state:z.literal('unknown'),reason:Id}),
 z.strictObject({state:z.literal('accepted'),evidenceId:Id}),
]);
const TurnState=z.enum(['queued','dispatching','accepted','running','waiting','canceling','completed','cancelled','failed','not-sent','unknown']);
const RunState=z.enum(['preparing','ready','closing','stopped','failed','recovery-required']);
const FieldBase={id:Id,label:z.string(),required:z.boolean()};
const Field=z.discriminatedUnion('type',[
 z.strictObject({...FieldBase,type:z.literal('text'),minLength:Seq.optional(),maxLength:Seq.optional(),secret:z.boolean()}),
 z.strictObject({...FieldBase,type:z.literal('number'),integer:z.boolean(),minimum:z.number().finite().optional(),maximum:z.number().finite().optional()}),
 z.strictObject({...FieldBase,type:z.literal('boolean')}),
 z.strictObject({...FieldBase,type:z.literal('enum'),options:z.array(Id).min(1)}),
 z.strictObject({...FieldBase,type:z.literal('multi-enum'),options:z.array(Id).min(1),minItems:Seq,maxItems:Seq}),
]);
const Question=z.strictObject({id:Id,prompt:z.string(),options:z.array(z.strictObject({id:Id,label:z.string()})),allowCustom:z.boolean(),multiple:z.boolean(),secret:z.boolean()});
export const RequestSpec=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('approval'),message:z.string(),options:z.array(z.strictObject({id:Id,label:z.string(),scope:z.enum(['once','session','persistent'])})).min(1)}),
 z.strictObject({kind:z.literal('questions'),message:z.string(),questions:z.array(Question).min(1)}),
 z.strictObject({kind:z.literal('form'),message:z.string(),fields:z.array(Field)}),
 z.strictObject({kind:z.literal('url'),message:z.string(),url:z.url().refine(x=>['http:','https:'].includes(new URL(x).protocol)),elicitationId:Id}),
 z.strictObject({kind:z.literal('unsupported'),message:z.string(),nativeKind:Id,schemaHash:Hash}),
]).superRefine((s,c)=>{
 const unique=values=>new Set(values).size===values.length;
 const items=s.options??s.questions??s.fields??[];if(!unique(items.map(x=>x.id)))c.addIssue({code:'custom',message:'DUPLICATE_ID'});
 for(const item of items){
  if(item.options&&!unique(item.options.map(x=>typeof x==='string'?x:x.id)))c.addIssue({code:'custom',message:'DUPLICATE_OPTION'});
  if(item.minLength!==undefined&&item.maxLength!==undefined&&item.minLength>item.maxLength||item.minimum!==undefined&&item.maximum!==undefined&&item.minimum>item.maximum||item.minItems!==undefined&&item.minItems>item.maxItems)c.addIssue({code:'custom',message:'REVERSED_FIELD_RANGE'});
 }
});
export const Request=z.strictObject({requestId:Id,scope:Scope,turnId:Id.nullable(),revision:Revision,source:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('runtime'),nativeKey:Id}),z.strictObject({kind:z.literal('business'),serviceId:Id,operationId:Id})]),state:z.enum(['pending','dispatching','resolved','expired','unknown']),blocking:z.boolean(),spec:RequestSpec});
const EventPayload=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('input.queued'),inputId:Id,turnId:Id,bindingId:Id}),
 z.strictObject({type:z.literal('task.record.changed'),recordState:z.enum(['active','retained']),archived:z.boolean()}),
 z.strictObject({type:z.literal('run.state'),state:RunState}),
 z.strictObject({type:z.literal('turn.state'),turnId:Id,state:TurnState}),
 z.strictObject({type:z.literal('request.changed'),request:Request}),
 z.strictObject({type:z.literal('selection.changed'),selectionRevision:Revision,bindingId:Id,target:Target}),
 z.strictObject({type:z.literal('draft.changed'),draftRevision:Seq,blocks:z.array(Block)}),
 z.strictObject({type:z.literal('conversation.upsert'),itemId:Id,ordinal:Revision,revision:Revision,origin:z.enum(['user','assistant','history','child-result','system']),text:z.string(),artifacts:z.array(Id),status:z.enum(['streaming','completed','failed'])}),
 z.strictObject({type:z.literal('conversation.removed'),itemId:Id,revision:Revision}),
 z.strictObject({type:z.literal('file.changed'),referenceToken:Id,revision:Revision}),
 z.strictObject({type:z.literal('model.observed'),turnId:Id.nullable(),model:Id}),
 z.strictObject({type:z.literal('background.changed'),nodeId:Id,parentNodeId:Id.nullable(),revision:Revision,state:z.enum(['running','waiting','completed','cancelled','failed','unknown'])}),
 z.strictObject({type:z.literal('tool.changed'),itemId:Id,revision:Revision,name:Id,state:z.enum(['running','completed','failed','declined']),summary:z.string(),artifacts:z.array(Id)}),
 z.strictObject({type:z.literal('delegation.changed'),delegationId:Id,childTaskId:Id,state:z.enum(['queued','preparing','running','waiting','canceling','completed','cancelled','failed','unknown'])}),
 z.strictObject({type:z.literal('usage.updated'),turnId:Id,status:z.enum(['complete','partial','unavailable']),inputTokens:Seq.optional(),outputTokens:Seq.optional(),models:z.array(Id)}),
 z.strictObject({type:z.literal('diagnostic'),code:Id,message:z.string()}),
]);
export const Event=z.strictObject({protocol:z.literal(1),databaseId:Id,taskId:Id,taskSeq:Revision,occurredAt:z.iso.datetime({offset:true}),scope:Scope.nullable(),payload:EventPayload}).superRefine((e,c)=>{
 if(e.scope&&e.scope.taskId!==e.taskId)c.addIssue({code:'custom',message:'EVENT_TASK_MISMATCH'});
 if(['run.state','turn.state','request.changed','tool.changed','usage.updated','model.observed','background.changed'].includes(e.payload.type)&&!e.scope)c.addIssue({code:'custom',message:'RUN_SCOPE_REQUIRED'});
 if(['selection.changed','draft.changed','input.queued','task.record.changed'].includes(e.payload.type)&&e.scope)c.addIssue({code:'custom',message:'TASK_EVENT_HAS_RUN'});
 if(e.payload.type==='request.changed'&&JSON.stringify(e.scope)!==JSON.stringify(e.payload.request.scope))c.addIssue({code:'custom',message:'REQUEST_SCOPE_MISMATCH'});
 if(e.payload.type==='usage.updated'&&e.payload.status==='complete'&&(e.payload.inputTokens===undefined||e.payload.outputTokens===undefined))c.addIssue({code:'custom',message:'COMPLETE_USAGE_REQUIRES_COUNTS'});
});
export function parseWire(value,{maxBytes}){if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('INVALID_LIMIT');const bytes=Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));if(bytes>maxBytes)throw Error('WIRE_BUDGET');return Command.parse(typeof value==='string'?JSON.parse(value):value);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function validateReply(stored,command){
 const r=Request.parse(stored),c=CommandSchemas['request.respond'].parse(command);
 if(r.requestId!==c.requestId||!same(r.scope,c.expectedScope)||r.revision!==c.requestRevision||r.state!=='pending')throw Error('REQUEST_STALE');
 if(r.source.kind!==c.response.source)throw Error('REQUEST_ROUTE_MISMATCH');
 if(c.response.source==='business')return {route:r.source.serviceId,operationId:r.source.operationId,requiresBusinessVerification:true,response:c.response};
 const v=c.response.value,s=r.spec;if(v.kind!==s.kind)throw Error('REPLY_KIND_MISMATCH');
 if(v.kind==='approval'&&!s.options.some(x=>x.id===v.optionId))throw Error('OPTION_NOT_OFFERED');
 if(v.kind==='questions'){
  if(!same(Object.keys(v.answers).sort(),s.questions.map(q=>q.id).sort()))throw Error('QUESTION_SET_MISMATCH');
  for(const q of s.questions){const ans=v.answers[q.id];if(!ans.length||!q.multiple&&ans.length!==1||new Set(ans).size!==ans.length||!q.allowCustom&&ans.some(x=>!q.options.some(o=>o.id===x)))throw Error('INVALID_ANSWER');}
 }
 if(v.kind==='form'){
  if(v.action!=='accept'){if(v.values!==undefined)throw Error('DECLINE_WITH_VALUES');return {route:'runtime',value:v};}
  if(!v.values||Object.keys(v.values).some(k=>!s.fields.some(f=>f.id===k)))throw Error('FORM_KEYS');
  for(const f of s.fields){const x=v.values[f.id];if(x===undefined){if(f.required)throw Error('REQUIRED_FIELD');continue;}
   let ok=false;
   if(f.type==='text')ok=typeof x==='string'&&(f.minLength===undefined||[...x].length>=f.minLength)&&(f.maxLength===undefined||[...x].length<=f.maxLength);
   if(f.type==='number')ok=typeof x==='number'&&(!f.integer||Number.isInteger(x))&&(f.minimum===undefined||x>=f.minimum)&&(f.maximum===undefined||x<=f.maximum);
   if(f.type==='boolean')ok=typeof x==='boolean';
   if(f.type==='enum')ok=typeof x==='string'&&f.options.includes(x);
   if(f.type==='multi-enum')ok=Array.isArray(x)&&new Set(x).size===x.length&&x.length>=f.minItems&&x.length<=f.maxItems&&x.every(v=>f.options.includes(v));
   if(!ok)throw Error('FIELD_INVALID');
  }
 }
 return {route:'runtime',value:v};
}
export function requireFeature(description,name){const d=DriverDescription.parse(description),v=d.capabilities[name];if(!v||v.state!=='supported')throw Error('CAPABILITY_'+(v?.state??'missing'));return v;}
export function validateRegistration(description,methods){const d=DriverDescription.parse(description);for(const n of ['open','startTurn','closeRun'])if(typeof methods[n]!=='function')throw Error('METHOD_MISSING:'+n);for(const [feature,method] of Object.entries({resume:'resume',historyInjection:'injectHistory',steer:'steer',runtimeRequests:'respond',hostTools:'bindHostTools',nativeProvenance:'observeInput',backgroundInspection:'inspectBackground',backgroundStop:'stopBackground'}))if(d.capabilities[feature].state==='supported'&&typeof methods[method]!=='function')throw Error('METHOD_MISSING:'+method);return d;}
export function chooseHistoryFallback(outcome,description){if(outcome==='unsupported'){requireFeature(description,'inlineHistory');return 'inline';}if(outcome==='accepted')return 'done';if(outcome==='not-sent')return 'explicit-new-attempt-required';return 'hold-unknown';}
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function freezeDeep(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freezeDeep(child);Object.freeze(value);}return value;}
export function freezeSubmission(command,current){const c=CommandSchemas['input.submit'].parse(command);if(c.taskId!==current.taskId||c.expectedSelectionRevision!==current.selectionRevision||c.expectedDraftRevision!==current.draftRevision||current.recordState!=='active')throw Error('STALE_SUBMISSION');return freezeDeep({commandId:c.commandId,inputId:c.clientInputId,taskId:c.taskId,bindingId:current.bindingId,target:structuredClone(Target.parse(current.target)),blocks:structuredClone(c.blocks),origin:'ui-user',requestHash:digest(c)});}
