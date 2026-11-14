import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../../db/schema';
import {runBundledMigrations} from '../../../../db/migrations';
import {SecretsStore} from '../../../../secrets';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginHostService} from '../host-service';
import {fixture} from './fixture';

let root:string,sqlite:Database.Database,secrets:SecretsStore,host:PluginHostService,processes:MacProcessIdentityReader;
function source(version='0.1.0',provider='tracker-api',ui?:{delay?:number;invalid?:boolean;actions?:boolean}){
  const f=fixture();f.manifest.version=version;f.manifest.providers[0].id=provider;f.manifest.capabilities['demo-tracker.items.list'].slots=[provider];
  if(ui){Object.assign(f.manifest.capabilities,{'demo-tracker.hidden.list':{...f.manifest.capabilities['demo-tracker.items.list'],title:'Not a page read'},'demo-tracker.items.add':{...f.manifest.capabilities['demo-tracker.items.list'],title:'Write',semantics:'write',retry:'never'}});Object.assign(f.manifest.capabilities['demo-tracker.items.list'],{agentVisible:false});}
  if(ui?.actions){Object.assign(f.manifest.ui.panels[0],{rowActions:[{kind:'insertTerminal',title:'引用',payload:{reference:'{row.id}'}}]});Object.assign(f.manifest.providers[0],{secret:{title:'Synthetic Key'}});}
  f.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);const result=m.method==='initialize'?{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:${JSON.stringify(version)}}:${ui?.invalid?'{}':ui?.actions?'{items:[{id:"1",title:"Synthetic original"}]}':'{items:[]}'};setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'),m.method==='execute'?${ui?.delay??0}:0);});`));
  const dir=join(root,'sources',version+'-'+provider);for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}return dir;
}
const project=(id:string)=>sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,'Synthetic '+id);
const inspect=(version='0.1.0',owner='renderer-1')=>host.inspect(owner,source(version),'directory');
const install=async(version='0.1.0')=>{const review=await inspect(version);return host.install('renderer-1',review.token);};
function seedConnection(key:string,value='SYNTHETIC'){
  const id=randomUUID(),now=new Date().toISOString();secrets.set(key,value);
    const identity=JSON.stringify({providerId:'tracker-api',serviceId:'synthetic',accountId:'synthetic',contractMajor:1});
    const row={id,app_id:'demo-tracker',provider_id:'tracker-api',name:'Synthetic',config_schema_version:1,config_json:'{"kind":"tracker-api","baseUrl":"http://127.0.0.1"}',revision:1,config_revision:1,identity_revision:1,verified_identity_json:identity,identity_hash:'a'.repeat(64),secret_ref:key,secret_revision:1,policy_revision:1,enabled:1,auth_state:'connected',health:'healthy',cleanup_pending:0,created_at:now,updated_at:now};
    sqlite.prepare('INSERT INTO application_connections('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
    sqlite.prepare("INSERT INTO application_project_bindings VALUES('p1','demo-tracker','tracker-api',?,1)").run(id);
  return id;
}
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-host-')));mkdirSync(join(root,'keychain'));
  sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);project('p1');project('p2');
  secrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from('synthetic:'+s),decrypt:b=>b.toString().slice('synthetic:'.length)});
  processes=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
  host=new PluginHostService(new ResourceStore(sqlite,root),secrets,{processes,runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(root,'keychain')]}});
});

describe('declaration UI reads through project authority and the real sandbox runtime',()=>{
  async function ready(options:{delay?:number;invalid?:boolean;actions?:boolean}={}){
    const review=await host.inspect('renderer-1',source('0.1.0','tracker-api',options),'directory');await host.install('renderer-1',review.token);seedConnection('ui-synthetic');
    return{requestId:randomUUID(),projectId:'p1',appId:'demo-tracker',panelId:'items',packageHash:host.catalog()[0].hash!,capability:'demo-tracker.items.list',input:{}};
  }
  it('permits a declared UI-only read, returns only public connection summary and records UI provenance without a fake run',async()=>{
    const input=await ready(),reply=await host.ui.read('renderer-1',input);expect(reply).toMatchObject({requestId:input.requestId,packageHash:input.packageHash,value:{items:[]},connectionSummary:{baseUrl:'http://127.0.0.1'}});
    const row=sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(reply.operationId) as Record<string,unknown>;expect(row).toMatchObject({caller_kind:'ui',scope_kind:'project',project_id:'p1',task_id:null,run_id:null,state:'succeeded',semantics:'read',attempt_count:1});expect(JSON.stringify(row)).not.toContain('ui-synthetic');expect(JSON.stringify(reply)).not.toContain('secret');
  });
  it('binds declaration actions to the actual sandbox read and connection revision without decrypting credentials or replaying the read',async()=>{
    const input=await ready({actions:true}),get=vi.spyOn(secrets,'get'),reply=await host.ui.read('renderer-1',input);expect(reply.actionReceipt).toBeTruthy();expect(get).toHaveBeenCalledTimes(1);get.mockClear();
    const request={receiptId:reply.actionReceipt!,actionIndex:0,row:{receiptId:reply.actionReceipt!,index:0}},prepared=host.ui.actions.prepare('renderer-1',request),proof=host.ui.actions.proof('renderer-1',prepared.id);expect(prepared).toMatchObject({kind:'insertTerminal'});proof.assert();expect(get).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT count(*) n FROM application_data_operations').get()).toEqual({n:1});expect(()=>host.ui.actions.prepare('renderer-2',request)).toThrow();
    sqlite.prepare("UPDATE application_connections SET revision=revision+1,config_revision=config_revision+1 WHERE app_id='demo-tracker'").run();expect(()=>proof.assert()).toThrow();expect(()=>host.ui.actions.prepare('renderer-1',request)).toThrow();expect(get).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT state,attempt_count FROM application_data_operations').get()).toEqual({state:'succeeded',attempt_count:1});
  });
  it('rejects hidden, write, stale-page and invalid-input calls before recording or executing a read',async()=>{
    const input=await ready();for(const changes of[{capability:'demo-tracker.hidden.list'},{capability:'demo-tracker.items.add'},{panelId:'not-declared'},{packageHash:'f'.repeat(64)},{input:{extra:'not permitted'}}])await expect(host.ui.read('renderer-1',{...input,requestId:randomUUID(),...changes})).rejects.toBeTruthy();
    expect(sqlite.prepare('SELECT count(*) AS n FROM application_data_operations').get()).toEqual({n:0});expect(sqlite.prepare("SELECT count(*) AS n FROM plugin_runtime_leases WHERE kind='invocation' AND pid IS NOT NULL").get()).toEqual({n:0});
  });
  it('refuses another project without silently substituting its connection',async()=>{
    const input=await ready();await expect(host.ui.read('renderer-1',{...input,projectId:'p2'})).rejects.toMatchObject({code:'AUTH_REQUIRED'});
    sqlite.prepare("UPDATE application_project_settings SET enabled=0 WHERE project_id='p1' AND app_id='demo-tracker'").run();await expect(host.ui.read('renderer-1',input)).rejects.toMatchObject({code:'APP_NOT_ENABLED'});
  });
  it('prepares public page metadata without decrypting credentials or dispatching a child; old page scopes fail closed',async()=>{
    const input=await ready(),get=vi.spyOn(secrets,'get'),context=await host.ui.context({projectId:input.projectId,appId:input.appId,panelId:input.panelId,packageHash:input.packageHash});
    expect(context).toMatchObject({connectionSummary:{baseUrl:'http://127.0.0.1'}});expect(get).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT count(*) AS n FROM plugin_runtime_leases WHERE kind='invocation' AND pid IS NOT NULL").get()).toEqual({n:0});
    sqlite.prepare("UPDATE application_connections SET revision=revision+1,config_revision=config_revision+1 WHERE app_id='demo-tracker'").run();
    await expect(host.ui.read('renderer-1',{...input,connectionScope:context.connectionScope})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(sqlite.prepare('SELECT count(*) AS n FROM application_data_operations').get()).toEqual({n:0});
  });
it('T077 page metadata separates host connection name/mode when public config and account are identical',async()=>{
 const input=await ready({actions:true});
 const binding=sqlite.prepare("SELECT slot,connection_id FROM application_project_bindings WHERE project_id='p1' AND app_id='demo-tracker'").get() as {slot:string;connection_id:string};
 sqlite.prepare('UPDATE application_connections SET name=? WHERE id=?').run('T077 connection A',binding.connection_id);
 sqlite.prepare("INSERT OR REPLACE INTO plugin_connection_defaults VALUES('demo-tracker',?,1)").run(binding.connection_id);
 sqlite.prepare("INSERT INTO plugin_project_preferences VALUES('p1','demo-tracker','follow') ON CONFLICT(project_id,app_id) DO UPDATE SET mode='follow'").run();
 const get=vi.spyOn(secrets,'get'),contextInput={projectId:input.projectId,appId:input.appId,panelId:input.panelId,packageHash:input.packageHash};
 const first=await host.ui.context(contextInput);
 expect(first).toMatchObject({connectionSelection:{mode:'follow',connections:[{slot:binding.slot,connectionId:binding.connection_id,name:'T077 connection A'}]}});
 const old=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(binding.connection_id) as Record<string,unknown>;
 const next:Record<string,unknown>&{id:string;name:string}={...old,id:randomUUID(),name:'T077 connection B'};
 sqlite.prepare('INSERT INTO application_connections('+Object.keys(next).join(',')+') VALUES('+Object.keys(next).map(()=>'?').join(',')+')').run(...Object.values(next));
 // The same actual verified account/config and public summary, with a different real connection and project selection.
 expect(next.config_json).toEqual(old.config_json);expect(next.verified_identity_json).toEqual(old.verified_identity_json);
 sqlite.prepare("UPDATE application_project_bindings SET connection_id=? WHERE project_id='p1' AND app_id='demo-tracker'").run(next.id);
 sqlite.prepare("UPDATE plugin_project_preferences SET mode='individual' WHERE project_id='p1' AND app_id='demo-tracker'").run();
 sqlite.prepare("UPDATE application_project_settings SET binding_revision=binding_revision+1 WHERE project_id='p1' AND app_id='demo-tracker'").run();
 const second=await host.ui.context(contextInput);
 expect(second).toMatchObject({connectionSelection:{mode:'individual',connections:[{slot:binding.slot,connectionId:next.id,name:'T077 connection B'}]}});
 expect(first).toMatchObject({connectionSelection:{mode:'follow',connections:[{name:'T077 connection A'}]}});
 expect(first.connectionSummary).toEqual(second.connectionSummary);expect(second.connectionSummary).toEqual({baseUrl:'http://127.0.0.1'});
 expect(first.connectionScope).not.toBe(second.connectionScope);
 expect(JSON.stringify([first,second])).not.toContain('ui-synthetic');expect(get).not.toHaveBeenCalled();
 expect(sqlite.prepare("SELECT count(*) n FROM plugin_runtime_leases WHERE kind='invocation' AND pid IS NOT NULL").get()).toEqual({n:0});
});

  it('discards a result after the project connection changed in flight',async()=>{
    const input=await ready({delay:150}),result=host.ui.read('renderer-1',input);const rejected=expect(result).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await vi.waitFor(()=>expect(sqlite.prepare("SELECT count(*) AS n FROM application_data_operations WHERE state='running'").get()).toEqual({n:1}));
    sqlite.prepare("UPDATE application_project_settings SET binding_revision=binding_revision+1 WHERE project_id='p1' AND app_id='demo-tracker'").run();await rejected;
    expect(sqlite.prepare('SELECT state,error_code FROM application_data_operations').get()).toEqual({state:'failed',error_code:'REVISION_CONFLICT'});
  });
  it('binds cancellation to its renderer, rejects duplicate requests, and cancels without replay',async()=>{
    const input=await ready({delay:200}),result=host.ui.read('renderer-1',input);const rejected=expect(result).rejects.toMatchObject({code:'CANCELED'});
    expect(host.ui.cancel('renderer-2',input.requestId)).toEqual({cancelled:false});expect(()=>host.ui.read('renderer-1',input)).toThrow('正在执行');
    await vi.waitFor(()=>expect(sqlite.prepare("SELECT count(*) AS n FROM application_data_operations WHERE state='running'").get()).toEqual({n:1}));expect(host.ui.cancel('renderer-1',input.requestId)).toEqual({cancelled:true});await rejected;
    expect(sqlite.prepare('SELECT state,attempt_count FROM application_data_operations').get()).toEqual({state:'cancelled',attempt_count:1});
  });
  it('does not turn a malformed plugin result into an empty successful page',async()=>{
    const input=await ready({invalid:true});await expect(host.ui.read('renderer-1',input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(sqlite.prepare('SELECT state FROM application_data_operations').get()).toEqual({state:'failed'});
  });
  it('recovers only an authenticated dead UI read owner, never a live or unknown host and never replays',async()=>{
    const input=await ready(),reply=await host.ui.read('renderer-1',input);expect(sqlite.prepare('SELECT count(*) AS n FROM plugin_ui_reads').get()).toEqual({n:0});
    sqlite.prepare("UPDATE application_data_operations SET state='running',ended_at=NULL WHERE operation_id=?").run(reply.operationId);
    sqlite.prepare('INSERT INTO plugin_ui_reads VALUES(?,?,?,?)').run(reply.operationId,randomUUID(),12345,'darwin-proc-v1:1700000000:100');
    const state=vi.spyOn(processes,'state');try{
      state.mockReturnValue('running');expect(host.ui.recover()).toEqual({released:[],pending:[reply.operationId]});
      state.mockReturnValue('unknown');expect(host.ui.recover()).toEqual({released:[],pending:[reply.operationId]});
      state.mockReturnValue('stopped');expect(host.ui.recover()).toEqual({released:[reply.operationId],pending:[]});expect(host.ui.recover()).toEqual({released:[],pending:[]});
      expect(sqlite.prepare('SELECT state,attempt_count FROM application_data_operations').get()).toEqual({state:'cancelled',attempt_count:1});expect(state).toHaveBeenLastCalledWith({pid:12345,startedAt:'darwin-proc-v1:1700000000:100'});
    }finally{state.mockRestore();}
  });
});
afterEach(async()=>{await host?.close();sqlite?.close();rmSync(root,{recursive:true,force:true});});

describe('main-process plugin management with the real lifecycle and host metadata',()=>{
  it('makes inspection side-effect free, binds confirmation to the renderer and installs the exact reviewed bytes',async()=>{
    const dir=source(),review=await host.inspect('renderer-1',dir,'directory');expect(host.catalog()).toEqual([]);expect(sqlite.prepare("SELECT 1 FROM application_host_applications WHERE app_id='demo-tracker'").get()).toBeUndefined();
    await expect(host.install('renderer-2',review.token)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
    writeFileSync(join(dir,'runtime/main.mjs'),'SOURCE CHANGED AFTER REVIEW');
    const state=await host.install('renderer-1',review.token);expect(state).toMatchObject({installed:true,enabled:true,hash:review.plan.hash,version:'0.1.0'});
    expect(host.catalog()[0]).toMatchObject({displayName:'Demo Tracker',version:'0.1.0'});expect(host.lifecycle.packages.get(state.hash!).plugin.files.get('runtime/main.mjs')!.toString()).not.toContain('SOURCE CHANGED');
    await expect(host.install('renderer-1',review.token)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
    expect(sqlite.prepare("SELECT project_id,enabled FROM application_project_settings WHERE app_id='demo-tracker' ORDER BY project_id").all()).toEqual([{project_id:'p1',enabled:1},{project_id:'p2',enabled:1}]);
  });
  it('refuses a stale update confirmation instead of approving a changed lifecycle revision',async()=>{
    await install();const update=await inspect('0.2.0');await host.setEnabled('demo-tracker',false,host.catalog()[0].revision);
    await expect(host.install('renderer-1',update.token)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});expect(host.catalog()[0]).toMatchObject({version:'0.1.0',enabled:false});
  });
  it('rolls back package/data activation when a provider collides with another host application',async()=>{
    await expect(host.inspect('renderer-1',source('0.1.0','smtp'),'directory')).rejects.toMatchObject({code:'CONFIG_INCOMPATIBLE'});
    const review=await host.inspect('renderer-1',source(),'directory');
    sqlite.prepare("INSERT INTO application_host_applications VALUES('other-plugin')").run();sqlite.prepare("INSERT INTO application_host_providers VALUES('tracker-api','other-plugin',1)").run();
    await expect(host.install('renderer-1',review.token)).rejects.toMatchObject({code:'CONFIG_INCOMPATIBLE'});expect(host.catalog()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM application_catalog_state WHERE app_id='demo-tracker'").get()).toBeUndefined();expect(existsSync(host.lifecycle.dataDirectory('demo-tracker'))).toBe(false);
    expect(sqlite.prepare("SELECT app_id FROM application_host_providers WHERE provider_id='tracker-api'").get()).toEqual({app_id:'other-plugin'});
  });
  it('preserves individual project switches across keep-data uninstall/reinstall and enables new projects by default',async()=>{
    await install();sqlite.prepare("UPDATE application_project_settings SET enabled=0 WHERE project_id='p2' AND app_id='demo-tracker'").run();
    await host.uninstall('demo-tracker',false,host.catalog()[0].revision);expect(host.catalog()).toEqual([]);
    await install();expect(host.selections('p1')).toHaveLength(1);expect(host.selections('p2')).toEqual([]);
    project('p3');expect(host.selections('p3')).toHaveLength(1);expect(sqlite.prepare("SELECT enabled FROM application_project_settings WHERE project_id='p2' AND app_id='demo-tracker'").get()).toEqual({enabled:0});
  });
  it('deletes actual connection rows and encrypted secret rows in the lifecycle transaction',async()=>{
    await install();const id=seedConnection('synthetic-plugin-key');secrets.set('unrelated-synthetic-key','KEEP');
    await host.uninstall('demo-tracker',true,host.catalog()[0].revision);
    expect(sqlite.prepare('SELECT 1 FROM application_connections WHERE id=?').get(id)).toBeUndefined();expect(secrets.has('synthetic-plugin-key')).toBe(false);expect(secrets.get('unrelated-synthetic-key')).toBe('KEEP');
    expect(sqlite.prepare("SELECT 1 FROM application_project_settings WHERE app_id='demo-tracker'").get()).toBeUndefined();expect(existsSync(host.lifecycle.dataDirectory('demo-tracker'))).toBe(false);
  });
  it('retains all connection/secret data when a SQL deletion fault prevents uninstall commit',async()=>{
    await install();const id=seedConnection('synthetic-rollback-key','ORIGINAL');
    // A real SQL delete failure must roll back the encrypted rows, not just a callback's in-memory map.
    sqlite.exec("CREATE TRIGGER fail_plugin_delete BEFORE DELETE ON application_connections WHEN OLD.app_id='demo-tracker' BEGIN SELECT RAISE(ABORT,'synthetic delete failure'); END");
    await expect(host.uninstall('demo-tracker',true,host.catalog()[0].revision)).rejects.toThrow('synthetic delete failure');
    expect(host.catalog()[0]).toMatchObject({installed:true,enabled:true});expect(secrets.get('synthetic-rollback-key')).toBe('ORIGINAL');expect(sqlite.prepare('SELECT id FROM application_connections WHERE id=?').get(id)).toEqual({id});expect(sqlite.prepare("SELECT connection_id FROM application_project_bindings WHERE project_id='p1' AND app_id='demo-tracker'").get()).toEqual({connection_id:id});expect(existsSync(host.lifecycle.dataDirectory('demo-tracker'))).toBe(true);
  });
  it('discards only its renderer inspection and requires a new review afterwards',async()=>{
    const review=await inspect();host.discard('renderer-2',review.token);await expect(host.install('renderer-2',review.token)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
    host.discard('renderer-1',review.token);await expect(host.install('renderer-1',review.token)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
  });
});
