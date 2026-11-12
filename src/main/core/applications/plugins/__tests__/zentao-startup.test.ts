import {randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
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
import {canonicalJson,digest} from '../../manifest';
import {PluginHostService,type PluginHostOptions} from '../host-service';
import {hasExternalPluginOwner} from '../legacy-routing';

let root:string,db:Database.Database,secrets:SecretsStore,host:PluginHostService;
const bundle=resolve('out/plugins/zentao');
function open(options:Partial<PluginHostOptions>={}){
  return new PluginHostService(new ResourceStore(db,root),secrets,{bundledZentao:bundle,processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(root,'synthetic-keychain')]},...options});
}
const target=()=>({appId:'zentao',packageHash:host.lifecycle.state('zentao').hash!});
function connection(name:string){
  const id=randomUUID(),secretRef='zt-'+name,identity={providerId:'zentao',serviceId:'https://example.invalid/',accountId:'uid:'+name,contractMajor:1};secrets.set(secretRef,'SYNTHETIC_'+name);
  const row={id,app_id:'zentao',provider_id:'zentao',name,config_json:canonicalJson({kind:'zentao',baseUrl:'https://example.invalid/',username:name,authMode:'token'}),revision:3,config_revision:2,identity_revision:4,verified_identity_json:canonicalJson(identity),identity_hash:digest(canonicalJson(identity)),secret_ref:secretRef,secret_revision:2,policy_revision:5,enabled:1,auth_state:'connected',health:'healthy',created_at:'old',updated_at:'old'};
  db.prepare(`INSERT INTO application_connections(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));return id;
}
function project(id:string,enabled:boolean,connectionId?:string){
  db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,'Project '+id);
  db.prepare('INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at,policy_revision) VALUES(?,?,?,7,?,9)').run(id,'zentao',enabled?1:0,'old');
  if(connectionId)db.prepare("INSERT INTO application_project_bindings VALUES(?,'zentao','zentao',?,4)").run(id,connectionId);
}
const controls=()=>['application_connections','application_project_settings','application_project_bindings','app_secrets'].map(name=>({name,rows:db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).raw(true).safeIntegers(true).all()}));
async function reopen(options:Partial<PluginHostOptions>={}){await host.close();host=open(options);await host.recover();}
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-zt-startup-')));mkdirSync(join(root,'synthetic-keychain'));db=new Database(join(root,'host.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);
  secrets=new SecretsStore(drizzle(db,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('synthetic:'+s),decrypt:b=>b.toString().slice(10)});host=open();
});
afterEach(async()=>{vi.restoreAllMocks();await host?.close();db?.close();if(root)rmSync(root,{recursive:true,force:true});});

describe('bundled Zentao startup migration through the production host',()=>{
  it('preserves original connection identities, ciphertext and explicit project choices without reading credentials',async()=>{
    db.prepare("INSERT INTO application_catalog_state VALUES('zentao',1,1,7,'old')").run();const a=connection('A'),b=connection('B');project('p1',true,a);project('p2',false,b);project('p3',true);const before=controls(),get=vi.spyOn(secrets,'get');
    await host.recover();expect(host.startupStatus()).toMatchObject({state:'migrated',fallbackBuiltin:false,errorCode:null});expect(host.lifecycle.state('zentao')).toMatchObject({installed:true,enabled:true});expect(controls()).toEqual(before);expect(get).not.toHaveBeenCalled();
    const listed=host.connections.list(target());expect(listed.requiresDefault).toBe(true);expect(listed.default.connection_id).toBeNull();expect(listed.connections.map(c=>c.id).sort()).toEqual([a,b].sort());
    expect(host.connections.project(target(),'p1')).toMatchObject({mode:'individual',connectionId:a,enabled:1});expect(host.connections.project(target(),'p2')).toMatchObject({mode:'individual',connectionId:b,enabled:0});expect(host.connections.project(target(),'p3')).toMatchObject({mode:'follow',connectionId:null});
    const plan=host.connections.planDefault({...target(),connectionId:b});expect(plan.synchronized).toEqual([{id:'p3',name:'Project p3'}]);await host.connections.setDefault({...target(),connectionId:b,planHash:plan.planHash});expect(host.connections.project(target(),'p1').connectionId).toBe(a);expect(host.connections.project(target(),'p2')).toMatchObject({connectionId:b,enabled:0});expect(host.connections.project(target(),'p3').connectionId).toBe(b);expect(get).not.toHaveBeenCalled();expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it.each([false,true])('keeps the original global enabled=%s and chooses only an unambiguous single default',async enabled=>{
    db.prepare("INSERT INTO application_catalog_state VALUES('zentao',1,?,7,'old')").run(enabled?1:0);const a=connection('A');project('p1',false,a);project('p2',true);await host.recover();expect(host.lifecycle.state('zentao').enabled).toBe(enabled);expect(host.connections.list(target())).toMatchObject({requiresDefault:false,default:{connection_id:a}});expect(host.connections.project(target(),'p1')).toMatchObject({enabled:0,mode:'individual',connectionId:a});expect(host.connections.project(target(),'p2')).toMatchObject({mode:'follow',connectionId:a});
  });
  it('does not silently enable a previously unconfigured builtin and repeated startup is idempotent',async()=>{
    await host.recover();expect(host.lifecycle.state('zentao')).toMatchObject({installed:true,enabled:false});const before=db.prepare("SELECT * FROM plugin_installations WHERE app_id='zentao'").get(),marker=db.prepare("SELECT * FROM plugin_builtin_migrations WHERE app_id='zentao'").get();await host.recover();await reopen();expect(host.startupStatus()).toMatchObject({state:'ready',fallbackBuiltin:false});expect(db.prepare("SELECT * FROM plugin_installations WHERE app_id='zentao'").get()).toEqual(before);expect(db.prepare("SELECT * FROM plugin_builtin_migrations WHERE app_id='zentao'").get()).toEqual(marker);
  });
  it('never downgrades an explicitly updated plugin to the app bundled version on restart',async()=>{
    await host.recover();const newer=join(root,'updated-package');cpSync(bundle,newer,{recursive:true});const file=join(newer,'.willyou-plugin/plugin.json'),manifest=JSON.parse(readFileSync(file,'utf8'));manifest.version='2.0.1';writeFileSync(file,JSON.stringify(manifest));const reviewed=await host.inspect('owner',newer,'directory');await host.install('owner',reviewed.token);const before=host.lifecycle.state('zentao');expect(before.version).toBe('2.0.1');await reopen();expect(host.startupStatus().state).toBe('ready');expect(host.lifecycle.state('zentao')).toEqual(before);
  });
  it.each([false,true])('never automatically reinstalls after explicit uninstall, deleteData=%s',async deleteData=>{
    await host.recover();await host.uninstall('zentao',deleteData,host.lifecycle.state('zentao').revision);const before=host.lifecycle.state('zentao');await reopen();expect(host.startupStatus()).toMatchObject({state:'retained-uninstalled',fallbackBuiltin:false});expect(host.lifecycle.state('zentao')).toEqual(before);expect(host.catalog()).toEqual([]);expect(hasExternalPluginOwner(db,'zentao')).toBe(true);
  });
  it('rolls the second-table failure back, leaves old configuration usable, and retries once a new startup succeeds',async()=>{
    db.prepare("INSERT INTO application_catalog_state VALUES('zentao',1,1,7,'old')").run();const a=connection('A');project('p1',true,a);const before=controls(),catalog=db.prepare("SELECT * FROM application_catalog_state WHERE app_id='zentao'").get();await host.close();host=open({legacyMigrationCheckpoint:table=>{if(table==='application_zentao_files')throw new Error('SYNTHETIC_PRIVATE_FAILURE_DO_NOT_RENDER');}});await host.recover();
    expect(host.startupStatus()).toMatchObject({state:'failed',fallbackBuiltin:true});expect(JSON.stringify(host.startupStatus())).not.toContain('SYNTHETIC_PRIVATE_FAILURE_DO_NOT_RENDER');expect(controls()).toEqual(before);expect(db.prepare("SELECT * FROM application_catalog_state WHERE app_id='zentao'").get()).toEqual(catalog);expect(hasExternalPluginOwner(db,'zentao')).toBe(false);expect(existsSync(host.lifecycle.dataDirectory('zentao'))).toBe(false);expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'willyou_m13_legacy_%'").all()).toEqual([]);
    await reopen();expect(host.startupStatus()).toMatchObject({state:'migrated',fallbackBuiltin:false});expect(controls()).toEqual(before);
  });
  it('preserves a concurrent original connection edit and aborts the stale migration before activation',async()=>{
    db.prepare("INSERT INTO application_catalog_state VALUES('zentao',1,1,7,'old')").run();const a=connection('A');project('p1',true,a);await host.close();host=open({legacyMigrationCheckpoint:table=>{if(table==='application_zentao_files')queueMicrotask(()=>db.prepare('UPDATE application_connections SET name=?,revision=revision+1 WHERE id=?').run('Concurrent user change',a));}});await host.recover();expect(host.startupStatus()).toMatchObject({state:'failed',fallbackBuiltin:true,errorCode:'REVISION_CONFLICT'});expect(db.prepare('SELECT name,revision FROM application_connections WHERE id=?').get(a)).toEqual({name:'Concurrent user change',revision:4});expect(hasExternalPluginOwner(db,'zentao')).toBe(false);await reopen();expect(host.startupStatus().state).toBe('migrated');expect(host.connections.list(target()).connections[0].name).toBe('Concurrent user change');
  });
  it('keeps a missing payload failure safe without activating or hiding the builtin',async()=>{
    await host.close();host=open({bundledZentao:join(root,'missing-payload')});await host.recover();expect(host.startupStatus()).toMatchObject({state:'failed',fallbackBuiltin:true});expect(host.startupStatus().message).not.toContain(root);expect(hasExternalPluginOwner(db,'zentao')).toBe(false);expect(host.lifecycle.state('zentao').installed).toBe(false);
  });
  it('does not resurrect builtin routing if installation and migration records disagree',async()=>{
    await host.recover();db.prepare("DELETE FROM plugin_installations WHERE app_id='zentao'").run();await reopen();expect(host.startupStatus()).toMatchObject({state:'failed',fallbackBuiltin:false,errorCode:'RESOURCE_RECOVERY_REQUIRED'});expect(hasExternalPluginOwner(db,'zentao')).toBe(true);expect(host.lifecycle.state('zentao').installed).toBe(false);
  });
});
