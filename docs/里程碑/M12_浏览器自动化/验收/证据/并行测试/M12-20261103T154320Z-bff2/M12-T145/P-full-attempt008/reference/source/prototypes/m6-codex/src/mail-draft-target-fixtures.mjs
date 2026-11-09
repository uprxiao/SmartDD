// Fixed public P07 target scenarios,never user input.512 is the saved-draft contract,not SMTP validation.
const longAddress=(role,index)=>{const prefix=role+'-'+String(index).padStart(3,'0')+'-',suffix=' <'+role+'-'+index+'@example.invalid>';return prefix+'x'.repeat(512-prefix.length-suffix.length)+suffix;};
const body='固定合成目标摘要。只读查看，不连接账号，不准备或发送邮件。';
export const DRAFT_TARGET_FIXTURES=Object.freeze([
 {id:'m10-review-targets',baseFixture:'m10-review',title:'多收件与非空抄密送',to:['Alice QA <alice@example.invalid>','bob@example.invalid'],cc:['cc-a@example.invalid','cc-b@example.invalid'],bcc:['bcc-a@example.invalid','bcc-b@example.invalid'],subject:'RS 多目标与抄密送 · 固定合成',body},
 {id:'m10-review-targets-long',baseFixture:'m10-review-long',title:'草稿契约上限',to:Array.from({length:100},(_,i)=>longAddress('to',i)),cc:Array.from({length:100},(_,i)=>longAddress('cc',i)),bcc:Array.from({length:100},(_,i)=>longAddress('bcc',i)),subject:'RS 契约边界主题 '.padEnd(2000,'s'),body},
 {id:'m10-review-targets-empty',baseFixture:'m10-review',title:'空目标与空主题',to:[],cc:[],bcc:[],subject:'',body},
].map(f=>Object.freeze({...f,to:Object.freeze(f.to),cc:Object.freeze(f.cc),bcc:Object.freeze(f.bcc)})));
export const draftTargetFixture=id=>DRAFT_TARGET_FIXTURES.find(f=>f.id===id);
export function draftTargetContent(id){const f=draftTargetFixture(id);if(!f)throw Error('Unknown fixed draft target scenario');return{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[...f.to],cc:[...f.cc],bcc:[...f.bcc],subject:f.subject,text:f.body,html:null,inReplyTo:null,references:[],attachmentIds:[]};}
