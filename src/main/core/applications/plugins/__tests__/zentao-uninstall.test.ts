import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
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
import {PluginHostService} from '../host-service';
import {inspectPluginDirectory} from '../package';
import {ZENTAO_LEGACY_TABLES} from '../legacy-zentao-data';

let root:string,db:Database.Database,secrets:SecretsStore,host:PluginHostService,connectionId:string;
const source=()=>inspectPluginDirectory(resolve('out/plugins/zentao'));
const tables=[...ZENTAO_LEGACY_TABLES,'application_data_resources','application_connections','application_project_settings','application_project_bindings','plugin_connection_defaults','app_secrets'];
const snapshot=()=>tables.map(name=>({name,rows:db.prepare(`SELECT * FROM ${name}`).raw(true).safeIntegers(true).all()}));
const counts=()=>ZENTAO_LEGACY_TABLES.map(name=>(db.prepare(`SELECT count(*) n FROM ${name}`).get() as {n:number}).n);
beforeEach(async()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-zt-uninstall-')));mkdirSync(join(root,'synthetic-keychain'));db=new Database(join(root,'host.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);
  db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','Synthetic',1,1)").run();
  db.prepare("INSERT INTO application_catalog_state VALUES('zentao',1,1,7,'old')").run();
  secrets=new SecretsStore(drizzle(db,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('synthetic:'+s),decrypt:b=>b.toString().slice(10)});secrets.set('zt-secret','SYNTHETIC_ZT');secrets.set('mail-secret','SYNTHETIC_MAIL');
  connectionId=randomUUID();const row={id:connectionId,app_id:'zentao',provider_id:'zentao',name:'Original ZT',config_json:canonicalJson({kind:'zentao',baseUrl:'https://example.invalid/',username:'qa',authMode:'token'}),revision:1,config_revision:1,identity_revision:1,verified_identity_json:canonicalJson({providerId:'zentao',serviceId:'https://example.invalid/',accountId:'uid:1',contractMajor:1}),identity_hash:'a'.repeat(64),secret_ref:'zt-secret',secret_revision:1,policy_revision:1,enabled:1,auth_state:'connected',health:'healthy',created_at:'old',updated_at:'old'};
  db.prepare(`INSERT INTO application_connections(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));db.prepare("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at) VALUES('p1','zentao',1,2,'old')").run();db.prepare("INSERT INTO application_project_bindings VALUES('p1','zentao','zentao',?,1)").run(connectionId);
  const payload={kind:'bug',id:'1',fields:{id:'1',title:'Synthetic original',steps:'Original private body'},actions:[],files:{}},revision=digest(canonicalJson(payload));
  db.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-object','p1',connectionId,1,'bug','1',revision,'detail',canonicalJson(payload),'old');db.prepare('INSERT INTO application_zentao_files VALUES(?,?,?,?,?,?,?)').run('old-object','9',digest(Buffer.from('OLD_ATTACHMENT')),Buffer.from('OLD_ATTACHMENT'),'text/plain',14,'old');db.prepare('INSERT INTO application_zentao_cursors VALUES(?,?,?,?,?,?,?,?,?)').run('old-cursor','p1','{}','bug',50,2,60,'[]','2099-01-01');db.prepare('INSERT INTO application_zentao_operation_objects VALUES(?,?)').run('old-operation','old-object');db.prepare('INSERT INTO application_zentao_operation_resources VALUES(?,?)').run('old-operation','{}');
  for(const app of ['zentao','mail'])db.prepare('INSERT INTO application_data_resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'p1',app,app==='zentao'?'zentao-object-v1':'mail-reference-v1','old-object',revision,'body',1,app+'.read','b'.repeat(64),5,'application/json','a'.repeat(64),randomUUID(),'old');
  host=new PluginHostService(new ResourceStore(db,root),secrets,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(root,'synthetic-keychain')]}});
  const candidate=source();await host.lifecycle.install(candidate,host.lifecycle.inspect(candidate));
});
afterEach(async()=>{vi.restoreAllMocks();await host?.close();db?.close();if(root)rmSync(root,{recursive:true,force:true});});
describe('migrated Zentao uninstall through the real host lifecycle',()=>{
  it('deletes the retained host business copies and only Zentao resource indexes together with private data and credentials',async()=>{
    const mail=db.prepare("SELECT * FROM application_data_resources WHERE app_id='mail'").all();await host.uninstall('zentao',true,host.lifecycle.state('zentao').revision);
    expect(counts()).toEqual([0,0,0,0,0]);expect(db.prepare("SELECT count(*) n FROM application_data_resources WHERE app_id='zentao'").get()).toEqual({n:0});expect(db.prepare("SELECT * FROM application_data_resources WHERE app_id='mail'").all()).toEqual(mail);expect(secrets.get('mail-secret')).toBe('SYNTHETIC_MAIL');expect(secrets.get('zt-secret')).toBeNull();expect(db.prepare("SELECT count(*) n FROM application_connections WHERE app_id='zentao'").get()).toEqual({n:0});expect(existsSync(host.lifecycle.dataDirectory('zentao'))).toBe(false);expect(db.prepare("SELECT migration_version FROM plugin_builtin_migrations WHERE app_id='zentao'").get()).toEqual({migration_version:1});
  });
  it('retains all legacy rows and allows a reviewed keep-data reinstall after the completed migration',async()=>{
    const before=snapshot();await host.uninstall('zentao',false,host.lifecycle.state('zentao').revision);expect(snapshot()).toEqual(before);expect(existsSync(host.lifecycle.dataDirectory('zentao'))).toBe(true);
    const reviewed=await host.inspect('owner',resolve('out/plugins/zentao'),'directory');await host.install('owner',reviewed.token);expect(host.lifecycle.state('zentao')).toMatchObject({installed:true,enabled:true});expect(snapshot()).toEqual(before);
  });
  it('does not resurrect any old body or resource on a reviewed reinstall after deleting data',async()=>{
    await host.uninstall('zentao',true,host.lifecycle.state('zentao').revision);const reviewed=await host.inspect('owner',resolve('out/plugins/zentao'),'directory');await host.install('owner',reviewed.token);const privateDb=new Database(join(host.lifecycle.dataDirectory('zentao'),'zentao.sqlite'),{readonly:true});try{expect(privateDb.prepare('SELECT count(*) n FROM application_zentao_revisions').get()).toEqual({n:0});expect(privateDb.prepare('SELECT count(*) n FROM plugin_resources').get()).toEqual({n:0});}finally{privateDb.close();}expect(counts()).toEqual([0,0,0,0,0]);expect(db.prepare("SELECT count(*) n FROM application_connections WHERE app_id='zentao'").get()).toEqual({n:0});
  });
  it('rolls back every deleted legacy row, readonly seal, private directory and metadata when cleanup fails midway',async()=>{
    const before=snapshot();db.exec("CREATE TRIGGER controlled_legacy_failure BEFORE DELETE ON application_zentao_revisions BEGIN SELECT RAISE(ABORT,'controlled legacy deletion failure'); END");await expect(host.uninstall('zentao',true,host.lifecycle.state('zentao').revision)).rejects.toThrow('controlled legacy deletion failure');expect(snapshot()).toEqual(before);expect(host.lifecycle.state('zentao')).toMatchObject({installed:true,enabled:true});expect(existsSync(host.lifecycle.dataDirectory('zentao'))).toBe(true);expect(()=>db.prepare("UPDATE application_zentao_files SET media_type='changed'").run()).toThrow('read-only');
  });
  it('restores cleaned legacy data if a later encrypted credential deletion fails in the same transaction',async()=>{
    const before=snapshot();vi.spyOn(secrets,'delete').mockImplementation(()=>{throw new Error('controlled secret failure');});await expect(host.uninstall('zentao',true,host.lifecycle.state('zentao').revision)).rejects.toThrow('controlled secret failure');expect(snapshot()).toEqual(before);expect(host.lifecycle.state('zentao')).toMatchObject({installed:true,enabled:true});expect(existsSync(host.lifecycle.dataDirectory('zentao'))).toBe(true);expect(()=>db.prepare('DELETE FROM application_zentao_files').run()).toThrow('read-only');
  });
});
