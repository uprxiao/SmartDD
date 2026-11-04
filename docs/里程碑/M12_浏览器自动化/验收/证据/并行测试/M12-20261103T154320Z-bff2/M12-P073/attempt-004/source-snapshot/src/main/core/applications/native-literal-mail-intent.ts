import {z} from 'zod';
import type {MailSendReview} from '@shared/mail-execution';
import {applicationReferenceText} from '@shared/application-terminal';
import {canonicalJson,digest} from './manifest';
import {nativeMailContextBindings,unchangedNativeMailContext} from './ordered-native-mail-context';
import {resolveMailSendImperative} from './native-mail-intent';

export interface NativeLiteralMailAction {
 schema:'native-mail-literal-v1';draftId:string;revision:number;contentHash:string;
 fieldsHash:string;recipientSetHash:string;sourceReferenceHash:string|null;
}
interface Field {value:string;quoted:boolean}
interface Literal {mode:'new'|'reply'|'reply-all';fields:Map<string,Field>;source:boolean}
const labels:Record<string,string>={收件人:'to',to:'to',抄送:'cc',cc:'cc',密送:'bcc',秘密抄送:'bcc',bcc:'bcc',主题:'subject',subject:'subject',正文:'text',正文内容:'text',内容:'text',body:'text',text:'text',html:'html',附件:'attachments',attachments:'attachments',发件人:'from',from:'from',方式:'mode',类型:'mode',mode:'mode'};
const label=/^(收件人|秘密抄送|正文内容|抄送|密送|主题|正文|内容|附件|发件人|方式|类型|attachments|subject|body|text|html|from|mode|to|cc|bcc)\s*(?:[:：]|是|为)\s*/iu;
const nextLabel=/(?:\r?\n|[，,；;])\s*(?=(?:收件人|秘密抄送|正文内容|抄送|密送|主题|正文|内容|附件|发件人|方式|类型|attachments|subject|body|text|html|from|mode|to|cc|bcc)\s*(?:[:：]|是|为))/iu;
const canonicalLines=(value:string)=>value.replace(/\r\n?/gu,'\n');
const control=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
const rawAmbiguity=/(?:不要(?:发|寄|送)|先别|暂不|取消(?:发|寄|送)|如果|是否|要不要|不确定|先检查|明天(?:再)?发|\b(?:if|unless|don't|do not|cancel|whether|tomorrow|later)\b)/iu;
function quoted(text:string):{value:string;length:number}|null{
 if(text.startsWith('"')){
  let escaped=false;
  for(let i=1;i<text.length;i++){
   if(!escaped&&text[i]==='"'){try{const value:unknown=JSON.parse(text.slice(0,i+1));return typeof value==='string'?{value,length:i+1}:null;}catch{return null;}}
   if(!escaped&&text[i]==='\\')escaped=true;else escaped=false;
  }
  return null;
 }
 const close:Record<string,string>={'“':'”','「':'」','『':'』'};const end=close[text[0]];
 if(end){let depth=1;for(let i=1;i<text.length;i++){if(text[i]===text[0])depth++;else if(text[i]===end&&--depth===0)return{value:text.slice(1,i),length:i+1};}return null;}
 if(text.startsWith('```')){const begin=/^```(?:text|plain|html)?\r?\n/u.exec(text);if(!begin)return null;const end=text.indexOf('\n```',begin[0].length);return end<0?null:{value:text.slice(begin[0].length,end),length:end+4};}
 return null;
}
function parseFields(text:string,initial:Map<string,Field>):Map<string,Field>|null{
 const fields=new Map(initial);let rest=text;
 for(let count=0;count<32;count++){
  rest=rest.replace(/^[\s,，;；。.!！]+/u,'');if(!rest)return fields;
  const head=label.exec(rest);if(!head)return null;const key=labels[head[1].toLowerCase()];rest=rest.slice(head[0].length);
  let value:Field;const marked=/^(?:["“「『]|```)/u.test(rest);
  if(marked){const part=quoted(rest);if(!part)return null;value={value:part.value,quoted:true};rest=rest.slice(part.length);}
  else{const separator=nextLabel.exec(rest);const raw=(separator?rest.slice(0,separator.index):rest).trim();if(control.test(raw)||/[\r\n]/u.test(raw)||key==='text'&&rawAmbiguity.test(raw))return null;value={value:raw.replace(/[。.!！]+$/u,key==='text'||key==='subject'||key==='html'?'$&':''),quoted:false};rest=separator?rest.slice(separator.index):'';}
  if(control.test(value.value))return null;
  const previous=fields.get(key);if(previous&&previous.value!==value.value)return null;fields.set(key,value);
 }
 return null;
}
function parse(text:string,review:MailSendReview,allowFieldsOnly=false):Literal|null{
 let rest=text.trim(),source=false;const ref=review.content.sourceMessageRef;
 if(ref){const prefix=applicationReferenceText({kind:'mail',reference:ref});if(rest.startsWith(prefix)){source=true;rest=rest.slice(prefix.length).trim();}}
 const fields=new Map<string,Field>();let mode:Literal['mode']='new';
 const polite='(?:请帮我|请|帮我|麻烦你|麻烦)?(?:现在|立即|直接)?';
 let found:RegExpExecArray|null;
 if((found=new RegExp('^'+polite+'(?:给|向)(.+?)(?:发(?:送)?|寄(?:送)?)(?:一封)?邮件','u').exec(rest))){fields.set('to',{value:found[1].trim(),quoted:false});rest=rest.slice(found[0].length);}
 else if((found=new RegExp('^'+polite+'(?:回复全部|回复所有人)(?:这封|该)?(?:邮件)?','u').exec(rest))){mode='reply-all';rest=rest.slice(found[0].length);}
 else if((found=new RegExp('^'+polite+'回复(?:这封|该)?(?:邮件)?','u').exec(rest))){mode='reply';rest=rest.slice(found[0].length);}
 else if((found=new RegExp('^'+polite+'(?:发送|发出|寄出)(?:这封|这份|该|一封)?邮件','u').exec(rest))){rest=rest.slice(found[0].length);}
 else{
  const end=rest.search(/[\n；;，]/u);let head=end<0?rest:rest.slice(0,end);
  const politeQuestion=/^(?:can|could|would) you(?: please)? (.*?)(?:\?)?$/iu.exec(head.trim());if(politeQuestion)head=politeQuestion[1];
  const english=/^(?:please\s+)?(?:send|email|mail)(?:\s+(?:this|the|an?))?(?:\s+(?:email|message))?(?:\s+to\s+(.+?))?[.!]?$/iu.exec(head.trim());
  const reply=/^(?:please\s+)?reply(?:\s+(all|to all))?(?:\s+to\s+(?:this|the)\s+(?:email|message))?[.!]?$/iu.exec(head.trim());
  if(english){if(english[1])fields.set('to',{value:english[1].replace(/[.!]$/u,'').trim(),quoted:false});rest=end<0?'':rest.slice(end);}
  else if(reply){mode=reply[1]?'reply-all':'reply';rest=end<0?'':rest.slice(end);}
  else if(!allowFieldsOnly)return null;
 }
 const parsed=parseFields(rest,fields);if(!parsed)return null;
 const requestedMode=parsed.get('mode')?.value;
 if(requestedMode){const values:Record<string,Literal['mode']>={新邮件:'new',新建:'new',new:'new',回复:'reply',reply:'reply',回复全部:'reply-all','reply-all':'reply-all'};const value=values[requestedMode];if(!value||mode!=='new'&&mode!==value)return null;mode=value;}
 return{mode,fields:parsed,source};
}
function address(value:string):string|null{if(!z.email().max(512).safeParse(value).success)return null;const at=value.lastIndexOf('@');return value.slice(0,at+1)+value.slice(at+1).toLowerCase();}
function recipients(value:string,aliases:ReadonlyMap<string,string>):string[]|null{
 if(!value.trim()||/^(?:无|none)$/iu.test(value.trim()))return[];
 const values=value.split(/[,，、;；]|\s+and\s+|和/iu).map(v=>v.trim()).map(v=>aliases.get(v.replace(/\s+/gu,''))??v).map(address);
 return values.length>100||values.some(v=>v===null)?null:[...new Set(values as string[])].sort();
}
function attachmentNames(field:Field|undefined):string[]|null{
 if(!field||!field.value.trim()||/^(?:无|none)$/iu.test(field.value.trim()))return[];
 const values=field.quoted?[field.value]:field.value.split(/[,，、;；]/u).map(v=>v.trim());
 return values.length>100||values.some(v=>!v||v.length>1024||control.test(v))||new Set(values).size!==values.length?null:values;
}
/** Complete literal target/content interpretation,not authority. The caller must
 * authenticate every used user row,bind current connection/policy and independently
 * resolve named attachment identity before claim and execution. */
export function resolveLiteralMailSend(text:string,previous:readonly string[],review:MailSendReview):{action:NativeLiteralMailAction;start:number}|null{
 if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024||previous.length>63||previous.some(value=>Buffer.byteLength(value)>1024*1024)||previous.reduce((sum,value)=>sum+Buffer.byteLength(value),0)>4*1024*1024||review.priorUnknownExecutionIds.length||control.test(text))return null;
 let start=previous.length,anchor=-1,payload=parse(text,review),contextual=false;
 if(payload&&(!payload.fields.has('to')||!payload.fields.has('text')))payload=null;
 const sourceText=review.content.sourceMessageRef?applicationReferenceText({kind:'mail',reference:review.content.sourceMessageRef}):null;
 if(!payload){
  contextual=true;
  for(let i=previous.length-1;i>=0;i--)if(label.test(previous[i].trim())||parse(previous[i],review)) {anchor=i;break;}
  if(anchor<0)return null;payload=parse(previous[anchor],review,true);if(!payload)return null;start=anchor;
 }
 while(start>0&&(nativeMailContextBindings(previous[start-1])||unchangedNativeMailContext(previous[start-1])||sourceText&&previous[start-1]===sourceText))start--;
 const names=new Map<string,Set<string>>();let source=payload.source;
 for(let i=start;i<previous.length;i++){
  if(i===anchor)continue;
  if(sourceText&&previous[i]===sourceText){source=true;continue;}
  const found=nativeMailContextBindings(previous[i]);
  if(!found&&!unchangedNativeMailContext(previous[i]))return null;
  for(const [name,email]of found??[]){const values=names.get(name)??new Set<string>();values.add(email);names.set(name,values);}
 }
 const aliases=new Map<string,string>();for(const [name,values]of names)if(values.size===1)aliases.set(name,[...values][0]);
 if(contextual&&!resolveMailSendImperative(text,review.content,aliases))return null;
 if(payload.mode!==review.content.mode)return null;
 if(review.content.mode!=='new'&&!source){const expected=review.content.sourceMessageRef&&applicationReferenceText({kind:'mail',reference:review.content.sourceMessageRef});const index=start-1;if(!expected||index<0||previous[index]!==expected)return null;source=true;start=index;}
 if(review.content.mode==='new'&&(source||review.content.sourceMessageRef||review.content.inReplyTo||review.content.references.length))return null;
 const toField=payload.fields.get('to'),textField=payload.fields.get('text');if(!toField||!textField)return null;
 const to=recipients(toField.value,aliases),cc=recipients(payload.fields.get('cc')?.value??'',aliases),bcc=recipients(payload.fields.get('bcc')?.value??'',aliases);
 for(const [actual,expected]of [[to,review.content.to],[cc,review.content.cc],[bcc,review.content.bcc]] as const){const target=expected.map(address);if(!actual||target.some(v=>v===null)||canonicalJson(actual)!==canonicalJson([...new Set(target)].sort()))return null;}
 if((payload.fields.get('subject')?.value??'')!==review.content.subject||canonicalLines(textField.value)!==canonicalLines(review.content.text)||(payload.fields.get('html')?canonicalLines(payload.fields.get('html')!.value):null)!==(review.content.html===null?null:canonicalLines(review.content.html)))return null;
 const from=payload.fields.get('from');if(from&&address(from.value)!==address(review.fromAddress))return null;
 const attachments=attachmentNames(payload.fields.get('attachments'));if(!attachments||canonicalJson(attachments)!==canonicalJson(review.attachments.map(value=>value.filename))||canonicalJson(review.content.attachmentIds)!==canonicalJson(review.attachments.map(value=>value.id)))return null;
 const fieldsHash=digest(canonicalJson({mode:payload.mode,fields:[...payload.fields].map(([key,value])=>[key,value.value])}));
 return{start,action:{schema:'native-mail-literal-v1',draftId:review.draftId,revision:review.draftRevision,contentHash:review.draftContentHash,fieldsHash,recipientSetHash:digest(canonicalJson({to,cc,bcc})),sourceReferenceHash:source?digest(canonicalJson(review.content.sourceMessageRef)):null}};
}
