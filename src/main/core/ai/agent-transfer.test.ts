import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { ProviderService } from './provider-service';
import { AgentTransferService } from './agent-transfer';
import { decryptTransfer, encryptTransfer } from '../projects/transfer-format';
import { TRANSFER_LIMITS } from '@shared/project-transfer';
import type { PortableAgents } from '@shared/agent-transfer';

const KEY='PUBLIC_AI_TRANSFER_KEY_A_ONLY', KEY2='PUBLIC_AI_TRANSFER_KEY_B_ONLY', PASS='PUBLIC-8';
let sqlite:Database.Database, db:ReturnType<typeof drizzle<typeof schema>>, secrets:SecretsStore, agents:AgentService, providers:ProviderService, transfer:AgentTransferService, now:number, decrypts:number;
beforeEach(()=>{
 sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);db=drizzle(sqlite,{schema});now=1000;decrypts=0;
 secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:v=>Buffer.from('synthetic-cipher:'+v),decrypt:v=>{decrypts++;return v.toString().slice('synthetic-cipher:'.length);}});
 agents=new AgentService(db,secrets,()=>now);
 agents.recordTools([{id:'recipient-codex',kind:'codex',executable:'/synthetic/recipient/bin/codex',installed:true,login:'subscription',version:'synthetic'}, {id:'recipient-claude',kind:'claude',executable:'/synthetic/recipient/bin/claude',installed:true,login:'api',version:'synthetic'}]);
 providers=new ProviderService(db,secrets,agents,{fetch:vi.fn(()=>{throw new Error('NETWORK_FORBIDDEN');})});
 transfer=new AgentTransferService(db,secrets,agents,providers,()=>now);
});
afterEach(()=>{transfer.disposeOwner(1);transfer.disposeOwner(2);sqlite.close();});
const payload=(changes:Partial<PortableAgents>={}):PortableAgents=>({format:'willyou.agents',version:1,exportedAt:'2026-11-12T00:00:00.000Z',providers:[{ref:'p1',name:'X',preset:null,endpoints:{responses:'https://provider.example.invalid/v1',anthropic:'https://provider.example.invalid/anthropic',openai:'https://provider.example.invalid/openai/v1'},authType:'bearer',models:[{id:'a',name:'模型A 中文🙂',contextWindow:128000,offline:false,availability:{claude:'available',codex:'available'}},{id:'b',name:'Model B',contextWindow:null,offline:false,availability:{claude:'untested',codex:'unavailable'}}],recommended:{claude:'b',codex:'a'}}],agents:[{ref:'a1',name:'Agent X',source:'provider',kind:'codex',provider:'p1',models:['b','a'],defaultModel:'a',homeVisible:true}],credentials:{},...changes});
const bytes=(p:unknown)=>Buffer.from(JSON.stringify(p));
function state(){return JSON.stringify(Object.fromEntries(['ai_providers','ai_profiles','ai_run_configs','ai_tools','app_secrets'].map(t=>[t,sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));}
function seed(name='X'){
 const p=agents.saveProvider({name,key:KEY,endpoints:{responses:'https://provider.example.invalid/v1',anthropic:'https://provider.example.invalid/anthropic'},models:[{id:'a',name:'A',availability:{codex:'available',claude:'available'}},{id:'b',name:'B'}],recommended:{codex:'a',claude:'b'}});
 const c=agents.saveConfig({name:'Agent '+name,toolId:'recipient-codex',source:'provider',providerId:p.id,models:['a','b'],defaultModel:'b'});return {p,c};
}
function legacy(env:{name:string;secret:boolean;value:string|null}[],args:string[]=[]){
 const id=randomUUID();db.insert(schema.aiProfiles).values({id,name:'Legacy',runner:'codex',executable:'/synthetic/sender/codex',env:JSON.stringify(env),args:JSON.stringify(args),isDefault:false,createdAt:now,updatedAt:now}).run();
 db.insert(schema.aiRunConfigs).values({profileId:id,toolId:'recipient-codex',source:'legacy',providerId:null,models:'[]',defaultModel:null,homeVisible:true,nameCustomized:true,loggedOut:false,sortOrder:agents.configs().length,legacyReason:'synthetic advanced',migrationVersion:1}).run();return id;
}
const inspect=(p:unknown,owner=1)=>transfer.inspect(owner,bytes(p));

it('default export automatically carries only selected agent Provider once, omits credentials/paths/checks, never decrypts',async()=>{
 const {p,c}=seed();seed('Unselected');const before=state();
 const raw=await transfer.exportBytes({providerIds:[p.id],agentIds:[c.id]}); const out=JSON.parse(raw.toString());
 expect(out.providers).toHaveLength(1);expect(out.providers[0].ref).toBe(p.id);expect(out.agents).toHaveLength(1);expect(out.credentials).toEqual({});expect(decrypts).toBe(0);
 for(const bad of [KEY,'/synthetic/','secretRef','checkedAt','executable'])expect(raw.toString()).not.toContain(bad);
 expect(out.providers[0].models.every((m:any)=>m.availability.codex==='untested')).toBe(true);expect(state()).toBe(before);
});
it('roundtrips models, selected order, default, protocol endpoints and recommendations into fresh independent IDs without trusting checks',()=>{
 const p=payload();p.providers[0].models[0].checks={codex:{status:'available',attempts:1,durationMs:1,checkedAt:1,message:'foreign report',failures:[]}};
 p.providers[0].models[0].catalogSource='manual';
 const original=state(), pv=inspect(p);expect(pv.preview?.providers[0].needsKey).toBe(true);expect(state()).toBe(original);
 const result=transfer.commit(1,pv.token);const imported=agents.providers()[0], c=agents.configs()[0];
 expect(result.providerIds).toEqual([imported.id]);expect(imported.id).not.toBe('p1');expect(c.id).not.toBe('a1');expect(c.providerId).toBe(imported.id);expect(c.toolId).toBe('recipient-codex');expect(c.models).toEqual(['b','a']);expect(c.defaultModel).toBe('a');
 expect(imported.endpoints).toEqual(p.providers[0].endpoints);expect(imported.recommended).toEqual(p.providers[0].recommended);expect(imported.models.map(m=>[m.id,m.name,m.contextWindow])).toEqual(p.providers[0].models.map(m=>[m.id,m.name,m.contextWindow]));
 expect(imported.models.every(m=>m.availability.codex==='untested'&&m.availability.claude==='untested'&&!m.checks)).toBe(true);expect(imported.hasKey).toBe(false);
 expect(imported.models[0].catalogSource).toBe('manual');
});
it('skips foreign native-login entries with explanation, while importing valid Provider agent without changing local login',()=>{
 const p=payload();p.agents.push({ref:'native',name:'Native incoming',source:'login',kind:'claude'});const before=agents.tools();
 const pv=inspect(p);expect(pv.preview?.skipped).toEqual([{name:'Native incoming',reason:expect.stringContaining('本机')}]);expect(pv.preview?.agents).toHaveLength(1);
 const result=transfer.commit(1,pv.token);expect(result.agentIds).toHaveLength(1);expect(result.skipped).toHaveLength(1);expect(agents.tools()).toEqual(before);
});
it('native-login agents cannot be exported and their authentication is not read',async()=>{
 const c=agents.saveConfig({name:'Native',toolId:'recipient-codex',source:'login'});const before=state();
 await expect(transfer.exportBytes({providerIds:[],agentIds:[c.id]})).rejects.toThrow('不能导出');expect(decrypts).toBe(0);expect(state()).toBe(before);
});
it('allocates names against existing and same-batch names; repeat import never overwrites or merges equal-URL Provider identities',()=>{
 const old=seed();agents.saveProvider({name:'X（导入）',endpoints:{responses:'https://other.example.invalid/v1'}});agents.saveProvider({name:'X（导入 2）',endpoints:{responses:'https://other.example.invalid/v1'}});
 const oldRow=sqlite.prepare('SELECT * FROM ai_providers WHERE id=?').get(old.p.id),oldConfig=agents.configs().find(c=>c.id===old.c.id);
 const p=payload();p.providers.push({...p.providers[0],ref:'p2'});p.agents.push({...(p.agents[0] as Extract<PortableAgents['agents'][number],{source:'provider'}>),ref:'a2',provider:'p2'});
 const pv=inspect(p);expect(pv.preview?.providers.map(x=>x.finalName)).toEqual(['X（导入 3）','X（导入 4）']);expect(pv.preview?.agents.map(x=>x.finalName)).toEqual(['Agent X（导入）','Agent X（导入 2）']);transfer.commit(1,pv.token);
 const again=inspect(p);expect(again.preview?.providers.map(x=>x.finalName)).toEqual(['X（导入 5）','X（导入 6）']);expect(again.preview?.agents.map(x=>x.finalName)).toEqual(['Agent X（导入 3）','Agent X（导入 4）']);transfer.commit(1,again.token);
 expect(sqlite.prepare('SELECT * FROM ai_providers WHERE id=?').get(old.p.id)).toEqual(oldRow);expect(agents.configs().find(c=>c.id===old.c.id)).toEqual(oldConfig);expect(new Set(agents.configs().filter(c=>c.source==='provider').map(c=>c.toolId+':'+c.providerId)).size).toBe(5);
});
it('detects local name changes after preview and refuses without any partial write',()=>{
 const pv=inspect(payload());seed();const before=state();expect(()=>transfer.commit(1,pv.token)).toThrow('重新预览');expect(state()).toBe(before);
});
it('owner-bound preview rejects another owner; a second file or disposal invalidates original token',()=>{
 const old=inspect(payload());const before=state();expect(()=>transfer.commit(2,old.token)).toThrow('失效');expect(state()).toBe(before);
 const fresh=inspect(payload());expect(()=>transfer.commit(1,old.token)).toThrow('失效');transfer.disposeOwner(1);expect(()=>transfer.commit(1,fresh.token)).toThrow('失效');expect(state()).toBe(before);
});
it('preview expiry rejects commit, and a successful commit token is idempotent',()=>{
 const pv=inspect(payload());now+=TRANSFER_LIMITS.ttl+1;const before=state();expect(()=>transfer.commit(1,pv.token)).toThrow('失效');expect(state()).toBe(before);
 const again=inspect(payload());const one=transfer.commit(1,again.token),after=state();expect(transfer.commit(1,again.token)).toEqual(one);expect(state()).toBe(after);
});
it.each(['provider','agent'] as const)('DB failure during %s import rolls back entire batch and leaves pre-existing rows unchanged',where=>{
 seed('Existing');const p=payload();p.providers.push({...p.providers[0],ref:'p2',name:'Second'});p.agents.push({...(p.agents[0] as Extract<PortableAgents['agents'][number],{source:'provider'}>),ref:'a2',provider:'p2',name:'SecondAgent'});
 const pv=inspect(p);const table=where==='provider'?'ai_providers':'ai_profiles',name=where==='provider'?'Second':'SecondAgent';
 sqlite.exec(`CREATE TEMP TRIGGER fail_import BEFORE INSERT ON ${table} WHEN NEW.name='${name}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_IMPORT_FAIL'); END;`);const before=state();
 expect(()=>transfer.commit(1,pv.token)).toThrow('SYNTHETIC_IMPORT_FAIL');expect(state()).toBe(before);
});
it('legacy export strips executable path and keeps only portable non-secret env/args; missing secret stays absent',async()=>{
 const id=legacy([{name:'MODE',secret:false,value:'safe'},{name:'OPENAI_API_KEY',secret:true,value:null}],['--verbose']);secrets.set(`ai:${id}:env:OPENAI_API_KEY`,KEY);
 const raw=await transfer.exportBytes({providerIds:[],agentIds:[id]});expect(decrypts).toBe(0);expect(raw.toString()).not.toContain(KEY);expect(raw.toString()).not.toContain('/synthetic/');const out=JSON.parse(raw.toString());expect(out.agents[0].env[1]).toMatchObject({secret:true,value:null});
 const pv=transfer.inspect(1,raw);const result=transfer.commit(1,pv.token);const imported=sqlite.prepare('SELECT * FROM ai_profiles WHERE id=?').get(result.agentIds[0]) as any;expect(imported.executable).toBeNull();expect(JSON.parse(imported.args)).toEqual(['--verbose']);expect(secrets.has(`ai:${result.agentIds[0]}:env:OPENAI_API_KEY`)).toBe(false);
});
it.each(['/synthetic/sender/project','--cwd=/synthetic/sender/project','C:\\sender\\workspace','../workspace','~/workspace'])('legacy local path %s rejects default export without any state change',async path=>{
 const id=legacy([],[path]);const before=state();await expect(transfer.exportBytes({providerIds:[],agentIds:[id]})).rejects.toThrow('本机目录');expect(state()).toBe(before);
});
it('legacy secret env is encrypted for transfer and restored only to the new credential reference',async()=>{
 const id=legacy([{name:'OPENAI_API_KEY',secret:true,value:null}]);secrets.set(`ai:${id}:env:OPENAI_API_KEY`,KEY);const raw=await transfer.exportBytes({providerIds:[],agentIds:[id],includeKeys:true,password:PASS,confirmation:PASS});
 expect(raw.toString()).not.toContain(KEY);const pending=transfer.inspect(1,raw);expect(pending.preview).toBeNull();await transfer.unlock(1,pending.token,PASS);const result=transfer.commit(1,pending.token);expect(secrets.get(`ai:${result.agentIds[0]}:env:OPENAI_API_KEY`)).toBe(KEY);
});
it.each(['1234567','🙂🙂🙂🙂🙂🙂🙂'])('include-Key passphrase shorter than 8 Unicode codepoints refuses before decrypting source secrets',async password=>{
 const {c}=seed();const before=state();await expect(transfer.exportBytes({providerIds:[],agentIds:[c.id],includeKeys:true,password,confirmation:password})).rejects.toThrow('8');expect(decrypts).toBe(0);expect(state()).toBe(before);
});
it('password confirmation mismatch and over-byte-budget passphrase refuse without exposing values',async()=>{
 const {c}=seed();await expect(transfer.exportBytes({providerIds:[],agentIds:[c.id],includeKeys:true,password:PASS,confirmation:'OTHER-8!'})).rejects.toThrow('不一致');
 await expect(transfer.exportBytes({providerIds:[],agentIds:[c.id],includeKeys:true,password:'🙂'.repeat(300),confirmation:'🙂'.repeat(300)})).rejects.toThrow();expect(decrypts).toBe(0);
});
it('real GCM encrypted export accepts 8 codepoints, has fresh random salt/nonce, wrong password does not mutate, correct password imports Key',async()=>{
 const {c}=seed();const password='🙂🙂🙂🙂🙂🙂🙂🙂';const a=await transfer.exportBytes({providerIds:[],agentIds:[c.id],includeKeys:true,password,confirmation:password}),b=await transfer.exportBytes({providerIds:[],agentIds:[c.id],includeKeys:true,password,confirmation:password});
 expect(a.equals(b)).toBe(false);expect(JSON.parse(a.toString()).kdf.salt).not.toBe(JSON.parse(b.toString()).kdf.salt);expect(JSON.parse(a.toString()).cipher.nonce).not.toBe(JSON.parse(b.toString()).cipher.nonce);for(const value of [KEY,password])expect(a.toString()).not.toContain(value);
 const pending=transfer.inspect(1,a);const before=state();await expect(transfer.unlock(1,pending.token,'WRONG_PUBLIC')).rejects.toThrow('口令');expect(state()).toBe(before);expect(()=>transfer.commit(1,pending.token)).toThrow('先输入');
 const preview=await transfer.unlock(1,pending.token,password);expect(preview.providers[0].needsKey).toBe(false);expect(JSON.stringify(preview)).not.toContain(KEY);expect(state()).toBe(before);
 const result=transfer.commit(1,pending.token);const provider=sqlite.prepare('SELECT * FROM ai_providers WHERE id=?').get(result.providerIds[0]) as any;expect(secrets.get(provider.secret_ref)).toBe(KEY);expect(provider.id).not.toBe(c.providerId);
});
it('tampered GCM ciphertext refuses without mutation; foreign project-format envelope is rejected before import',async()=>{
 const p=payload({credentials:{p1:{key:KEY}}}),raw=await encryptTransfer(p,PASS,'willyou.agents'),value=JSON.parse(raw.toString());const cipher=Buffer.from(value.ciphertext,'base64');cipher[0]^=1;value.ciphertext=cipher.toString('base64');
 const pending=transfer.inspect(1,bytes(value)),before=state();await expect(transfer.unlock(1,pending.token,PASS)).rejects.toThrow();expect(state()).toBe(before);
 const wrong=await encryptTransfer(p,PASS,'willyou.project');expect(()=>transfer.inspect(1,wrong)).toThrow();expect(state()).toBe(before);
});
it('encrypted import secret failure rolls back earlier Provider Keys and profiles, preserving original credentials',async()=>{
 seed('Existing');const p=payload({credentials:{p1:{key:KEY},p2:{key:KEY2}}});p.providers.push({...p.providers[0],ref:'p2',name:'Second'});p.agents.push({...(p.agents[0] as Extract<PortableAgents['agents'][number],{source:'provider'}>),ref:'a2',provider:'p2',name:'SecondAgent'});
 const raw=await encryptTransfer(p,PASS,'willyou.agents'),pending=transfer.inspect(1,raw);await transfer.unlock(1,pending.token,PASS);const before=state();const original=secrets.set.bind(secrets);vi.spyOn(secrets,'set').mockImplementation((key,value)=>{if(value===KEY2)throw new Error('SYNTHETIC_SECRET_FAIL');return original(key,value);});
 expect(()=>transfer.commit(1,pending.token)).toThrow('SYNTHETIC_SECRET_FAIL');expect(state()).toBe(before);
});
it('decrypted Key cannot reach preview via provider name, agent name or endpoint field echo',async()=>{
 const p=payload({credentials:{p1:{key:KEY}}});p.providers[0].name=KEY;p.providers[0].endpoints.responses='https://provider.example.invalid/'+KEY;p.agents[0].name=KEY;
 const raw=await encryptTransfer(p,PASS,'willyou.agents'),pending=transfer.inspect(1,raw),before=state();
 try { const preview=await transfer.unlock(1,pending.token,PASS);expect(JSON.stringify(preview)).not.toContain(KEY); }
 catch(error) { if(error instanceof Error && error.name==='AssertionError')throw error;expect(String(error)).not.toContain(KEY);expect(()=>transfer.commit(1,pending.token)).toThrow(); }
 expect(state()).toBe(before);
});
it('disposal during async unlock invalidates pending result and never imports',async()=>{
 const raw=await encryptTransfer(payload({credentials:{p1:{key:KEY}}}),PASS,'willyou.agents'),pending=transfer.inspect(1,raw),before=state();const unlocked=transfer.unlock(1,pending.token,PASS);transfer.disposeOwner(1);await expect(unlocked).rejects.toThrow('取消');expect(state()).toBe(before);
});
it.each(['duplicate-key','unsupported-version','dangling-ref','plaintext-key'] as const)('rejects %s before writes and never tries any network',which=>{
 let raw=bytes(payload());if(which==='duplicate-key')raw=Buffer.from('{"format":"willyou.agents","format":"willyou.agents"}');if(which==='unsupported-version')raw=bytes({...payload(),version:2});if(which==='dangling-ref'){const p=payload();(p.agents[0] as any).provider='absent';raw=bytes(p);}if(which==='plaintext-key')raw=bytes(payload({credentials:{p1:{key:KEY}}}));const before=state();expect(()=>transfer.inspect(1,raw)).toThrow();expect(state()).toBe(before);
});
