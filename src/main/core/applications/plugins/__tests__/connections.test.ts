import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as schema from '../../../../db/schema';
import {runBundledMigrations} from '../../../../db/migrations';
import {SecretsStore} from '../../../../secrets';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginHostService} from '../host-service';
import {fixture} from './fixture';

let root:string,sqlite:Database.Database,secrets:SecretsStore,host:PluginHostService;
const target=()=>({appId:'demo-tracker',packageHash:host.catalog()[0].hash!});
const project=(id:string)=>sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,'Project '+id);
async function create(name:string,owner='owner',secret='SYNTHETIC_'+name){const candidate=await host.connections.test(owner,{...target(),requestId:randomUUID(),name,expectedRevision:0,providerId:'tracker-api',config:{baseUrl:'https://example.invalid',username:name},authMode:'token',secret});return host.connections.save(owner,{...target(),operationId:candidate.operationId,candidateHash:candidate.candidateHash});}
const view=(id:string)=>host.connections.project(target(),id);
const set=(id:string,mode:'follow'|'individual',connectionId?:string,enabled=true)=>host.connections.setProject({...target(),projectId:id,mode,connectionId,enabled,expectedRevision:view(id).binding_revision});
beforeEach(async()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-connections-')));sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);for(const id of ['p1','p2','p3'])project(id);
  secrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('encrypted:'+s.split('').reverse().join('')),decrypt:b=>b.toString().slice(10).split('').reverse().join('')});
  const keychain=join(root,'synthetic-keychain');mkdirSync(keychain);host=new PluginHostService(new ResourceStore(sqlite,root),secrets,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[keychain]}});
  const f=fixture();Object.assign(f.manifest.providers[0],{config:{type:'object',additionalProperties:false,required:['baseUrl','username'],properties:{baseUrl:{type:'string'},username:{type:'string'}}},summaryFields:['baseUrl','username'],secret:{title:'Key',modes:['token','password']}});
  f.files.set('runtime/main.mjs',Buffer.from(String.raw`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;if(m.method==='initialize')result={protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0'};else if(m.method==='verify'){if(!['token','password'].includes(m.params.authMode)||m.params.secret==='bad'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'AUTH_FAILED do-not-echo-secret'}})+'\n');return;}result={identity:{serviceId:m.params.config.baseUrl,accountId:m.params.config.username}};}else result={items:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');});`));
  const source=join(root,'source');for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),bytes);}
  const reviewed=await host.inspect('owner',source,'directory');await host.install('owner',reviewed.token);
});
afterEach(async()=>{await host?.close();sqlite?.close();rmSync(root,{recursive:true,force:true});});
describe('external plugin connections with actual encrypted SQL and sandbox verification',()=>{
  it('tests without selecting, saves atomically with the first default, and never returns or persists plaintext credentials',async()=>{
    const candidate=await host.connections.test('owner',{...target(),requestId:randomUUID(),name:'A',expectedRevision:0,providerId:'tracker-api',config:{baseUrl:'https://example.invalid',username:'A'},authMode:'token',secret:'SYNTHETIC_UNIQUE_SECRET'});
    expect(host.connections.list(target()).connections).toEqual([]);expect(view('p1').connectionId).toBeNull();expect(JSON.stringify(candidate)).not.toContain('SYNTHETIC_UNIQUE_SECRET');expect(JSON.stringify(sqlite.prepare('SELECT * FROM application_secret_changes').all())).not.toContain('SYNTHETIC_UNIQUE_SECRET');expect(JSON.stringify(sqlite.prepare('SELECT * FROM app_secrets').all())).not.toContain('SYNTHETIC_UNIQUE_SECRET');
    const saved=await host.connections.save('owner',{...target(),operationId:candidate.operationId,candidateHash:candidate.candidateHash});expect(saved).toMatchObject({name:'A',hasSecret:true,identity:{accountId:'A'}});expect(host.connections.list(target()).default.connection_id).toBe(saved.id);for(const id of ['p1','p2','p3'])expect(view(id)).toMatchObject({mode:'follow',connectionId:saved.id});expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('keeps test receipts in their owner and pinned package, rejects credentials/configuration errors, and discards staged secrets',async()=>{
    const input={...target(),requestId:randomUUID(),name:'A',expectedRevision:0,providerId:'tracker-api',config:{baseUrl:'https://example.invalid',username:'A'},secret:'SYNTHETIC'};
    const candidate=await host.connections.test('owner',input),request={...target(),operationId:candidate.operationId,candidateHash:candidate.candidateHash};await expect(host.connections.save('other',request)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});await host.connections.discard('other',candidate.operationId);expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:1});await host.connections.discard('owner',candidate.operationId);expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});
    await expect(host.connections.test('owner',{...input,requestId:randomUUID(),secret:'bad'})).rejects.toBeTruthy();expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});expect(host.connections.list(target()).connections).toEqual([]);
    expect(()=>host.connections.test('owner',{...input,config:{...input.config,kind:'foreign'}})).toThrow();
  });
  it('distinguishes explicitly individual selection of the current default and excludes closed projects from the change preview',async()=>{
    const a=await create('A'),b=await create('B');expect(host.connections.list(target()).default.connection_id).toBe(a.id);await set('p2','individual',a.id);await set('p3','follow',undefined,false);
    const planned=host.connections.planDefault({...target(),connectionId:b.id});expect(planned.synchronized).toEqual([{id:'p1',name:'Project p1'}]);expect(planned.unchanged).toEqual([{id:'p2',name:'Project p2'}]);await expect(host.connections.setDefault({...target(),connectionId:b.id})).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
    await host.connections.setDefault({...target(),connectionId:b.id,planHash:planned.planHash});expect(view('p1')).toMatchObject({mode:'follow',connectionId:b.id});expect(view('p2')).toMatchObject({mode:'individual',connectionId:a.id});expect(view('p3')).toMatchObject({enabled:0,connectionId:a.id});await set('p3','follow');expect(view('p3').connectionId).toBe(b.id);
    await set('p2','follow');expect(view('p2').connectionId).toBe(b.id);project('p4');host.selections('p4');expect(view('p4')).toMatchObject({mode:'follow',connectionId:b.id});
  });
  it('rejects stale project and default impact receipts without partially changing bindings',async()=>{
    const a=await create('A'),b=await create('B'),planned=host.connections.planDefault({...target(),connectionId:b.id}),old=view('p1');await set('p2','individual',a.id);
    await expect(host.connections.setDefault({...target(),connectionId:b.id,planHash:planned.planHash})).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});expect(view('p1').connectionId).toBe(a.id);expect(host.connections.list(target()).default.connection_id).toBe(a.id);
    await set('p1','individual',b.id);await expect(host.connections.setProject({...target(),projectId:'p1',expectedRevision:old.binding_revision,mode:'follow',enabled:true})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(view('p1').connectionId).toBe(b.id);
  });
  it('requires a replacement default, resets deleted individual choices to follow, and deletes the credential in the same SQL transaction',async()=>{
    const a=await create('A'),b=await create('B');await set('p2','individual',a.id);expect(()=>host.connections.planDelete({...target(),connectionId:a.id})).toThrow('请选择新默认');const planned=host.connections.planDelete({...target(),connectionId:a.id,replacementId:b.id});expect(planned.individual).toEqual([{id:'p2',name:'Project p2'}]);
    await host.connections.delete({...target(),connectionId:a.id,replacementId:b.id,planHash:planned.planHash});expect(host.connections.list(target()).default.connection_id).toBe(b.id);expect(view('p2')).toMatchObject({mode:'follow',connectionId:b.id});expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:1});
    const last=host.connections.planDelete({...target(),connectionId:b.id});await host.connections.delete({...target(),connectionId:b.id,planHash:last.planHash});expect(host.connections.list(target()).connections).toEqual([]);expect(host.connections.list(target()).default.connection_id).toBeNull();expect(view('p1').connectionId).toBeNull();expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});
  });
  it('rolls back connection insertion and staged credentials if default synchronization fails',async()=>{
    const candidate=await host.connections.test('owner',{...target(),requestId:randomUUID(),name:'A',expectedRevision:0,providerId:'tracker-api',config:{baseUrl:'https://example.invalid',username:'A'},authMode:'password',secret:'SYNTHETIC'});
    sqlite.exec("CREATE TRIGGER controlled_default_failure BEFORE UPDATE ON plugin_connection_defaults BEGIN SELECT RAISE(FAIL,'controlled default failure'); END;");await expect(host.connections.save('owner',{...target(),operationId:candidate.operationId,candidateHash:candidate.candidateHash})).rejects.toThrow();expect(host.connections.list(target()).connections).toEqual([]);expect(view('p1').connectionId).toBeNull();expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});
  });
  it('retains connection, defaults, project bindings and ciphertext when credential deletion fails',async()=>{
    const a=await create('A'),planned=host.connections.planDelete({...target(),connectionId:a.id}),del=vi.spyOn(secrets,'delete').mockImplementation(()=>{throw new Error('controlled secret failure');});await expect(host.connections.delete({...target(),connectionId:a.id,planHash:planned.planHash})).rejects.toThrow();del.mockRestore();expect(host.connections.list(target()).default.connection_id).toBe(a.id);expect(view('p1').connectionId).toBe(a.id);expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:1});
  });
  it('initializes a newly created project on its first settings read and restores persisted individual state after host recovery',async()=>{
    const a=await create('A'),b=await create('B');project('p4');expect(view('p4')).toMatchObject({mode:'follow',connectionId:a.id});await set('p4','individual',a.id);
    const plan=host.connections.planDefault({...target(),connectionId:b.id});await host.connections.setDefault({...target(),connectionId:b.id,planHash:plan.planHash});await host.close();
    host=new PluginHostService(new ResourceStore(sqlite,root),secrets,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(root,'synthetic-keychain')]}});await host.recover();expect(host.connections.list(target()).default.connection_id).toBe(b.id);expect(view('p4')).toMatchObject({mode:'individual',connectionId:a.id});expect(view('p1')).toMatchObject({mode:'follow',connectionId:b.id});
  });
  it('keeps an incompatible saved connection visible and deletable without decrypting it or substituting a different default',async()=>{
    const a=await create('A'),b=await create('B');sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run('{"kind":"tracker-api","username":42}',b.id);const get=vi.spyOn(secrets,'get');
    const listed=host.connections.list(target());expect(listed.connections.find(c=>c.id===b.id)).toMatchObject({name:'B',issue:expect.stringContaining('不兼容')});expect(listed.default.connection_id).toBe(a.id);expect(()=>host.connections.planDefault({...target(),connectionId:b.id})).toThrow();expect(get).not.toHaveBeenCalled();
    const plan=host.connections.planDelete({...target(),connectionId:b.id});await host.connections.delete({...target(),connectionId:b.id,planHash:plan.planHash});expect(host.connections.list(target()).connections.map(c=>c.id)).toEqual([a.id]);expect(get).not.toHaveBeenCalled();
  });
});
