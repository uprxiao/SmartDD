import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {runBundledMigrations} from '../../../../db/migrations';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader,type ProcessIdentityReader} from '../../process-identity';
import {PluginLifecycle} from '../lifecycle';
import {validatePluginBundle} from '../package';
import {fixture} from './fixture';

let root:string,sqlite:Database.Database,store:ResourceStore,life:PluginLifecycle;
const readers:ProcessIdentityReader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
const lives:PluginLifecycle[]=[],children:ChildProcess[]=[];
function manager(processes=readers):PluginLifecycle {
  const value=new PluginLifecycle(store,{processes,createProcess:()=>{throw new Error('recovery must not start a plugin');},deleteMetadata:()=>{throw new Error('rollback must not delete metadata');}});lives.push(value);return value;
}
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-recovery-')));sqlite=new Database(join(root,'smartdd.db'));sqlite.pragma('foreign_keys=ON');sqlite.pragma('journal_mode=WAL');runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);life=manager();
});
afterEach(async()=>{
  vi.restoreAllMocks();
  for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));child.kill('SIGKILL');await closed;}
  for(const value of lives.splice(0))await value.close();sqlite.close();rmSync(root,{recursive:true,force:true});
});
function seed() {
  const f=fixture(),old=life.packages.publish(validatePluginBundle(f.bundle()));
  f.manifest.version='0.2.0';const next=life.packages.publish(validatePluginBundle(f.bundle()));
  sqlite.prepare('INSERT INTO plugin_installations VALUES(?,?,1,1,1,?)').run('demo-tracker',old.plugin.hash,'original time');
  const data=life.dataDirectory('demo-tracker');mkdirSync(data);writeFileSync(join(data,'state.txt'),'ORIGINAL');
  return{old,next,data,prior:sqlite.prepare('SELECT * FROM plugin_installations').get(),identity:{dev:lstatSync(data).dev,ino:lstatSync(data).ino}};
}
function interrupted(kind:'update'|'uninstall',alreadyRestored=false) {
  const prepared=seed(),id=randomUUID(),changes=join(life.packages.root,'changes');mkdirSync(changes);const change=join(changes,id);mkdirSync(change);
  writeFileSync(join(change,'owner.json'),JSON.stringify({schema:1,storeId:store.storeId,changeId:id,appId:'demo-tracker'}));
  let candidateIdentity:{dev:number;ino:number}|null=null;
  if(!alreadyRestored){
    renameSync(prepared.data,join(change,'backup'));
    if(kind==='update'){mkdirSync(prepared.data);writeFileSync(join(prepared.data,'state.txt'),'UNCOMMITTED NEW DATA');candidateIdentity={dev:lstatSync(prepared.data).dev,ino:lstatSync(prepared.data).ino};}
  }
  if(kind==='uninstall')sqlite.prepare('UPDATE plugin_installations SET installed=0,enabled=0,package_hash=NULL,revision=2').run();
  const payload={host:{pid:2147483000,startedAt:'darwin-proc-v1:1:1'},prior:prepared.prior,hadData:true,deleteData:kind==='uninstall',dataIdentity:prepared.identity,candidateIdentity};
  sqlite.prepare("INSERT INTO plugin_lifecycle_changes(change_id,app_id,kind,from_hash,to_hash,from_revision,previous_enabled,state,payload_json,host_instance_id,created_at,updated_at) VALUES(?,'demo-tracker',?,?,?,1,1,'swapping',?,'exited-fixture-host','before','before')").run(id,kind,prepared.old.plugin.hash,kind==='update'?prepared.next.plugin.hash:null,JSON.stringify(payload));
  return{...prepared,id,change};
}
function lease(hash:string,values:Partial<{pid:number|null;process_started_at:string|null;host_pid:number;host_started_at:string;state:string}>={}) {
  const value={pid:process.pid,process_started_at:'darwin-proc-v1:1:1',host_pid:2147483000,host_started_at:'darwin-proc-v1:1:1',state:'running',...values};
  const id=randomUUID();sqlite.prepare('INSERT INTO plugin_runtime_leases(lease_id,app_id,package_hash,kind,host_instance_id,host_pid,host_started_at,pid,process_started_at,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'demo-tracker',hash,'invocation','exited-fixture-host',value.host_pid,value.host_started_at,value.pid,value.process_started_at,value.state,'before');return id;
}

describe('durable plugin recovery and original process ownership',()=>{
  it('restores the original data inode after an uncommitted update and removes only the unused candidate',async()=>{
    const f=interrupted('update');await life.recover();expect(life.state('demo-tracker')).toMatchObject({hash:f.old.plugin.hash,version:'0.1.0'});
    expect(lstatSync(f.data).ino).toBe(f.identity.ino);expect(readFileSync(join(f.data,'state.txt'),'utf8')).toBe('ORIGINAL');expect(existsSync(f.change)).toBe(false);expect(()=>life.packages.get(f.next.plugin.hash)).toThrow('尚未安装');
  });
  it('recognizes an original directory already restored before a rollback-journal commit',async()=>{
    const f=interrupted('update',true);await life.recover();expect(lstatSync(f.data).ino).toBe(f.identity.ino);expect(life.state('demo-tracker').hash).toBe(f.old.plugin.hash);expect(existsSync(f.change)).toBe(false);
  });
  it('rolls an interrupted uninstall back without invoking metadata deletion',async()=>{
    const f=interrupted('uninstall');await life.recover();expect(life.state('demo-tracker')).toMatchObject({installed:true,enabled:true,hash:f.old.plugin.hash,revision:3});expect(lstatSync(f.data).ino).toBe(f.identity.ino);expect(readFileSync(join(f.data,'state.txt'),'utf8')).toBe('ORIGINAL');
  });
  it('preserves both data trees when the change owner cannot be verified',async()=>{
    const f=interrupted('update');writeFileSync(join(f.change,'owner.json'),'{}');
    await expect(life.recover()).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});
    expect(readFileSync(join(f.change,'backup/state.txt'),'utf8')).toBe('ORIGINAL');expect(readFileSync(join(f.data,'state.txt'),'utf8')).toBe('UNCOMMITTED NEW DATA');
    expect(sqlite.prepare('SELECT state FROM plugin_lifecycle_changes').get()).toEqual({state:'swapping'});
  });
  it('rejects a directory with another inode instead of deleting unrecognized data',async()=>{
    const f=interrupted('update');renameSync(f.data,join(root,'preserved-candidate'));mkdirSync(f.data);writeFileSync(join(f.data,'state.txt'),'UNRECOGNIZED');
    await expect(life.recover()).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(readFileSync(join(f.data,'state.txt'),'utf8')).toBe('UNRECOGNIZED');expect(readFileSync(join(f.change,'backup/state.txt'),'utf8')).toBe('ORIGINAL');
  });
  it('treats a reused PID as stopped without signalling the live process with that PID',async()=>{
    const f=seed(),id=lease(f.old.plugin.hash),kill=vi.spyOn(process,'kill');await life.recover();expect(kill).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases WHERE lease_id=?').get(id)).toEqual({state:'closed'});
  });
  it('does not touch a lease while its original host is still running',async()=>{
    const f=seed(),host=readers.read(process.pid)!;lease(f.old.plugin.hash,{host_pid:host.pid,host_started_at:host.startedAt});const kill=vi.spyOn(process,'kill');
    await expect(life.recover()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(kill).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases').get()).toEqual({state:'running'});
  });
  it('keeps unregistered and unknown process identities unresolved',async()=>{
    const f=seed(),id=lease(f.old.plugin.hash,{pid:null,process_started_at:null,state:'launching'});await expect(life.recover()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
    expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases WHERE lease_id=?').get(id)).toEqual({state:'launching'});
    sqlite.prepare('UPDATE plugin_runtime_leases SET state=\'running\',pid=2147483001,process_started_at=\'darwin-proc-v1:2:2\'').run();
    const unknown=manager({read:pid=>readers.read(pid),state:identity=>identity.pid===2147483001?'unknown':readers.state(identity)}),kill=vi.spyOn(process,'kill');
    await expect(unknown.recover()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(kill).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases WHERE lease_id=?').get(id)).toEqual({state:'running'});
  });
  it('releases a proved pre-spawn reservation after the original host has exited',async()=>{
    const f=seed(),id=lease(f.old.plugin.hash,{pid:null,process_started_at:null,state:'reserved'});await life.recover();expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases WHERE lease_id=?').get(id)).toEqual({state:'closed'});
  });
  it('reaps an exact owned orphan and waits for its actual exit before releasing the lease',async()=>{
    const f=seed(),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{ELECTRON_RUN_AS_NODE:'1',PATH:'/usr/bin:/bin'},stdio:'ignore',detached:true});children.push(child);
    const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));const identity=readers.read(child.pid!);expect(identity?.pid).toBe(child.pid);
    const id=lease(f.old.plugin.hash,{pid:identity!.pid,process_started_at:identity!.startedAt});await life.recover();await exited;
    expect(sqlite.prepare('SELECT state FROM plugin_runtime_leases WHERE lease_id=?').get(id)).toEqual({state:'closed'});expect(readers.state(identity!)).toBe('stopped');
  });
});
