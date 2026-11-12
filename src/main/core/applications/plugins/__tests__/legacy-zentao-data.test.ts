import {mkdtempSync,mkdirSync,realpathSync,rmSync,renameSync,symlinkSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../../db/migrations';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginLifecycle} from '../lifecycle';
import {PluginProcess} from '../process';
import {validatePluginBundle} from '../package';
import {prepareLegacyZentaoData,ZENTAO_LEGACY_TABLES,ZENTAO_PRIVATE_DATABASE} from '../legacy-zentao-data';
import {fixture} from './fixture';

let root:string,db:Database.Database,candidate:string;
const hash='a'.repeat(64),lives:PluginLifecycle[]=[];
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-legacy-zentao-')));db=new Database(join(root,'host.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);candidate=join(root,'candidate');mkdirSync(candidate);
  db.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run('original-object','project-original','connection-original',9007199254740993n,'bug','79291','original-revision','detail','{"fields":{"title":"原始中文🙂"}}','2026-11-11');
  db.prepare('INSERT INTO application_zentao_files VALUES(?,?,?,?,?,?,?)').run('original-object','file-original','original-content',Buffer.from([0,255,128,0,1]),'application/octet-stream',5,'2026-11-11');
  db.prepare('INSERT INTO application_zentao_cursors VALUES(?,?,?,?,?,?,?,?,?)').run('cursor-original','project-original','{"connection":"connection-original"}','bug',50,2,60,'["79291"]','2026-11-12');
  db.prepare('INSERT INTO application_zentao_operation_objects VALUES(?,?)').run('operation-original','original-object');
  db.prepare('INSERT INTO application_zentao_operation_resources VALUES(?,?)').run('operation-original','{"objectId":"original-object","part":"body"}');
  db.prepare('INSERT INTO app_secrets VALUES(?,?)').run('secret-original','FAKE_ENCRYPTED_BYTES');
});
afterEach(async()=>{for(const life of lives.splice(0))await life.close();db.close();rmSync(root,{recursive:true,force:true});});
const open=()=>new Database(join(candidate,ZENTAO_PRIVATE_DATABASE),{readonly:true,fileMustExist:true});
const commit=(work:ReturnType<typeof prepareLegacyZentaoData>,directory=candidate)=>db.transaction(()=>work!.beforeCommit(directory)).immediate();
const raw=(database:Database.Database,table:string)=>database.prepare(`SELECT * FROM ${table}`).raw(true).safeIntegers(true).all();
const marker=()=>db.prepare('SELECT * FROM plugin_builtin_migrations').all();
const sealed=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'willyou_m13_legacy_%'").all();

describe('one-time legacy Zentao private data export',()=>{
  it('preserves two actual connection rows, their ciphertext references and three project authorizations byte for byte',()=>{
    for(const [index,name]of ['connection-a','connection-b'].entries())db.prepare(`INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES(?,'zentao','zentao',?,?,3,2,1,?,?,?,1,4,1,'connected','healthy','old-created','old-updated')`).run(name,name,JSON.stringify({kind:'zentao',baseUrl:'https://example.invalid/',username:'synthetic-'+index,authMode:'token'}),JSON.stringify({providerId:'zentao',serviceId:'https://example.invalid/',accountId:'uid:'+index,contractMajor:1}),'identity-'+index,'secret-original');
    for(let i=0;i<3;i++){const id='project-'+i;db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,id);db.prepare("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,policy_revision,updated_at) VALUES(?,'zentao',?,7,5,'old-updated')").run(id,i===2?0:1);db.prepare("INSERT INTO application_project_bindings VALUES(?,'zentao','zentao',?,1)").run(id,i===1?'connection-b':'connection-a');}
    const tables=['application_connections','application_project_settings','application_project_bindings','app_secrets'],before=tables.map(name=>raw(db,name));commit(prepareLegacyZentaoData(db,candidate,hash));expect(tables.map(name=>raw(db,name))).toEqual(before);const privateDb=open();try{for(const name of tables)expect(()=>privateDb.prepare(`SELECT * FROM ${name}`)).toThrow();}finally{privateDb.close();}
  });
  it('preserves all five tables, exact BLOBs, 64-bit integers, keys and indexes, without copying host secrets',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash)!;expect(work.tables.map(t=>[t.name,t.rows])).toEqual([...ZENTAO_LEGACY_TABLES.map(name=>[name,1]),['plugin_resources',0]]);
    const privateDb=open();try{for(const name of ZENTAO_LEGACY_TABLES)expect(raw(privateDb,name)).toEqual(raw(db,name));expect(privateDb.pragma('foreign_key_check')).toEqual([]);expect(()=>privateDb.prepare('SELECT * FROM app_secrets')).toThrow();expect(privateDb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='application_zentao_revisions_identity'").get()).toBeDefined();}finally{privateDb.close();}
    expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(statSync(join(candidate,ZENTAO_PRIVATE_DATABASE)).mode&0o777).toBe(0o600);commit(work);
    expect(marker()).toMatchObject([{app_id:'zentao',migration_version:1,package_hash:hash,source_hash:work.sourceHash}]);expect(sealed()).toHaveLength(18);expect(db.prepare('SELECT * FROM app_secrets').get()).toEqual({key:'secret-original',secret:'FAKE_ENCRYPTED_BYTES'});
  });
  it('rolls back the entire private copy if the second table fails and keeps the builtin source writable',()=>{
    const before=raw(db,ZENTAO_LEGACY_TABLES[0]);expect(()=>prepareLegacyZentaoData(db,candidate,hash,{afterTable:name=>{if(name==='application_zentao_files')throw new Error('controlled second table failure');}})).toThrow('controlled second table failure');
    const privateDb=open();try{expect(privateDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);}finally{privateDb.close();}
    expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(raw(db,ZENTAO_LEGACY_TABLES[0])).toEqual(before);expect(()=>db.prepare("UPDATE application_zentao_revisions SET fetched_at='still builtin'").run()).not.toThrow();
  });
  it('refuses activation if the old builtin writes during the asynchronous initialization probe',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash);db.prepare("UPDATE application_zentao_revisions SET payload_json='changed by builtin'").run();expect(()=>commit(work)).toThrow('旧禅道数据发生变化');expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(db.prepare('SELECT payload_json FROM application_zentao_revisions').get()).toEqual({payload_json:'changed by builtin'});
  });
  it('refuses activation if the candidate plugin changes an imported value',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash),privateDb=new Database(join(candidate,ZENTAO_PRIVATE_DATABASE));privateDb.prepare("UPDATE application_zentao_files SET bytes=X'FF'").run();privateDb.close();expect(()=>commit(work)).toThrow('初始化改变了迁移副本');expect(marker()).toEqual([]);expect(sealed()).toEqual([]);
  });
  it('rolls migration markers and readonly triggers back with a later activation SQL failure',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash);expect(()=>db.transaction(()=>{work!.beforeCommit(candidate);throw new Error('controlled activation failure');}).immediate()).toThrow('controlled activation failure');expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(()=>db.prepare('DELETE FROM application_zentao_operation_resources').run()).not.toThrow();
  });
  it('is idempotent after successful activation and never resurrects deleted private data from retained host history',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash);commit(work);const before=marker(),again=join(root,'again');mkdirSync(again);expect(prepareLegacyZentaoData(db,again,'b'.repeat(64))).toBeUndefined();expect(marker()).toEqual(before);expect(()=>statSync(join(again,ZENTAO_PRIVATE_DATABASE))).toThrow();
  });
  it('seals INSERT, UPDATE and DELETE of retained history while leaving unrelated host tables usable',()=>{
    commit(prepareLegacyZentaoData(db,candidate,hash));for(const name of ZENTAO_LEGACY_TABLES){expect(()=>db.prepare(`UPDATE ${name} SET ${name==='application_zentao_cursors'?'cursor_id':name==='application_zentao_operation_resources'||name==='application_zentao_operation_objects'?'operation_id':'object_key'}='unexpected'`).run()).toThrow('read-only');expect(()=>db.prepare(`DELETE FROM ${name}`).run()).toThrow('read-only');expect(()=>db.prepare(`INSERT INTO ${name} SELECT * FROM ${name}`).run()).toThrow('read-only');}expect(()=>db.prepare("UPDATE app_secrets SET secret='still host owned'").run()).not.toThrow();
  });
  it('rejects a pre-existing candidate database or symlink without modifying its target',()=>{
    const original=join(root,'untouched.sqlite'),external=new Database(original);external.exec('CREATE TABLE untouched(value TEXT)');external.close();const before=readFileSync(original);symlinkSync(original,join(candidate,ZENTAO_PRIVATE_DATABASE));expect(()=>prepareLegacyZentaoData(db,candidate,hash)).toThrow();expect(readFileSync(original)).toEqual(before);expect(marker()).toEqual([]);
  });
  it('requires the lifecycle transaction and preserves the candidate database identity after directory promotion',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash)!;expect(()=>work.beforeCommit(candidate)).toThrow('同一事务');const promoted=join(root,'promoted');renameSync(candidate,promoted);commit(work,promoted);expect(marker()).toHaveLength(1);
  });
  it('detects a substituted private database even when its complete logical content is identical',()=>{
    const work=prepareLegacyZentaoData(db,candidate,hash)!,path=join(candidate,ZENTAO_PRIVATE_DATABASE),prior=join(candidate,'original.sqlite');renameSync(path,prior);const original=new Database(prior);original.exec(`VACUUM INTO '${path}'`);original.close();expect(()=>commit(work)).toThrow('被替换');expect(marker()).toEqual([]);
  });
});

function plugin(bad=false){
  const f=fixture(),cap=f.manifest.capabilities['demo-tracker.items.list'];cap.slots=[];Object.assign(f.manifest,{id:'zentao',providers:[],capabilities:{'zentao.object.list':{...cap,permission:'zentao.read'}},ui:{panels:[]}});
  f.files.set('runtime/main.mjs',Buffer.from(`import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;if(m.method==='initialize'){const db=new DatabaseSync(join(process.env.WILLYOU_PLUGIN_DATA,'zentao.sqlite'));const row=db.prepare('SELECT count(*) n FROM application_zentao_revisions').get();db.close();if(row.n!==1)throw new Error('missing actual migrated row');result={protocol:${JSON.stringify(bad?'wrong':'jsonrpc-stdio/1')},plugin:'zentao',version:'0.1.0'};}else result={items:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`));return validatePluginBundle(f.bundle());
}
function lifecycle(checkpoint?:(phase:string)=>void){
  const keychain=join(root,'synthetic-keychain');mkdirSync(keychain,{recursive:true});const life=new PluginLifecycle(new ResourceStore(db,root),{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),prepareData:(stored,directory)=>prepareLegacyZentaoData(db,directory,stored.plugin.hash),createProcess:(stored,data,events)=>new PluginProcess(stored.plugin,{packageRoot:stored.directory,dataRoot:data,protectedRoots:[root],readOnlyRoots:[process.execPath],keychainRoots:[keychain],executable:process.execPath,...events}),deleteMetadata:()=>{},checkpoint});lives.push(life);return life;
}
describe('migration in the actual lifecycle and sandboxed Electron initialization',()=>{
  it('activates the real migrated SQLite alongside the package pointer',async()=>{const life=lifecycle(),bundle=plugin();await life.install(bundle,life.inspect(bundle));expect(life.state('zentao')).toMatchObject({installed:true,hash:bundle.hash});expect(marker()).toHaveLength(1);const data=new Database(join(life.dataDirectory('zentao'),ZENTAO_PRIVATE_DATABASE));try{expect(raw(data,ZENTAO_LEGACY_TABLES[0])).toEqual(raw(db,ZENTAO_LEGACY_TABLES[0]));}finally{data.close();}});
  it('restores builtin availability if the candidate Electron process fails its handshake',async()=>{const life=lifecycle(),bundle=plugin(true);await expect(life.install(bundle,life.inspect(bundle))).rejects.toMatchObject({code:'HOST_INCOMPATIBLE'});expect(life.state('zentao').installed).toBe(false);expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(()=>db.prepare("UPDATE application_zentao_revisions SET fetched_at='builtin survives'").run()).not.toThrow();});
  it('rolls back promoted files and all import metadata on activation failure',async()=>{const life=lifecycle(),bundle=plugin();db.exec("CREATE TRIGGER controlled_pointer_failure BEFORE INSERT ON plugin_installations BEGIN SELECT RAISE(ABORT,'controlled pointer failure'); END");await expect(life.install(bundle,life.inspect(bundle))).rejects.toThrow('controlled pointer failure');expect(marker()).toEqual([]);expect(sealed()).toEqual([]);expect(life.state('zentao').installed).toBe(false);expect(()=>statSync(life.dataDirectory('zentao'))).toThrow();expect(db.prepare("SELECT state FROM plugin_lifecycle_changes").get()).toEqual({state:'rolled-back'});});
});
