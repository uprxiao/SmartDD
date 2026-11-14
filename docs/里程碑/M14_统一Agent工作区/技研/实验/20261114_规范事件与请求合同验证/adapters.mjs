import { Spec } from './contract.mjs';

const diagnostic=(code,detail,blocking=false)=>({type:'diagnostic',code,detail,blocking});
export function claudeNormalizer(acceptedInputIds,nativeSessionId){
 const tools=new Map();
 return raw=>{
  if(raw.session_id!==undefined&&raw.session_id!==nativeSessionId)throw new Error('NATIVE_SCOPE_MISMATCH');
  if(raw.type==='assistant')return raw.message.content.flatMap((b,i)=>{
   if(b.type==='text')return [{type:'message.snapshot',itemId:raw.message.id+':'+i,revision:1,role:'assistant',text:b.text,status:'completed'}];
   if(b.type==='tool_use'){tools.set(b.id,b);return [{type:'tool.snapshot',itemId:b.id,revision:1,name:b.name,status:'running',arguments:b.input,result:null}];}
   return [diagnostic('unmapped.claude.block',b.type)];
  });
  if(raw.type==='user')return (Array.isArray(raw.message.content)?raw.message.content:[]).filter(x=>x.type==='tool_result').map(b=>{
   const call=tools.get(b.tool_use_id);if(!call)return diagnostic('unknown.tool.result',b.tool_use_id,true);
   return {type:'tool.snapshot',itemId:b.tool_use_id,revision:2,name:call.name,status:b.is_error?'failed':'completed',arguments:call.input,result:b.content};
  });
  if(raw.type==='result')return acceptedInputIds.includes(raw.user_message_uuid)?[
   {type:'turn.terminal',turnId:raw.user_message_uuid,status:raw.is_error?'failed':'completed'},
  ]:[diagnostic('uncorrelated.result','No accepted outbound input identity; not a task terminal',true)];
  return [diagnostic('unmapped.claude.frame',String(raw.type))];
 };
}
export function codexNormalizer(acceptedTurnIds,nativeThreadId){return raw=>{
 const p=raw.params||{};
 if(p.threadId!==undefined&&p.threadId!==nativeThreadId)throw new Error('NATIVE_SCOPE_MISMATCH');
 if(raw.method==='item/started'||raw.method==='item/completed'){
  const i=p.item,done=raw.method==='item/completed';
  if(i.type==='agentMessage')return [{type:'message.snapshot',itemId:i.id,revision:done?2:1,role:'assistant',text:i.text,status:done?'completed':'streaming'}];
  if(i.type==='mcpToolCall')return [{type:'tool.snapshot',itemId:i.id,revision:done?2:1,name:i.server+'/'+i.tool,status:done?(i.error?'failed':'completed'):'running',arguments:i.arguments,result:i.result}];
  return [diagnostic('unmapped.codex.item',i.type)];
 }
 if(raw.method==='turn/completed')return acceptedTurnIds.includes(p.turn.id)?[
  {type:'turn.terminal',turnId:p.turn.id,status:p.turn.status==='completed'?'completed':p.turn.status==='interrupted'?'cancelled':'failed'},
 ]:[diagnostic('uncorrelated.result','No accepted turn identity',true)];
 return [diagnostic('unmapped.codex.frame',String(raw.method||'rpc.response'))];
};}
export function fixtureNormalizer(raw){
 if(raw.op==='text')return [{type:'message.snapshot',itemId:raw.key,revision:raw.version,role:'assistant',text:raw.body,status:raw.done?'completed':'streaming'}];
 if(raw.op==='tool')return [{type:'tool.snapshot',itemId:raw.key,revision:raw.version,name:raw.name,status:raw.done?'completed':'running',arguments:raw.input,result:raw.output??null}];
 if(raw.op==='end')return [{type:'turn.terminal',turnId:raw.key,status:'completed'}];
 return [diagnostic('unmapped.fixture.frame',String(raw.op),true)];
}

export function codexApproval(p){
 const decisions=p.availableDecisions??['accept','decline','cancel'];
 const safe=p.kind==='humanCommand'?decisions.filter(x=>['accept','decline','cancel'].includes(x)):decisions;
 const valid=new Set(['accept','acceptForSession','decline','cancel']);
 const actionMap=new Map();
 const actions=safe.map((d,i)=>{
  if(typeof d==='string'&&!valid.has(d)||typeof d!=='string'&&(!d||Object.keys(d).length!==1||!('acceptWithExecpolicyAmendment'in d||'applyNetworkPolicyAmendment'in d)))throw new Error('UNSUPPORTED_NATIVE_DECISION');
  const id='option-'+i;actionMap.set(id,structuredClone(d));
  return {id,label:typeof d==='string'?d:Object.keys(d)[0],scope:typeof d==='object'?'persistent':d==='acceptForSession'?'session':'once',...(typeof d==='object'?{detail:d}:{})};
 });
 return {spec:Spec.parse({kind:'approval',message:p.reason||p.command||'Command approval',review:{tool:'command',detail:{command:p.command??null,cwd:p.cwd??null,additionalPermissions:p.additionalPermissions??null}},actions}),encode:r=>({decision:actionMap.get(r.actionId)})};
}
export function claudeApproval(tool,input){
 return {spec:Spec.parse({kind:'approval',message:tool,review:{tool,detail:structuredClone(input)},actions:[{id:'allow-once',label:'Allow this call',scope:'once'},{id:'deny',label:'Deny',scope:'once'}]}),
  encode:r=>r.actionId==='allow-once'?{behavior:'allow',updatedInput:structuredClone(input)}:{behavior:'deny',message:'Denied by user'}};
}
export function codexQuestions(p){
 return {blocking:p.isBlocking,spec:Spec.parse({kind:'questions',message:'Agent questions',questions:p.questions.map(q=>({id:q.id,prompt:q.question,secret:q.isSecret??false,allowCustom:q.isOther===true||!q.options?.length,options:(q.options||[]).map(o=>({label:o.label,description:o.description}))}))}),
  encode:r=>({answers:Object.fromEntries(Object.entries(r.answers).map(([id,answers])=>[id,{answers}]))})};
}
export function elicitation(p){
 if(p.mode==='url')return {spec:Spec.parse({kind:'url',message:p.message,url:p.url,elicitationId:p.elicitationId}),encode:r=>({action:r.action})};
 const unsupported=()=>({spec:Spec.parse({kind:'unsupported',message:'This form requires an unsupported schema or native mode',nativeKind:p.mode||'unknown'}),encode:()=>{throw new Error('UNSUPPORTED_FORM');}});
 if(p.mode!=='form')return unsupported();
 const s=p.requestedSchema;
 if(s.type!=='object'||!s.properties||Object.keys(s).some(k=>!['type','properties','required','$schema'].includes(k)))return unsupported();
 const required=s.required??[];
 if(!Array.isArray(required)||required.some(k=>!(k in s.properties)))return unsupported();
 const fields=[];
 for(const [id,f] of Object.entries(s.properties)){
  const known=['type','title','description','minimum','maximum','minLength','maxLength','enum'];
  if(!['string','number','integer','boolean'].includes(f.type)||Object.keys(f).some(k=>!known.includes(k)))return unsupported();
  const field={id,label:f.title||id,type:f.type,required:required.includes(id)};
  for(const k of ['minimum','maximum','minLength','maxLength'])if(f[k]!=null)field[k]=f[k];
  if(f.enum){if(f.type!=='string'||!Array.isArray(f.enum)||f.enum.some(v=>typeof v!=='string'))return unsupported();field.choices=f.enum;}
  fields.push(field);
 }
 return {spec:Spec.parse({kind:'form',message:p.message,fields}),encode:r=>({action:r.action,...(r.action==='accept'?{content:r.values}:{})})};
}
