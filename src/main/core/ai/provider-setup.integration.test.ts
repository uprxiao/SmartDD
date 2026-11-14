import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderInput } from '@shared/ai-agents';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { ProviderService } from './provider-service';
import { createProviderSetupController } from './provider-setup-controller';
import { presetModelMetadata } from './provider-metadata';
import type { ProviderClientOptions } from './provider-client';

const KEY='PUBLIC_PROVIDER_SETUP_KEY_ONLY';
let sqlite:Database.Database,db:ReturnType<typeof drizzle<typeof schema>>,secrets:SecretsStore,agents:AgentService;
beforeEach(()=>{sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);db=drizzle(sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:x=>Buffer.from('synthetic-cipher:'+x),decrypt:x=>x.toString().slice('synthetic-cipher:'.length)});agents=new AgentService(db,secrets,()=>1000);});
afterEach(()=>sqlite.close());
const input=(changes:Partial<ProviderInput>={}):ProviderInput=>({name:'Synthetic Setup',preset:null,key:KEY,endpoints:{anthropic:'https://setup.example.invalid/anthropic',responses:'https://setup.example.invalid/v1'},models:[{id:'a',name:'Model A'},{id:'b',name:'Model B'},{id:'c',name:'Model C'}],recommended:{claude:'a',codex:'b'},...changes});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function stream(kind:'claude'|'codex'){
 const e=(type:string,value:object)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`,item={type:'function_call',name:'wy_ping',call_id:'synthetic-call',arguments:'{}'};
 return new Response(kind==='claude'?e('message_start',{})+e('content_block_start',{index:0,content_block:{type:'tool_use',id:'synthetic-tool',name:'wy_ping',input:{}}})+e('content_block_stop',{index:0})+e('message_stop',{}):e('response.created',{})+e('response.output_item.done',{item})+e('response.completed',{response:{status:'completed',output:[item]}}),{headers:{'content-type':'text/event-stream'}});
}
const kindOf=(init:RequestInit|undefined):'claude'|'codex'=>(init?.headers as Record<string,string>)?.['anthropic-beta']?'claude':'codex';
const state=()=>JSON.stringify(Object.fromEntries(['ai_providers','ai_profiles','ai_run_configs','app_secrets','ai_tools'].map(t=>[t,sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
const service=(fetch:typeof globalThis.fetch,extra:ProviderClientOptions={})=>new ProviderService(db,secrets,agents,{fetch,...extra},()=>1000);
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function scoped(s:ProviderService){
 const handlers=new Map<string,(event:any,...args:any[])=>any>();registerRPCRouter({setup:createProviderSetupController(s)},{handle:(channel:string,handler:any)=>handlers.set(channel,handler)} as any);
 const sender=Object.assign(new EventEmitter(),{id:51,mainFrame:{},dead:false,isDestroyed(){return this.dead;}}),event={sender,senderFrame:sender.mainFrame};
 return {sender,event,call:(name:string,...args:any[])=>handlers.get('setup.'+name)!(event,...args),other:(name:string,e:any,...args:any[])=>handlers.get('setup.'+name)!(e,...args)};
}

it('models preview reads normalized directory without creating Provider, encrypted secret or Agent',async()=>{
 const fake=vi.fn(async()=>json({data:[{id:'a',display_name:' A ',context_window:128000},{id:'b',name:'B'}]})),s=service(fake),before=state();const result=await s.previewDraft(input());expect(result.models.map(m=>[m.id,m.name])).toEqual([['a','A'],['b','B']]);expect(result.models.every(m=>m.availability.codex==='untested'&&m.availability.claude==='untested')).toBe(true);expect(state()).toBe(before);expect(fake).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain(KEY);
});
it.each(['empty','404'])('models %s offers manual-entry opportunity without mutation',async reason=>{
 const s=service(vi.fn(async()=>reason==='empty'?json({data:[]}):json({message:'absent'},404))),before=state(),result=await s.previewDraft(input());expect(result.models).toEqual([]);expect(result.note).toContain('手动');expect(state()).toBe(before);
});
it('empty structured protocol probe is candidate only and does not write compatibility or any Provider',async()=>{
 const fake=vi.fn(async()=>json({error:{type:'invalid_request_error'}},400)),s=service(fake),before=state();expect(await s.probeDraft(input(),'codex')).toMatchObject({state:'candidate'});expect(fake).toHaveBeenCalledOnce();expect(state()).toBe(before);
});
it('connect checks one recommended model per protocol with real minimal SSE and resets all renderer status/history without creating Agents',async()=>{
 const requests:{kind:string;body:any;headers:Record<string,string>}[]=[];const s=service(vi.fn(async(_url,init)=>{const kind=kindOf(init);requests.push({kind,body:JSON.parse(String(init?.body)),headers:init?.headers as Record<string,string>});return stream(kind);}));
 const data=input();data.models=data.models!.map(m=>({...m,availability:{claude:'available',codex:'available'},checks:{codex:{status:'available',attempts:1,durationMs:0,checkedAt:1,message:'FORGED_RENDERER_REPORT',failures:[]}}}));
 const saved=await s.connect(data);expect(requests.map(x=>[x.kind,x.body.model])).toEqual([['claude','a'],['codex','b']]);expect(requests[0].body).toMatchObject({stream:true,thinking:{type:'adaptive',display:'updates'},tool_choice:{type:'auto'}});expect(requests[0].headers['anthropic-beta']).toBeTruthy();expect(requests[1].body.tools[0]).toMatchObject({type:'function',name:'wy_ping'});
 expect(saved.models.find(m=>m.id==='a')!.availability).toEqual({claude:'available',codex:'untested'});expect(saved.models.find(m=>m.id==='b')!.availability).toEqual({claude:'untested',codex:'available'});expect(saved.models.find(m=>m.id==='c')!.availability).toEqual({claude:'untested',codex:'untested'});expect(JSON.stringify(saved)).not.toContain('FORGED_RENDERER_REPORT');expect(JSON.stringify(saved)).not.toContain(KEY);expect(agents.configs()).toEqual([]);expect(sqlite.prepare('SELECT COUNT(*) n FROM app_secrets').get()).toEqual({n:1});
});
it('explicit invalid recommendation falls back to an actually selected model, never tests an unselected ID',async()=>{
 const seen:string[]=[];const s=service(vi.fn(async(_u,init)=>{seen.push(JSON.parse(String(init?.body)).model);return stream(kindOf(init));}));await s.connect(input({recommended:{claude:'MISSING',codex:'MISSING'}}));expect(seen).toEqual(['a','a']);
});
it('failed custom protocol is removed while the independently successful protocol remains',async()=>{
 const seen:string[]=[];const s=service(vi.fn(async(_u,init)=>{const kind=kindOf(init);seen.push(kind);return kind==='claude'?json({error:{message:'no anthropic'}},404):stream('codex');}));const result=await s.connect(input());expect(seen).toEqual(['claude','codex']);expect(result.endpoints).toEqual({responses:'https://setup.example.invalid/v1'});expect(result.models.find(m=>m.id==='a')!.checks?.claude?.attempts).toBe(1);expect(result.models.find(m=>m.id==='b')!.availability.codex).toBe('available');expect(agents.configs()).toEqual([]);
});
it('all custom protocols failing without openai leaves no Provider/secret/Agent',async()=>{
 const fake=vi.fn(async()=>json({error:{message:'unavailable'}},404)),s=service(fake),before=state();await expect(s.connect(input())).rejects.toThrow('unavailable');expect(fake).toHaveBeenCalledTimes(2);expect(state()).toBe(before);
});
it('openai-only Provider may be saved as non-CodeAgent-compatible without sending model calls',async()=>{
 const fake=vi.fn(async()=>{throw new Error('UNEXPECTED_MODEL_CALL');}),s=service(fake);const result=await s.connect(input({endpoints:{openai:'https://setup.example.invalid/v1'}}));expect(fake).not.toHaveBeenCalled();expect(result.endpoints).toEqual({openai:'https://setup.example.invalid/v1'});expect(result.models.every(m=>m.availability.codex==='untested'&&m.availability.claude==='untested')).toBe(true);expect(agents.configs()).toEqual([]);
});
it('failed custom CodeAgent endpoints may leave openai-only saved, without claiming any model available',async()=>{
 const s=service(vi.fn(async()=>json({error:{message:'no protocol'}},404)));const result=await s.connect(input({endpoints:{anthropic:'https://setup.example.invalid/anthropic',responses:'https://setup.example.invalid/v1',openai:'https://setup.example.invalid/chat'}}));expect(result.endpoints).toEqual({openai:'https://setup.example.invalid/chat'});expect(result.models.some(m=>Object.values(m.availability).includes('available'))).toBe(false);
});
it.each([401,403])('HTTP %s at a later protocol cannot publish earlier success or Key; no credential fallback/retry',async status=>{
 const seen:string[]=[];const s=service(vi.fn(async(_u,init)=>{const kind=kindOf(init);seen.push(kind);return kind==='claude'?stream('claude'):json({error:{message:KEY}},status);})),before=state();await expect(s.connect(input())).rejects.toThrow(status===401?'Key 可能无效':'服务拒绝');expect(seen).toEqual(['claude','codex']);expect(state()).toBe(before);
});
it('generic tool failure retries once and confirms only after valid tool completion',async()=>{
 let calls=0;const s=service(vi.fn(async()=>++calls===1?json({error:{message:'temporary'}},500):stream('codex')));const result=await s.connect(input({endpoints:{responses:'https://setup.example.invalid/v1'},recommended:{codex:'b'}}));expect(calls).toBe(2);expect(result.models.find(m=>m.id==='b')!.checks?.codex).toMatchObject({status:'available',attempts:2,failures:[{status:500,message:'temporary'}]});
});
it('body text instead of streaming tool completion never confirms a custom protocol or saves',async()=>{
 const fake=vi.fn(async()=>new Response('hello',{headers:{'content-type':'text/plain'}})),s=service(fake),before=state();await expect(s.connect(input({endpoints:{responses:'https://setup.example.invalid/v1'}}))).rejects.toThrow();expect(fake).toHaveBeenCalledTimes(2);expect(state()).toBe(before);
});
it('empty selected models refuses before any transport or database operation',async()=>{
 const fake=vi.fn(async()=>stream('codex')),s=service(fake),before=state();await expect(s.connect(input({models:[]}))).rejects.toThrow('至少');expect(fake).not.toHaveBeenCalled();expect(state()).toBe(before);
});
it('per-request cancellation after one successful protocol prevents late Provider/Key writes',async()=>{
 const pending=deferred<Response>(),entered=deferred<void>(),controller=new AbortController(),fake=vi.fn(async(_u,init)=>{if(kindOf(init)==='claude')return stream('claude');entered.resolve();return pending.promise;}),s=service(fake),before=state();
 const result=s.connect(input(),controller.signal);await entered.promise;controller.abort();await expect(result).rejects.toThrow('取消');pending.resolve(stream('codex'));await Promise.resolve();expect(state()).toBe(before);
});
it('constructor-level cancellation is also a cancellation, never an openai fallback save',async()=>{
 const pending=deferred<Response>(),entered=deferred<void>(),controller=new AbortController(),fake=vi.fn(async()=>{entered.resolve();return pending.promise;}),s=service(fake,{signal:controller.signal}),before=state();
 const result=s.connect(input({endpoints:{responses:'https://setup.example.invalid/v1',openai:'https://setup.example.invalid/chat'}}));await entered.promise;controller.abort();try{await expect(result).rejects.toThrow('取消');}finally{pending.resolve(stream('codex'));}expect(state()).toBe(before);
});
it('DeepSeek official defaults whitelist metadata; remote prompts and unknown policy fields never appear in preview',async()=>{
 const fake=vi.fn(async()=>json({data:[{id:'deepseek-flash',base_instructions:'REMOTE_PROMPT_SENTINEL',system_prompt:'REMOTE_SYSTEM_SENTINEL',policy:'REMOTE_POLICY_SENTINEL'},{id:'deepseek-v4-pro'}]})),s=service(fake);const result=await s.previewDraft(input({preset:'deepseek',endpoints:{responses:'https://api.deepseek.com/',anthropic:'https://api.deepseek.com/anthropic'}}));
 expect(result.models[0]).toMatchObject({id:'deepseek-flash',contextWindow:1048576,codex:{reasoningLevels:['low','high','max'],defaultReasoning:'high',inputModalities:['text','image'],supportVerbosity:true}});for(const bad of ['REMOTE_PROMPT_SENTINEL','REMOTE_SYSTEM_SENTINEL','REMOTE_POLICY_SENTINEL','base_instructions'])expect(JSON.stringify(result)).not.toContain(bad);expect(agents.providers()).toEqual([]);
});
it('DeepSeek metadata is not applied to an impostor custom endpoint or unrelated model',()=>{
 const m={id:'deepseek-flash',name:'Flash',contextWindow:null,offline:false,availability:{codex:'untested' as const,claude:'untested' as const}};expect(presetModelMetadata('deepseek',{responses:'https://impostor.example.invalid/v1'},[m])).toEqual([m]);expect(presetModelMetadata('deepseek',{responses:'https://api.deepseek.com/'},[{...m,id:'other'}])).toEqual([{...m,id:'other'}]);
});
it('scoped controller rejects subframe/destroyed callers and gives safe field error without transport or writes',async()=>{
 const fake=vi.fn(async()=>stream('codex')),c=scoped(service(fake)),before=state();const sub=await c.other('connect',{...c.event,senderFrame:{}},input());expect(sub).toMatchObject({ok:false});c.sender.dead=true;expect(await c.call('connect',input())).toMatchObject({ok:false});c.sender.dead=false;const invalid=await c.call('connect',input({name:''}));expect(invalid).toMatchObject({ok:false,message:'供应商字段无效，请检查地址、Key 和模型'});expect(JSON.stringify(invalid)).not.toContain(KEY);expect(fake).not.toHaveBeenCalled();expect(state()).toBe(before);
});
it('scoped controller busy guard allows only one current request per owner',async()=>{
 const pending=deferred<Response>(),entered=deferred<void>(),fake=vi.fn(async()=>{entered.resolve();return pending.promise;}),c=scoped(service(fake)),before=state();const first=c.call('models',input());await entered.promise;expect(await c.call('probe',input(),'codex')).toMatchObject({ok:false,code:'BUSY'});expect(fake).toHaveBeenCalledOnce();pending.resolve(json({data:[{id:'a'}]}));expect(await first).toMatchObject({ok:true});expect(state()).toBe(before);
});
it.each(['cancel','main-navigation','destroyed'])('scoped %s invalidates in-flight connect and no late result can write',async event=>{
 const pending=deferred<Response>(),entered=deferred<void>(),c=scoped(service(vi.fn(async()=>{entered.resolve();return pending.promise;}))),before=state();const running=c.call('connect',input({endpoints:{responses:'https://setup.example.invalid/v1',openai:'https://setup.example.invalid/chat'}}));await entered.promise;
 if(event==='cancel')c.call('cancel');else if(event==='main-navigation')c.sender.emit('did-start-navigation',{},'https://next.example.invalid',false,true);else{c.sender.dead=true;c.sender.emit('destroyed');}
 const reply=await running;expect(reply).toMatchObject({ok:false});expect(reply.message).toContain('取消');pending.resolve(stream('codex'));await Promise.resolve();expect(state()).toBe(before);
});
it('subframe navigation does not cancel main-frame setup request',async()=>{
 const pending=deferred<Response>(),entered=deferred<void>(),c=scoped(service(vi.fn(async()=>{entered.resolve();return pending.promise;})));const running=c.call('models',input());await entered.promise;c.sender.emit('did-start-navigation',{},'https://sub.example.invalid',false,false);pending.resolve(json({data:[{id:'a'}]}));expect(await running).toMatchObject({ok:true});expect(agents.providers()).toEqual([]);
});

it('valid main-frame controller connect returns safe Provider and creates no Agent through the scoped RPC boundary',async()=>{
 const fake=vi.fn(async()=>stream('codex')),c=scoped(service(fake));const reply=await c.call('connect',input({endpoints:{responses:'https://setup.example.invalid/v1'}}));expect(reply).toMatchObject({ok:true,value:{hasKey:true,name:'Synthetic Setup'}});expect(fake).toHaveBeenCalledOnce();expect(JSON.stringify(reply)).not.toContain(KEY);expect(agents.providers()).toHaveLength(1);expect(agents.configs()).toEqual([]);
});

it('complete same-origin paginated model directory retains all pages and deduplicates identities, without writes',async()=>{
 const seen:{url:string;auth:string}[]=[];let page=0;
 const fake=vi.fn(async(url,init)=>{seen.push({url:String(url),auth:(init?.headers as Record<string,string>).Authorization});page++;if(page===1)return json({data:[{id:'a'},{id:'b',name:'B old'}],has_more:true,last_id:'b'});if(page===2)return json({data:[{id:'b',name:'B updated'},{id:'c'}],has_more:true,last_id:'c'});return json({data:[{id:'d'}],has_more:false});}),s=service(fake),before=state();
 const result=await s.previewDraft(input({endpoints:{responses:'https://setup.example.invalid/v1?region=qa'}}));expect(result.models.map(m=>m.id)).toEqual(['a','b','c','d']);expect(result.models.find(m=>m.id==='b')!.name).toBe('B updated');expect(seen.map(x=>new URL(x.url).searchParams.get('after_id'))).toEqual([null,'b','c']);expect(seen.every(x=>new URL(x.url).origin==='https://setup.example.invalid'&&new URL(x.url).pathname==='/v1/models'&&new URL(x.url).searchParams.get('region')==='qa'&&x.auth===`Bearer ${KEY}`)).toBe(true);expect(state()).toBe(before);
});
it('repeated pagination cursor refuses incomplete preview instead of exposing partial model results',async()=>{
 let page=0;const fake=vi.fn(async()=>++page===1?json({data:[{id:'a'}],has_more:true,last_id:'a'}):json({data:[{id:'b'}],has_more:true,last_id:'a'})),s=service(fake),before=state();await expect(s.previewDraft(input({endpoints:{responses:'https://setup.example.invalid/v1'}}))).rejects.toThrow('分页不完整');expect(fake).toHaveBeenCalledTimes(2);expect(state()).toBe(before);
});
it('later directory-page failure preserves the saved complete directory, per-tool state and encrypted Key',async()=>{
 const old=agents.saveProvider(input({models:[{id:'old',name:'Existing Model',availability:{claude:'available',codex:'unavailable'}}]}));let page=0;const fake=vi.fn(async()=>++page===1?json({data:[{id:'fresh'}],has_more:true,last_id:'fresh'}):json({error:{message:'PAGE_TWO_FAILED'}},500)),s=service(fake),before=state();await expect(s.refresh(old.id)).rejects.toThrow('PAGE_TWO_FAILED');expect(fake).toHaveBeenCalledTimes(2);expect(state()).toBe(before);expect(agents.providers()[0].models.map(m=>m.id)).toEqual(['old']);
});
