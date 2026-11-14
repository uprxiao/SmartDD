import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { Kernel,Registry,Spec,Event,hash } from './contract.mjs';
import {claudeNormalizer,codexNormalizer,fixtureNormalizer,codexApproval,claudeApproval,codexQuestions,elicitation} from './adapters.mjs';
const root='/private/tmp/willyou-m14-contract-probe',attempt=mkdtempSync(join(root,'attempt-'));
const claude=JSON.parse(readFileSync(join(root,'claude-frames.json'))),codex=JSON.parse(readFileSync(join(root,'codex-frames.json')));
const cr=claude.find(x=>x.type==='result'),cx=codex.find(x=>x.method==='turn/completed');
const registry=new Registry();
for(const [id,normalize] of [['claude-replay',claudeNormalizer([cr.user_message_uuid])],['codex-replay',codexNormalizer([cx.params.turn.id])],['third-fixture',fixtureNormalizer]])registry.register({id,normalize,capabilities:{requests:{state:'supported',reason:'contract fixture'},historyInject:{state:id==='third-fixture'?'unsupported':'unverified',reason:'no native injection in replay'}}});
const kernel=new Kernel(join(attempt,'contract.sqlite'),registry),ui=kernel.ui();let counter=0;
const fresh=(driver='third-fixture',overrides={})=>{const n=++counter;const scope={taskId:'task-'+n,bindingId:'binding-'+n,runId:'run-'+n,generation:1,...overrides};return{scope,h:kernel.attach(driver,scope)};};
const sent=[];
function open(ctx,descriptor=codexApproval({command:'echo fixture'}),extras={}){
 return kernel.openRequest(ctx.h,{nativeId:++counter,nativeNamespace:'connection:rpc',turnId:'turn-1',...descriptor,send:async p=>{sent.push(p);return'applied';},...extras});
}
const response=(ctx,id,value,more={})=>({requestId:id,expected:ctx.scope,revision:kernel.get(id).revision,commandId:'response-'+(++counter),value,...more});
const tests=[];
async function test(id,title,fn){try{const evidence=await fn();tests.push({id,title,status:'passed',evidence});}catch(e){tests.push({id,title,status:'failed',error:String(e.stack||e)});}console.log(id,tests.at(-1).status);}

await test('K01','Claude real recorded frames normalize into shared SQLite events',()=>{
 const ctx=fresh('claude-replay');for(const r of claude)kernel.ingest(ctx.h,r);
 const events=kernel.events(ctx.scope.taskId),p=events.map(x=>x.payload);
 assert.equal(p.filter(x=>x.type==='message.snapshot').length,1);assert(p.some(x=>x.type==='tool.snapshot'&&x.status==='completed'));
 assert.equal(p.filter(x=>x.type==='turn.terminal').length,1);assert(!p.some(x=>x.role==='user'));
 writeFileSync(join(attempt,'claude-normalized.json'),JSON.stringify(events,null,2));return{inputFrames:claude.length,events:events.length,toolResultNotUserAuthorization:true};
});
await test('K02','Codex real recorded frames use same events and tables',()=>{
 const ctx=fresh('codex-replay');for(const r of codex)kernel.ingest(ctx.h,r);
 const events=kernel.events(ctx.scope.taskId),p=events.map(x=>x.payload);
 assert(p.some(x=>x.type==='message.snapshot'&&x.text==='MOCK_OK ALPHA'));assert(p.some(x=>x.type==='tool.snapshot'&&x.status==='completed'));
 assert.equal(p.filter(x=>x.type==='turn.terminal').length,1);
 writeFileSync(join(attempt,'codex-normalized.json'),JSON.stringify(events,null,2));return{inputFrames:codex.length,events:events.length};
});
await test('K03','Third fixture uses identical kernel with stable partial/final message',()=>{
 const ctx=fresh();for(const r of [{op:'text',key:'m',version:1,body:'par',done:false},{op:'text',key:'m',version:2,body:'partial complete',done:true},{op:'tool',key:'t',version:1,name:'fixture',input:{},done:false},{op:'tool',key:'t',version:2,name:'fixture',input:{},output:{ok:true},done:true},{op:'end',key:'turn'}])kernel.ingest(ctx.h,r);
 const e=kernel.events(ctx.scope.taskId);assert.deepEqual(e.map(x=>x.taskSeq),[1,2,3,4,5]);assert.equal(kernel.db.prepare('SELECT count(*) n FROM items WHERE task=?').get(ctx.scope.taskId).n,2);
 writeFileSync(join(attempt,'third-normalized.json'),JSON.stringify(e,null,2));return{events:5,items:2};
});
await test('K04','Malformed canonical event and unknown critical type cannot silently commit',()=>{
 assert.throws(()=>Event.parse({type:'turn.terminal',turnId:'t',status:'success'}));assert.throws(()=>Event.parse({type:'future.required'}));assert.throws(()=>Event.parse({type:'message.snapshot',itemId:'x',revision:1,role:'assistant',text:'x',status:'completed',nativeCallback:()=>{}}));
});
await test('K05','Duplicate, stale, conflicting and terminal-regression item revisions',()=>{
 const c=fresh(),r={op:'text',key:'m',version:2,body:'final',done:true};kernel.ingest(c.h,r);kernel.ingest(c.h,r);kernel.ingest(c.h,{...r,version:1});assert.equal(kernel.events(c.scope.taskId).length,1);
 assert.throws(()=>kernel.ingest(c.h,{...r,body:'different'}),/REVISION_CONFLICT/);assert.throws(()=>kernel.ingest(c.h,{...r,version:3,done:false}),/TERMINAL_REGRESSION/);assert.equal(kernel.events(c.scope.taskId).length,1);
});
await test('K06','Same native item id under different bindings cannot collide',()=>{
 const a=fresh(),b=fresh('third-fixture',{taskId:a.scope.taskId});for(const c of[a,b])kernel.ingest(c.h,{op:'text',key:'same-id',version:1,body:c.scope.bindingId,done:true});assert.equal(kernel.db.prepare('SELECT count(*) n FROM items WHERE task=?').get(a.scope.taskId).n,2);
});
await test('K07','Uncorrelated zero-turn Claude synthetic result is not turn completion',()=>{
 const c=fresh('claude-replay');kernel.ingest(c.h,{...cr,user_message_uuid:'synthetic-history',num_turns:0});const e=kernel.events(c.scope.taskId);assert.equal(e[0].payload.type,'diagnostic');assert.equal(e[0].payload.blocking,true);
});
await test('K08','Unsupported, unverified, unavailable and missing capability remain distinct',()=>{
 assert.throws(()=>registry.require('third-fixture','historyInject'),/CAPABILITY_unsupported/);assert.throws(()=>registry.require('codex-replay','historyInject'),/CAPABILITY_unverified/);assert.throws(()=>registry.require('third-fixture','missing'),/CAPABILITY_unverified/);
 registry.register({id:'offline-fixture',normalize:fixtureNormalizer,capabilities:{requests:{state:'unavailable',reason:'resource missing'}}});assert.throws(()=>fresh('offline-fixture'),/CAPABILITY_unavailable/);
});
await test('K09','Runtime request belongs to nullable turn and retained nonblocking flag',()=>{
 const c=fresh('codex-replay'),d=codexQuestions({isBlocking:false,questions:[{id:'q',question:'Continue?',options:null}]});const id=open(c,d,{turnId:null});assert.equal(kernel.get(id).turnId,null);assert.equal(kernel.get(id).blocking,false);
});
await test('K10','JSON-RPC numeric and string IDs and callback namespaces are distinct',()=>{
 const c=fresh(),d=codexApproval({command:'fixture'});const a=open(c,d,{nativeId:7}),b=open(c,d,{nativeId:'7'}),e=open(c,d,{nativeId:7,nativeNamespace:'connection:callback'});assert.equal(new Set([a,b,e]).size,3);
});
await test('K11','Approval decisions preserve session scope and structured amendment',async()=>{
 const c=fresh('codex-replay'),amend={acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}},d=codexApproval({command:'git status',availableDecisions:['accept','acceptForSession',amend,'decline','cancel']});
 assert.equal(d.spec.actions[1].scope,'session');assert.equal(d.spec.actions[2].scope,'persistent');assert.deepEqual(d.spec.actions[2].detail,amend);
 const id=open(c,d);await kernel.respond(ui,response(c,id,{kind:'approval',actionId:'option-2'}));assert.deepEqual(sent.at(-1),{decision:amend});
});
await test('K12','Human-only command excludes broad approval choices',()=>{
 const d=codexApproval({command:'managed',kind:'humanCommand',availableDecisions:['accept','acceptForSession','decline','cancel']});assert.deepEqual(d.spec.actions.map(x=>x.label),['accept','decline','cancel']);
});
await test('K13','Claude callback retains updated input outside generic UI response',async()=>{
 const c=fresh('claude-replay'),input={file_path:'/fixture/test.txt',content:'fixture'},id=open(c,claudeApproval('Write',input));await kernel.respond(ui,response(c,id,{kind:'approval',actionId:'allow-once'}));assert.deepEqual(sent.at(-1),{behavior:'allow',updatedInput:input});assert(!JSON.stringify(kernel.get(id)).includes('file_path'));
});
await test('K14','Arbitrary native decision, boolean and unoffered choice rejected before send',async()=>{
 const c=fresh(),id=open(c),n=sent.length;
 for(const value of [true,{kind:'approval',actionId:'invented'},{kind:'approval',actionId:'option-0',decision:'acceptForSession'}])await assert.rejects(kernel.respond(ui,response(c,id,value)));
 assert.equal(sent.length,n);assert.equal(kernel.get(id).state,'pending');
});
await test('K15','Question IDs, option descriptions, secrets and custom answers survive translation',async()=>{
 const c=fresh('codex-replay'),d=codexQuestions({isBlocking:true,questions:[{id:'choice',question:'Pick',options:[{label:'A',description:'Choice A'}]},{id:'secret',question:'Test synthetic secret',isSecret:true,options:null}]});const id=open(c,d),value={kind:'questions',answers:{choice:['A'],secret:['FAKE_SECRET_123']}};
 assert.equal(kernel.get(id).spec.questions[0].options[0].description,'Choice A');assert.equal(kernel.get(id).spec.questions[1].secret,true);
 await kernel.respond(ui,response(c,id,value));assert.deepEqual(sent.at(-1),{answers:{choice:{answers:['A']},secret:{answers:['FAKE_SECRET_123']}}});
 const dump=JSON.stringify(kernel.db.prepare('SELECT * FROM responses').all())+JSON.stringify(kernel.events(c.scope.taskId));assert(!dump.includes('FAKE_SECRET_123'));return{syntheticSecretNotPersisted:true};
});
await test('K16','Missing, extra and invalid question answers cannot reach native callback',async()=>{
 const c=fresh(),id=open(c,codexQuestions({isBlocking:true,questions:[{id:'q',question:'Pick',options:[{label:'A',description:''}],isOther:false}]})),n=sent.length;
 for(const answers of [{},{q:['B']},{q:['A'],extra:['X']}])await assert.rejects(kernel.respond(ui,response(c,id,{kind:'questions',answers})));assert.equal(sent.length,n);
});
const form={mode:'form',message:'Fixture form',requestedSchema:{type:'object',required:['name','count','flag'],properties:{name:{type:'string',minLength:1,maxLength:1},count:{type:'integer',minimum:1,maximum:3},flag:{type:'boolean'}}}};
await test('K17','Structured form preserves types, Unicode length and native response shape',async()=>{
 const c=fresh(),id=open(c,elicitation(form)),values={name:'🙂',count:2,flag:false};await kernel.respond(ui,response(c,id,{kind:'form',action:'accept',values}));assert.deepEqual(sent.at(-1),{action:'accept',content:values});
});
await test('K18','Form required, range, type and unknown field validation',async()=>{
 const c=fresh(),id=open(c,elicitation(form)),n=sent.length;
 for(const values of [{name:'x',count:2},{name:'x',count:9,flag:true},{name:'x',count:1.5,flag:true},{name:'x',count:2,flag:'true'},{name:'x',count:2,flag:true,extra:1}])await assert.rejects(kernel.respond(ui,response(c,id,{kind:'form',action:'accept',values})));assert.equal(sent.length,n);
});
await test('K19','Declined form carries no user content',async()=>{
 const c=fresh(),id=open(c,elicitation(form));await assert.rejects(kernel.respond(ui,response(c,id,{kind:'form',action:'decline',values:{name:'x'}})));await kernel.respond(ui,response(c,id,{kind:'form',action:'decline'}));assert.deepEqual(sent.at(-1),{action:'decline'});
});
await test('K20','Unsupported native verification and richer form schemas never become boolean approval',async()=>{
 for(const p of [{mode:'openai/userVerification',challenge:'fixture'},{mode:'form',message:'nested',requestedSchema:{type:'object',properties:{nested:{type:'object'}}}},{...form,requestedSchema:{...form.requestedSchema,properties:{tags:{type:'array',items:{type:'string'}}}}}]){
  const c=fresh(),d=elicitation(p);assert.equal(d.spec.kind,'unsupported');const id=open(c,d);await assert.rejects(kernel.respond(ui,response(c,id,{kind:'approval',actionId:'option-0'})));assert.equal(kernel.get(id).state,'pending');
 }
});
await test('K21','URL opening cannot resolve authorization; matching native completion required',async()=>{
 const c=fresh(),id=open(c,elicitation({mode:'url',message:'Complete fixture auth',url:'https://example.invalid/auth',elicitationId:'elicitation-1'}),{turnId:null});
 await assert.rejects(kernel.respond(ui,response(c,id,{kind:'url',action:'accept'})));assert.equal(kernel.get(id).state,'pending');assert.throws(()=>kernel.completeUrl(c.h,id,'wrong'),/URL_COMPLETION/);kernel.completeUrl(c.h,id,'elicitation-1');assert.equal(kernel.get(id).state,'resolved');
});
await test('K22','Non-http URL and duplicate semantic field IDs rejected',()=>{
 assert.throws(()=>elicitation({mode:'url',message:'x',url:'javascript:alert(1)',elicitationId:'x'}));assert.throws(()=>codexQuestions({isBlocking:true,questions:[{id:'q',question:'A'},{id:'q',question:'B'}]}));
});
await test('K23','Wrong task, binding, run or generation cannot answer another request',async()=>{
 const c=fresh(),id=open(c),n=sent.length;for(const k of Object.keys(c.scope))await assert.rejects(kernel.respond(ui,response(c,id,{kind:'approval',actionId:'option-0'},{expected:{...c.scope,[k]:k==='generation'?2:'other'}})),/WRONG_REQUEST_SCOPE/);assert.equal(sent.length,n);
});
await test('K24','Copied run identity and arbitrary UI object are not authority',async()=>{
 const c=fresh(),id=open(c);assert.throws(()=>open({h:{...c.h}},codexApproval({command:'x'})),/STALE_OR_FORGED/);await assert.rejects(kernel.respond({},response(c,id,{kind:'approval',actionId:'option-0'})),/UNTRUSTED_ACTOR/);
});
await test('K25','Duplicate reply receipt calls native once; same id different body rejected',async()=>{
 const c=fresh(),id=open(c),r=response(c,id,{kind:'approval',actionId:'option-0'}),n=sent.length;assert.equal(await kernel.respond(ui,r),'applied');assert.equal(await kernel.respond(ui,r),'applied');await assert.rejects(kernel.respond(ui,{...r,value:{kind:'approval',actionId:'option-1'}}),/IDEMPOTENCY_CONFLICT/);assert.equal(sent.length,n+1);
});
await test('K26','Unknown delivery is retained and never automatically re-sent',async()=>{
 const c=fresh();let calls=0;const id=open(c,undefined,{send:async()=>{calls++;throw new Error('transport disconnected after send');}}),r=response(c,id,{kind:'approval',actionId:'option-0'});assert.equal(await kernel.respond(ui,r),'unknown');assert.equal(await kernel.respond(ui,r),'unknown');await assert.rejects(kernel.respond(ui,response(c,id,r.value)),/REQUEST_NOT_CURRENT/);assert.equal(calls,1);
});
await test('K27','Proven not-sent requires new explicit revision and response command',async()=>{
 const c=fresh();let calls=0;const id=open(c,undefined,{send:async()=>++calls===1?'not-sent':'applied'}),r=response(c,id,{kind:'approval',actionId:'option-0'});assert.equal(await kernel.respond(ui,r),'not-sent');assert.equal(await kernel.respond(ui,r),'not-sent');assert.equal(calls,1);assert.equal(await kernel.respond(ui,response(c,id,r.value)),'applied');assert.equal(calls,2);
});
await test('K28','Old live callback expires across detach and replacement generation',async()=>{
 const c=fresh(),id=open(c);kernel.detach(c.h);const next=fresh('third-fixture',{...c.scope,generation:2});assert.equal(kernel.get(id).state,'expired');await assert.rejects(kernel.respond(ui,response(next,id,{kind:'approval',actionId:'option-0'})),/WRONG_REQUEST_SCOPE/);await assert.rejects(kernel.respond(ui,response(c,id,{kind:'approval',actionId:'option-0'})),/REQUEST_NOT_CURRENT/);
});
await test('K29','Persisted pending callback expires after reopening SQLite, not reconstituted from native ID',()=>{
 const file=join(attempt,'restart.sqlite'),a=new Kernel(file,registry),s={taskId:'restart',bindingId:'b',runId:'r',generation:1},h=a.attach('third-fixture',s);
 const id=a.openRequest(h,{nativeId:1,nativeNamespace:'rpc',turnId:null,...codexApproval({command:'fixture'}),send:async()=> 'applied'});a.close();const b=new Kernel(file,registry);b.recover();assert.equal(b.get(id).state,'expired');b.close();return{realDatabaseReopen:true,notProcessCrash:true};
});
await test('K30','All three drivers route requests through same gateway without pairwise logic',async()=>{
 for(const driver of ['claude-replay','codex-replay','third-fixture']){
  const c=fresh(driver),id=open(c,codexQuestions({isBlocking:true,questions:[{id:'q',question:'Fixture',options:null}]}));assert.equal(await kernel.respond(ui,response(c,id,{kind:'questions',answers:{q:['reply']}})),'applied');
 }
});
await test('K31','Two instances of the same driver must not share mutable tool mapping',()=>{
 const a=fresh('claude-replay'),b=fresh('claude-replay');
 const frame=name=>({type:'assistant',session_id:cr.session_id,message:{id:'same-message',content:[{type:'tool_use',id:'same-tool-id',name,input:{}}]}});
 kernel.ingest(a.h,frame('tool-A'));kernel.ingest(b.h,frame('tool-B'));
 kernel.ingest(a.h,{type:'user',session_id:cr.session_id,message:{content:[{type:'tool_result',tool_use_id:'same-tool-id',content:'A result'}]}});
 assert.equal(kernel.events(a.scope.taskId).at(-1).payload.name,'tool-A');
});
await test('K32','Foreign native session/thread frame rejected before persisting',()=>{
 const a=fresh('claude-replay'),b=fresh('codex-replay');
 const ca=claude.find(x=>x.type==='assistant'),cxr=codex.find(x=>x.method==='item/completed'&&x.params.item.type==='agentMessage');
 assert.throws(()=>kernel.ingest(a.h,{...ca,session_id:'foreign-session'}),/NATIVE_SCOPE/);
 assert.throws(()=>kernel.ingest(b.h,{...cxr,params:{...cxr.params,threadId:'foreign-thread'}}),/NATIVE_SCOPE/);
 assert.equal(kernel.events(a.scope.taskId).length,0);assert.equal(kernel.events(b.scope.taskId).length,0);
});
await test('K33','Recovery makes both dispatching request and response receipt unknown',async()=>{
 const file=join(attempt,'response-recovery.sqlite'),a=new Kernel(file,registry),actor=a.ui(),s={taskId:'response-recovery',bindingId:'b',runId:'r',generation:1},h=a.attach('third-fixture',s);
 let release;const transport=new Promise(resolve=>release=resolve);let entered;const accepted=new Promise(resolve=>entered=resolve);
 const id=a.openRequest(h,{nativeId:1,nativeNamespace:'rpc',turnId:null,...codexApproval({command:'fixture'}),send:()=>{entered();return transport;}});
 const cmd={requestId:id,expected:s,revision:1,commandId:'stable-receipt',value:{kind:'approval',actionId:'option-0'}};
 const pending=a.respond(actor,cmd);await accepted;
 const b=new Kernel(file,registry);b.recover();const state=await b.respond(b.ui(),cmd);b.close();release('unknown');await pending;a.close();assert.equal(state,'unknown');return{realSecondConnectionRecovery:true,notProcessCrash:true};
});
const totals={passed:tests.filter(x=>x.status==='passed').length,total:tests.length};
writeFileSync(join(attempt,'result.json'),JSON.stringify({kind:'candidate-contract-not-production',...totals,tests,nativeLiveCalls:0,existingBusinessAuthorizationExecuted:false},null,2)+'\n');
writeFileSync(join(root,'latest.json'),JSON.stringify({attempt,...totals})+'\n');
kernel.close();console.log(JSON.stringify({attempt,...totals}));process.exitCode=totals.passed===totals.total?0:1;
