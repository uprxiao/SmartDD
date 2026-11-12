import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as schema from '../../../../db/schema';
import {runBundledMigrations} from '../../../../db/migrations';
import {SecretsStore} from '../../../../secrets';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginHostService} from '../host-service';
import {inspectPluginDirectory} from '../package';
// @ts-expect-error Public plain-JS package generator; generated files pass the actual validator below.
import {buildDemoPackage} from '../../../../../../scripts/applications/fixtures/m13-demo-package.mjs';

let root:string,sqlite:Database.Database,host:PluginHostService;
const paths=new Map<string,string>();
const target=()=>({appId:'demo-tracker',packageHash:host.lifecycle.state('demo-tracker').hash!});
const connection={'demo-local':{config:{account:'qa-a'}}};
const execute=(capability:string,input:Record<string,unknown>={})=>host.lifecycle.execute('demo-tracker',capability,input,connection);
async function install(version:string){const review=await host.inspect('fixture-preflight',paths.get(version)!,'directory');return host.install('fixture-preflight',review.token);}
async function connect(){
 const candidate=await host.connections.test('fixture-preflight',{...target(),requestId:randomUUID(),expectedRevision:0,name:'Public qa-a',providerId:'demo-local',config:{account:'qa-a'},authMode:'token',secret:'P1_PUBLIC_ONLY'});
 return host.connections.save('fixture-preflight',{...target(),operationId:candidate.operationId,candidateHash:candidate.candidateHash});
}
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-full-demo-')));mkdirSync(join(root,'keychain'));
 sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run('p1','Synthetic P1');
 // Explicit software-only cipher for the public fixture. Not safeStorage evidence.
 const secrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('public-fixture:'+s),decrypt:b=>b.toString().slice('public-fixture:'.length)});
 host=new PluginHostService(new ResourceStore(sqlite,root),secrets,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(root,'keychain')]}});
 paths.clear();for(const [name,options]of[['0.4.0',{}],['0.5.0',{}],['0.6.0',{failInitialize:true}],['drop',{version:'0.5.0',dropDetail:true}]]as const){const path=join(root,name);buildDemoPackage(path,{version:name,...options});paths.set(name,path);}
});
afterEach(async()=>{await host?.close();sqlite?.close();rmSync(root,{recursive:true,force:true});});

describe('full P1 synthetic fixture preflight, not packaged App or default approval acceptance',()=>{
 it('validates all generation variants and a real list/detail/provider declaration without broad permissions',()=>{
  for(const name of paths.keys()){
   const p=inspectPluginDirectory(paths.get(name)!);expect(p.manifest.permissions).toEqual([]);expect(p.manifest.providers[0]).toMatchObject({id:'demo-local',summaryFields:['account'],secret:{modes:['token','password']}});
   if(name==='drop'){expect(p.manifest.ui.panels[0].onRowOpen).toBeUndefined();expect(p.manifest.capabilities['demo-tracker.items.get']).toBeUndefined();}
   else expect(p.manifest.ui.panels[0]).toMatchObject({onRowOpen:{detail:'item'},details:{item:{source:{capability:'demo-tracker.items.get'},sections:[{kind:'fields',from:'fields'}]}}});
  }
 });
 it('verifies the public connection, then supplies nonempty list and detail through the production UI read service',async()=>{
  await install('0.4.0');const saved=await connect();expect(host.connections.project(target(),'p1').connectionId).toBe(saved.id);
  const base={...target(),projectId:'p1',panelId:'items'},context=await host.ui.context(base);
  const list=await host.ui.read('fixture-preflight',{...base,requestId:randomUUID(),connectionScope:context.connectionScope,capability:'demo-tracker.items.list',input:{}});
  expect(list.value).toMatchObject({version:'0.4.0',account:'qa-a',items:[{id:'1',title:'P1 原始待办 中文🙂'}]});expect(list.connectionSummary).toEqual({account:'qa-a'});
  const detail=await host.ui.read('fixture-preflight',{...base,requestId:randomUUID(),connectionScope:context.connectionScope,capability:'demo-tracker.items.get',input:{id:'1'}});
  expect(detail.value).toMatchObject({fields:{id:'1',version:'0.4.0',account:'qa-a',body:expect.stringContaining('私有目录')}});
  expect(JSON.stringify([list,detail])).not.toContain('P1_PUBLIC_ONLY');
  expect(sqlite.prepare('SELECT caller_kind,state,semantics FROM application_data_operations').all()).toEqual([{caller_kind:'ui',state:'succeeded',semantics:'read'},{caller_kind:'ui',state:'succeeded',semantics:'read'}]);
 });
 it('exposes an observable delayed call that completes on the old generation and preserves data across update',async()=>{
  const original=await install('0.4.0');await connect();await execute('demo-tracker.items.add',{title:'P1 keep through update'});
  const file=join(host.lifecycle.dataDirectory('demo-tracker'),'started.jsonl');
  const pending=execute('demo-tracker.items.list',{delayMs:800});
  await vi.waitFor(()=>expect(existsSync(file)&&readFileSync(file,'utf8').includes('"delayMs":800')).toBe(true),{timeout:3000,interval:20});
  const update=install('0.5.0');
  await expect(pending).resolves.toMatchObject({version:'0.4.0',items:[{id:'1'},{id:'2',title:'P1 keep through update'}]});await expect(update).resolves.toMatchObject({version:'0.5.0'});
  await expect(execute('demo-tracker.items.list')).resolves.toMatchObject({version:'0.5.0',items:[{id:'1'},{id:'2',title:'P1 keep through update'}]});
  expect(()=>host.lifecycle.packages.get(original.hash!)).toThrow();
 });
 it('keeps nonempty data, connection and authorization rows when the failing initialization mutates its own candidate copy',async()=>{
  const original=await install('0.4.0');await connect();await execute('demo-tracker.items.add',{title:'P1 original state'});
  const data=join(host.lifecycle.dataDirectory('demo-tracker'),'items.json'),before=readFileSync(data);
  const tables=['application_connections','application_project_settings','application_project_bindings','plugin_connection_defaults','plugin_project_preferences','app_secrets'];
  const snapshot=()=>tables.map(t=>({table:t,rows:sqlite.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()}));const rows=snapshot();
  await expect(install('0.6.0')).rejects.toMatchObject({code:'HOST_INCOMPATIBLE'});
  expect(host.lifecycle.state('demo-tracker')).toMatchObject({hash:original.hash,version:'0.4.0',revision:original.revision});expect(readFileSync(data).equals(before)).toBe(true);expect(snapshot()).toEqual(rows);
  await expect(execute('demo-tracker.items.get',{id:'2'})).resolves.toMatchObject({fields:{title:'P1 original state',version:'0.4.0'}});
 });
 it('reports the actual removed detail capability before any drop variant is installed',async()=>{
  await install('0.4.0');const review=await host.inspect('fixture-preflight',paths.get('drop')!,'directory','demo-tracker');
  expect(review.plan.breakingCapabilities).toContain('demo-tracker.items.get');expect(host.lifecycle.state('demo-tracker').version).toBe('0.4.0');host.discard('fixture-preflight',review.token);
 });
});
