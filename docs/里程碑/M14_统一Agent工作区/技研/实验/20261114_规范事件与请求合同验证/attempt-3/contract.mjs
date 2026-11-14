import { z } from '/private/tmp/willyou-m14-owner-probe/node_modules/zod/index.js';
import Database from '/private/tmp/willyou-m14-owner-probe/node_modules/better-sqlite3/lib/index.js';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = z.string().min(1).max(512);
const label = z.string().min(1).max(4096);
const Scope = z.strictObject({taskId:id,bindingId:id,runId:id,generation:z.number().int().positive()});
const option = z.strictObject({id,label,scope:z.enum(['once','session','persistent']),detail:z.json().optional()});
const question = z.strictObject({id,prompt:label,secret:z.boolean(),allowCustom:z.boolean(),options:z.array(z.strictObject({label,description:z.string()}))});
const field = z.strictObject({id,label,required:z.boolean(),type:z.enum(['string','number','integer','boolean']),
  minimum:z.number().finite().optional(),maximum:z.number().finite().optional(),
  minLength:z.number().int().nonnegative().optional(),maxLength:z.number().int().nonnegative().optional(),
  choices:z.array(z.string()).optional()});
export const Spec = z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('approval'),message:label,actions:z.array(option).min(1)}),
 z.strictObject({kind:z.literal('questions'),message:label,questions:z.array(question).min(1)}),
 z.strictObject({kind:z.literal('form'),message:label,fields:z.array(field)}),
 z.strictObject({kind:z.literal('url'),message:label,url:z.url().refine(s=>['https:','http:'].includes(new URL(s).protocol)),elicitationId:id}),
 z.strictObject({kind:z.literal('unsupported'),message:label,nativeKind:id}),
]).superRefine((s,c)=>{
 const keys=(s.actions||s.questions||s.fields||[]).map(x=>x.id);
 if(new Set(keys).size!==keys.length)c.addIssue({code:'custom',message:'duplicate field/action id'});
});
export const Request = z.strictObject({protocol:z.literal(1),...Scope.shape,requestId:id,revision:z.number().int().positive(),
 turnId:id.nullable(),blocking:z.boolean(),source:z.literal('runtime'),spec:Spec,state:z.enum(['pending','dispatching','resolved','expired','unknown']),
 responseMode:z.literal('live'),nativeKey:id});
const Response = z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('approval'),actionId:id}),
 z.strictObject({kind:z.literal('questions'),answers:z.record(id,z.array(z.string()))}),
 z.strictObject({kind:z.literal('form'),action:z.enum(['accept','decline','cancel']),values:z.record(id,z.union([z.string(),z.number().finite(),z.boolean()])).optional()}),
 z.strictObject({kind:z.literal('url'),action:z.enum(['decline','cancel'])}),
]);
export const Event = z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('message.snapshot'),itemId:id,revision:z.number().int().positive(),role:z.literal('assistant'),text:z.string(),status:z.enum(['streaming','completed'])}),
 z.strictObject({type:z.literal('tool.snapshot'),itemId:id,revision:z.number().int().positive(),name:id,status:z.enum(['running','completed','failed']),arguments:z.json(),result:z.json().nullable()}),
 z.strictObject({type:z.literal('turn.terminal'),turnId:id,status:z.enum(['completed','cancelled','failed'])}),
 z.strictObject({type:z.literal('request.snapshot'),request:Request}),
 z.strictObject({type:z.literal('diagnostic'),code:id,detail:z.string(),blocking:z.boolean()}),
]);
const capability = z.strictObject({state:z.enum(['supported','unsupported','unverified','unavailable']),reason:z.string()});

function validateResponse(spec,value){
 const r=Response.parse(value);
 if(spec.kind!==r.kind)throw new Error('REQUEST_KIND_MISMATCH');
 if(r.kind==='approval'&&!spec.actions.some(a=>a.id===r.actionId))throw new Error('ACTION_NOT_OFFERED');
 if(r.kind==='questions'){
  if(Object.keys(r.answers).length!==spec.questions.length)throw new Error('QUESTION_SET_MISMATCH');
  for(const q of spec.questions){
   const a=r.answers[q.id];
   if(!a||a.length!==1||(!q.allowCustom&&!q.options.some(o=>o.label===a[0])))throw new Error('INVALID_ANSWER');
  }
 }
 if(r.kind==='form'){
  if(r.action!=='accept'){if(r.values!==undefined)throw new Error('CONTENT_ON_DECLINE');return r;}
  if(!r.values)throw new Error('FORM_VALUES_REQUIRED');
  if(Object.keys(r.values).some(k=>!spec.fields.some(f=>f.id===k)))throw new Error('UNKNOWN_FIELD');
  for(const f of spec.fields){
   const v=r.values[f.id];if(v===undefined){if(f.required)throw new Error('MISSING_FIELD');continue;}
   if(typeof v!==(f.type==='integer'?'number':f.type)||(f.type==='integer'&&!Number.isInteger(v)))throw new Error('FIELD_TYPE');
   if(typeof v==='number'&&(f.minimum!==undefined&&v<f.minimum||f.maximum!==undefined&&v>f.maximum))throw new Error('FIELD_RANGE');
   if(typeof v==='string'&&(f.minLength!==undefined&&[...v].length<f.minLength||f.maxLength!==undefined&&[...v].length>f.maxLength||f.choices&&!f.choices.includes(v)))throw new Error('FIELD_RANGE');
  }
 }
 return r;
}

export class Registry {
 #drivers=new Map();
 register(d){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(d.id)||this.#drivers.has(d.id)||typeof d.createNormalizer!=='function')throw new Error('INVALID_DRIVER');
  for(const c of Object.values(d.capabilities))capability.parse(c);
  this.#drivers.set(d.id,d);
 }
 get(id){const d=this.#drivers.get(id);if(!d)throw new Error('NO_DRIVER');return d;}
 require(id,name){const c=this.get(id).capabilities[name]??{state:'unverified',reason:'missing declaration'};if(c.state!=='supported')throw new Error('CAPABILITY_'+c.state);return c;}
}

export class Kernel {
 #handles=new WeakMap();#callbacks=new Map();#ui=new WeakSet();
 constructor(file,registry){
  this.registry=registry;this.db=new Database(file);
  this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS events(task TEXT,seq INTEGER,body TEXT,PRIMARY KEY(task,seq));
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY,request_id TEXT,digest TEXT,state TEXT);
    CREATE TABLE IF NOT EXISTS items(task TEXT,identity TEXT,body TEXT,PRIMARY KEY(task,identity));`);
 }
 ui(){const c=Object.freeze({});this.#ui.add(c);return c;}
 attach(driver,scope){Scope.parse(scope);this.registry.require(driver,'requests');const h=Object.freeze({});this.#handles.set(h,{driver,scope:structuredClone(scope),open:true,normalize:this.registry.get(driver).createNormalizer(scope)});return h;}
 owned(h){const o=this.#handles.get(h);if(!o?.open)throw new Error('STALE_OR_FORGED_HANDLE');return o;}
 events(task){return this.db.prepare('SELECT body FROM events WHERE task=? ORDER BY seq').all(task).map(r=>JSON.parse(r.body));}
 #append(scope,event){
  const payload=Event.parse(event);
  const seq=this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM events WHERE task=?').get(scope.taskId).n;
  const envelope={protocol:1,...scope,taskSeq:seq,payload};
  this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(scope.taskId,seq,JSON.stringify(envelope));return envelope;
 }
 ingest(h,raw){
  const {scope,normalize}=this.owned(h);
  const events=normalize(raw);
  return this.db.transaction(()=>events.map(e=>{
   Event.parse(e);
   if(e.type.endsWith('.snapshot')&&e.itemId){
    const key=hash([scope.bindingId,e.itemId]);
    const row=this.db.prepare('SELECT body FROM items WHERE task=? AND identity=?').get(scope.taskId,key);
    if(row){const prior=JSON.parse(row.body);if(e.revision<prior.revision)return null;
     if(e.revision===prior.revision){if(hash(prior)!==hash(e))throw new Error('REVISION_CONFLICT');return null;}
     if(prior.status!=='streaming'&&prior.status!=='running'&&(e.status==='streaming'||e.status==='running'))throw new Error('TERMINAL_REGRESSION');}
    this.db.prepare('INSERT OR REPLACE INTO items VALUES(?,?,?)').run(scope.taskId,key,JSON.stringify(e));
   }
   return this.#append(scope,e);
  }))();
 }
 openRequest(h,{nativeId,nativeNamespace,turnId,blocking=true,spec,encode,send}){
  const {scope}=this.owned(h);Spec.parse(spec);
  id.parse(nativeNamespace);if(typeof encode!=='function'||typeof send!=='function')throw new Error('NO_CALLBACK');
  if(!['string','number'].includes(typeof nativeId)||typeof nativeId==='number'&&!Number.isSafeInteger(nativeId))throw new Error('NATIVE_ID');
  const nativeKey=hash([nativeNamespace,typeof nativeId,nativeId]);
  const requestId=hash([scope,nativeKey]);
  const request=Request.parse({protocol:1,...scope,requestId,revision:1,turnId,blocking,source:'runtime',spec,state:'pending',responseMode:'live',nativeKey});
  const existing=this.db.prepare('SELECT body FROM requests WHERE id=?').get(requestId);
  if(existing){if(hash(JSON.parse(existing.body))!==hash(request))throw new Error('REQUEST_ID_REUSED');return requestId;}
  this.db.transaction(()=>{this.db.prepare('INSERT INTO requests VALUES(?,?)').run(requestId,JSON.stringify(request));this.#append(scope,{type:'request.snapshot',request});})();
  this.#callbacks.set(requestId,{h,encode,send});return requestId;
 }
 get(id){const row=this.db.prepare('SELECT body FROM requests WHERE id=?').get(id);if(!row)throw new Error('NO_REQUEST');return JSON.parse(row.body);}
 #state(id,state){const r=this.get(id);r.state=state;r.revision++;this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(r),id);this.#append(Scope.parse({taskId:r.taskId,bindingId:r.bindingId,runId:r.runId,generation:r.generation}),{type:'request.snapshot',request:r});}
 async respond(actor,{requestId,expected,revision,commandId,value}){
  if(!this.#ui.has(actor))throw new Error('UNTRUSTED_ACTOR');
  const r=this.get(requestId);Scope.parse(expected);
  for(const k of Object.keys(Scope.shape))if(expected[k]!==r[k])throw new Error('WRONG_REQUEST_SCOPE');
  const digest=hash([requestId,expected,revision,value]);
  const receipt=this.db.prepare('SELECT * FROM responses WHERE id=?').get(commandId);
  if(receipt){if(receipt.digest!==digest)throw new Error('IDEMPOTENCY_CONFLICT');return receipt.state;}
  if(r.state!=='pending'||r.revision!==revision)throw new Error('REQUEST_NOT_CURRENT');
  const cb=this.#callbacks.get(requestId);if(!cb)throw new Error('NO_LIVE_CALLBACK');this.owned(cb.h);
  const validated=validateResponse(r.spec,value);const native=cb.encode(validated);
  this.db.transaction(()=>{this.db.prepare('INSERT INTO responses VALUES(?,?,?,?)').run(commandId,requestId,digest,'dispatching');this.#state(requestId,'dispatching');})();
  let state;try{state=await cb.send(native);if(!['applied','not-sent','unknown'].includes(state))state='unknown';}catch{state='unknown';}
  this.db.transaction(()=>{this.db.prepare('UPDATE responses SET state=? WHERE id=?').run(state,commandId);this.#state(requestId,state==='applied'?'resolved':state==='not-sent'?'pending':'unknown');})();
  return state;
 }
 detach(h){this.owned(h).open=false;
  this.db.transaction(()=>{for(const [id,c] of this.#callbacks)if(c.h===h){const r=this.get(id);if(r.state==='pending'||r.state==='dispatching')this.#state(id,r.state==='pending'?'expired':'unknown');this.#callbacks.delete(id);}})();
 }
 completeUrl(h,id,elicitationId){this.owned(h);const cb=this.#callbacks.get(id),r=this.get(id);
  if(cb?.h!==h||r.spec.kind!=='url'||r.spec.elicitationId!==elicitationId||r.state!=='pending')throw new Error('URL_COMPLETION_MISMATCH');
  this.db.transaction(()=>this.#state(id,'resolved'))();
 }
 recover(){this.db.transaction(()=>{for(const row of this.db.prepare('SELECT id,body FROM requests').all()){const r=JSON.parse(row.body);if(r.state==='pending'||r.state==='dispatching')this.#state(row.id,r.state==='pending'?'expired':'unknown');}this.db.prepare("UPDATE responses SET state='unknown' WHERE state='dispatching'").run();}) ();}
 close(){this.db.close();}
}
