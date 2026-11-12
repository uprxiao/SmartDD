import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {runBundledMigrations} from '../../../../db/migrations';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginLifecycle,type PluginInvocation} from '../lifecycle';
import {ApplicationError} from '@shared/applications';
import {PluginProcess} from '../process';
import {validatePluginBundle,type ValidatedPlugin} from '../package';
import {fixture} from './fixture';

function plugin(version='0.1.0',options:{badInit?:boolean;capability?:string;aliases?:Record<string,string>;write?:boolean}={}):ValidatedPlugin {
  const f=fixture(),old=f.manifest.capabilities['demo-tracker.items.list'];
  if(options.write){old.semantics='write';old.retry='never';}
  f.manifest.version=version;f.manifest.ui.panels=[];
  const capability=options.capability??'demo-tracker.items.list';
  Object.assign(f.manifest,{capabilities:{[capability]:old},legacyToolNames:options.aliases??{}});
  f.files.set('schemas/input.json',Buffer.from(JSON.stringify({type:'object',additionalProperties:false,properties:{mode:{type:'string'},delay:{type:'integer'},value:{type:'string'}}})));
  f.files.set('schemas/output.json',Buffer.from('{"type":"object"}'));
  f.files.set('runtime/main.mjs',Buffer.from(`const VERSION=${JSON.stringify(version)}, BAD=${!!options.badInit};\n`+String.raw`
import readline from 'node:readline';
import {existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const data=process.env.WILLYOU_PLUGIN_DATA;
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const message=JSON.parse(line);let result;
 if(message.method==='initialize'){
  writeFileSync(join(data,'init-version'),VERSION);
  if(BAD)writeFileSync(join(data,'state.txt'),'BAD CANDIDATE');
  result={protocol:BAD?'wrong':'jsonrpc-stdio/1',plugin:'demo-tracker',version:VERSION};
 } else if(message.method==='verify')result={identity:'synthetic'};
 else {
  const input=message.params.input;
  appendFileSync(join(data,'started.log'),VERSION+':'+(input.mode??'normal')+'\n');
  if(input.mode==='crash')process.exit(3);
  if(input.mode==='write')writeFileSync(join(data,'state.txt'),input.value);
  if(input.delay)await new Promise(resolve=>setTimeout(resolve,input.delay));
  result={version:VERSION,capability:message.params.capability,value:existsSync(join(data,'state.txt'))?readFileSync(join(data,'state.txt'),'utf8'):null};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');
});
`));
  return validatePluginBundle(f.bundle());
}
let root:string,sqlite:Database.Database,store:ResourceStore,life:PluginLifecycle;
const lives:PluginLifecycle[]=[];
let checkpoint:((phase:string,id:string)=>void)|undefined,failDelete=false;
function createLife():PluginLifecycle {
  const current=new PluginLifecycle(store,{
    processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),
    createProcess:(stored,data,events)=>new PluginProcess(stored.plugin,{packageRoot:stored.directory,dataRoot:data,protectedRoots:[root],readOnlyRoots:[process.execPath],keychainRoots:[join(root,'keychain')],executable:process.execPath,limits:{handshakeMs:1500,executeMs:2000},...events}),
    onStateChange:state=>{sqlite.prepare('INSERT INTO observed_states VALUES(?,?,?)').run(state.appId,state.installed?1:0,state.revision);},
    deleteMetadata:appId=>{sqlite.prepare('DELETE FROM synthetic_metadata WHERE app_id=?').run(appId);if(failDelete)throw new Error('synthetic metadata failure');},
    checkpoint:(phase,id)=>checkpoint?.(phase,id),
  });lives.push(current);return current;
}
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-lifecycle-')));mkdirSync(join(root,'keychain'));
  sqlite=new Database(join(root,'smartdd.db'));sqlite.pragma('foreign_keys=ON');sqlite.pragma('journal_mode=WAL');runBundledMigrations(sqlite);
  sqlite.exec('CREATE TABLE synthetic_metadata(app_id TEXT,kind TEXT,value TEXT);CREATE TABLE observed_states(app_id TEXT,installed INTEGER,revision INTEGER)');
  store=new ResourceStore(sqlite,root);checkpoint=undefined;failDelete=false;life=createLife();
});
afterEach(async()=>{checkpoint=undefined;for(const current of lives.splice(0))await current.close();sqlite.close();rmSync(root,{recursive:true,force:true});});
const install=(candidate:ValidatedPlugin,current=life)=>current.install(candidate,current.inspect(candidate));
const execute=(input:Record<string,unknown>={},capability='demo-tracker.items.list',current=life)=>current.execute('demo-tracker',capability,input,{});
const seed=()=>{for(const app of ['demo-tracker','other'])for(const kind of ['connection','project','secret'])sqlite.prepare('INSERT INTO synthetic_metadata VALUES(?,?,?)').run(app,kind,'synthetic:'+kind);};
const metadata=()=>sqlite.prepare('SELECT * FROM synthetic_metadata ORDER BY app_id,kind').all();
async function waitStarted(version:string,mode:string) {
  const file=join(life.dataDirectory('demo-tracker'),'started.log');
  await vi.waitFor(()=>expect(existsSync(file)&&readFileSync(file,'utf8').includes(version+':'+mode)).toBe(true),{timeout:1500,interval:10});
}

describe('external plugin lifecycle using real sandboxed Electron children',()=>{
  it('atomically installs initialized private data, records process identities and reuses the active generation',async()=>{
    const first=plugin();expect(await install(first)).toMatchObject({installed:true,enabled:true,version:'0.1.0',revision:1});
    expect(readFileSync(join(life.dataDirectory('demo-tracker'),'init-version'),'utf8')).toBe('0.1.0');
    await expect(execute()).resolves.toMatchObject({version:'0.1.0'});await expect(execute()).resolves.toMatchObject({version:'0.1.0'});
    const rows=sqlite.prepare("SELECT pid,process_started_at FROM plugin_runtime_leases WHERE kind='invocation'").all() as {pid:number;process_started_at:string}[];
    expect(rows).toHaveLength(1);expect(rows[0].pid).toBeGreaterThan(0);expect(rows[0].process_started_at).toMatch(/^darwin-proc-v1:/);
  });
  it('lets an accepted old call finish, then dispatches queued and resumed-style calls to the new version',async()=>{
    const old=plugin();await install(old);
    const inFlight=execute({mode:'write',value:'FROM OLD CALL',delay:250});await waitStarted('0.1.0','write');
    const update=install(plugin('0.2.0')),after=execute();
    await expect(inFlight).resolves.toMatchObject({version:'0.1.0',value:'FROM OLD CALL'});
    await expect(update).resolves.toMatchObject({version:'0.2.0'});await expect(after).resolves.toMatchObject({version:'0.2.0',value:'FROM OLD CALL'});
    await expect(execute()).resolves.toMatchObject({version:'0.2.0'});expect(()=>life.packages.get(old.hash)).toThrow('尚未安装');
  });
  it('keeps old package, metadata and original data when a candidate mutates its clone then fails initialization',async()=>{
    const old=plugin();await install(old);seed();const before=metadata(),data=life.dataDirectory('demo-tracker');writeFileSync(join(data,'state.txt'),'ORIGINAL');const inode=lstatSync(data).ino;
    await expect(install(plugin('0.2.0',{badInit:true}))).rejects.toMatchObject({code:'HOST_INCOMPATIBLE'});
    expect(life.state('demo-tracker')).toMatchObject({hash:old.hash,revision:1});expect(metadata()).toEqual(before);expect(lstatSync(data).ino).toBe(inode);expect(readFileSync(join(data,'state.txt'),'utf8')).toBe('ORIGINAL');
    await expect(execute()).resolves.toMatchObject({version:'0.1.0',value:'ORIGINAL'});
  });
  it.each(['prepared','after-data-backup','after-data-swap'])('restores the original data inode and version after a fault at %s',async phase=>{
    const old=plugin();await install(old);const data=life.dataDirectory('demo-tracker'),inode=lstatSync(data).ino;writeFileSync(join(data,'state.txt'),'ORIGINAL');
    checkpoint=at=>{if(at===phase)throw new Error('synthetic phase failure');};
    await expect(install(plugin('0.2.0'))).rejects.toThrow('synthetic phase failure');checkpoint=undefined;
    expect(life.state('demo-tracker').hash).toBe(old.hash);expect(lstatSync(data).ino).toBe(inode);expect(readFileSync(join(data,'state.txt'),'utf8')).toBe('ORIGINAL');
    await expect(execute()).resolves.toMatchObject({version:'0.1.0'});
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM plugin_lifecycle_changes WHERE state IN ('preparing','prepared','swapping','recovery-required')").get()).toEqual({n:0});
  });
  it('rolls file promotion back when the database activation transaction fails',async()=>{
    const old=plugin();await install(old);seed();const before=metadata(),data=life.dataDirectory('demo-tracker'),inode=lstatSync(data).ino;
    sqlite.exec("CREATE TRIGGER fail_activation BEFORE UPDATE ON plugin_installations WHEN NEW.package_hash<>OLD.package_hash BEGIN SELECT RAISE(ABORT,'synthetic activation failure'); END");
    await expect(install(plugin('0.2.0'))).rejects.toThrow('synthetic activation failure');
    expect(life.state('demo-tracker').hash).toBe(old.hash);expect(metadata()).toEqual(before);expect(lstatSync(data).ino).toBe(inode);
  });
  it('rejects new calls immediately after disable while preserving an accepted call, and keeps an update disabled',async()=>{
    await install(plugin());const inFlight=execute({mode:'slow',delay:200});await waitStarted('0.1.0','slow');
    const disable=life.setEnabled('demo-tracker',false,life.state('demo-tracker').revision);
    await expect(execute()).rejects.toMatchObject({code:'APP_NOT_ENABLED'});await expect(inFlight).resolves.toMatchObject({version:'0.1.0'});await disable;
    expect(await install(plugin('0.2.0'))).toMatchObject({enabled:false,version:'0.2.0'});await expect(execute()).rejects.toMatchObject({code:'APP_NOT_ENABLED'});
    await life.setEnabled('demo-tracker',true,life.state('demo-tracker').revision);await expect(execute()).resolves.toMatchObject({version:'0.2.0'});
  });
  it('retains data and metadata through uninstall/reinstall downgrade, or deletes only this plugin when requested',async()=>{
    await install(plugin());await install(plugin('0.2.0'));seed();await execute({mode:'write',value:'RETAINED'});
    await life.uninstall('demo-tracker',false,life.state('demo-tracker').revision);await expect(execute()).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(metadata()).toHaveLength(6);expect(readFileSync(join(life.dataDirectory('demo-tracker'),'state.txt'),'utf8')).toBe('RETAINED');
    await install(plugin());await expect(execute()).resolves.toMatchObject({version:'0.1.0',value:'RETAINED'});
    await life.uninstall('demo-tracker',true,life.state('demo-tracker').revision);expect(existsSync(life.dataDirectory('demo-tracker'))).toBe(false);
    expect(metadata()).toHaveLength(3);expect(metadata()).toEqual(expect.arrayContaining([expect.objectContaining({app_id:'other'})]));
    await install(plugin());await expect(execute()).resolves.toMatchObject({value:null});
    await life.close();const restarted=createLife();await restarted.recover();await expect(execute({},'demo-tracker.items.list',restarted)).resolves.toMatchObject({version:'0.1.0'});
  });
  it('finishes an accepted call before uninstall cleanup and rejects later calls',async()=>{
    await install(plugin());const inFlight=execute({mode:'slow',delay:200});await waitStarted('0.1.0','slow');
    const uninstall=life.uninstall('demo-tracker',true,life.state('demo-tracker').revision),later=execute();
    await expect(inFlight).resolves.toMatchObject({version:'0.1.0'});await uninstall;await expect(later).rejects.toMatchObject({code:'NOT_FOUND'});expect(existsSync(life.dataDirectory('demo-tracker'))).toBe(false);
  });
  it('keeps the accepted call authorized until its final host receipt before publishing uninstall',async()=>{
    await install(plugin());
    const inFlight=life.withInvocation('demo-tracker',async(_selected,invocation)=>{
      const result=await invocation.execute('demo-tracker.items.list',{mode:'slow',delay:200},{});
      // The Host validates authority again after the child returns, while this reservation is still held.
      invocation.assertActive();expect(life.state('demo-tracker').installed).toBe(true);return result;
    });
    await waitStarted('0.1.0','slow');const uninstall=life.uninstall('demo-tracker',true,life.state('demo-tracker').revision);
    await expect(inFlight).resolves.toMatchObject({version:'0.1.0'});await uninstall;
    expect(life.state('demo-tracker').installed).toBe(false);await expect(execute()).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('does not dispatch a reserved call approved after uninstall has begun',async()=>{
    await install(plugin());const dispatch=vi.spyOn(PluginProcess.prototype,'execute');let entered!:()=>void,approved!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),approval=new Promise<void>(resolve=>{approved=resolve;});
    const call=life.withInvocation('demo-tracker',async(_selected,invocation)=>{entered();await approval;return invocation.execute('demo-tracker.items.list',{mode:'late'},{});});
    await ready;const denied=expect(call).rejects.toMatchObject({code:'NOT_FOUND'});
    const uninstall=life.uninstall('demo-tracker',true,life.state('demo-tracker').revision);approved();
    await denied;await uninstall;expect(existsSync(life.dataDirectory('demo-tracker'))).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();dispatch.mockRestore();
  });
  it('rolls metadata deletion back atomically when one cleanup step fails',async()=>{
    const old=plugin();await install(old);seed();await execute({mode:'write',value:'KEEP'});const before=metadata(),data=life.dataDirectory('demo-tracker'),inode=lstatSync(data).ino;
    failDelete=true;await expect(life.uninstall('demo-tracker',true,life.state('demo-tracker').revision)).rejects.toThrow('synthetic metadata failure');failDelete=false;
    expect(metadata()).toEqual(before);expect(life.state('demo-tracker')).toMatchObject({installed:true,hash:old.hash});expect(lstatSync(data).ino).toBe(inode);await expect(execute()).resolves.toMatchObject({value:'KEEP'});
  });
  it('rejects same versions, downgrades, mismatched targets and stale confirmations without changing active state',async()=>{
    await install(plugin('0.2.0'));const before=life.state('demo-tracker');
    expect(()=>life.inspect(plugin('0.2.0'))).toThrow('当前版本');expect(()=>life.inspect(plugin())).toThrow('更低');expect(()=>life.inspect(plugin('0.3.0'),'other')).toThrow('不是');
    const next=plugin('0.3.0'),plan=life.inspect(next);await life.setEnabled('demo-tracker',false,before.revision);
    await expect(life.install(next,plan)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});expect(life.state('demo-tracker').hash).toBe(before.hash);
  });
  it('resolves renamed legacy capability IDs using the current manifest and warns about unmapped removals',async()=>{
    await install(plugin());const renamed=plugin('0.2.0',{capability:'demo-tracker.items.fetch',aliases:{'demo-tracker.items.list':'demo-tracker.items.fetch'}});
    expect(life.inspect(renamed).breakingCapabilities).toEqual([]);await install(renamed);await expect(execute()).resolves.toMatchObject({version:'0.2.0',capability:'demo-tracker.items.fetch'});
    const dropped=plugin('0.3.0',{capability:'demo-tracker.items.count'});expect(life.inspect(dropped).breakingCapabilities).toContain('demo-tracker.items.fetch');await install(dropped);await expect(execute()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  });
  it('pauses after three crashes in a minute and only resumes after an explicit restart',async()=>{
    await install(plugin());for(let i=0;i<3;i++)await expect(execute({mode:'crash'})).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    expect(life.state('demo-tracker').paused).toBe(true);await expect(execute()).rejects.toThrow('暂停');
    await life.restart('demo-tracker');expect(life.state('demo-tracker').paused).toBe(false);await expect(execute()).resolves.toMatchObject({version:'0.1.0'});
  });
  it('keeps a committed new version on cleanup interruption and completes cleanup on recovery',async()=>{
    const old=plugin();await install(old);checkpoint=phase=>{if(phase==='committed')throw new Error('synthetic postcommit stop');};
    await expect(install(plugin('0.2.0'))).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(life.state('demo-tracker').version).toBe('0.2.0');checkpoint=undefined;
    await life.close();const restarted=createLife();await restarted.recover();expect(()=>restarted.packages.get(old.hash)).toThrow('尚未安装');await expect(execute({},'demo-tracker.items.list',restarted)).resolves.toMatchObject({version:'0.2.0'});
  });
  it('reserves the selected version while host approval waits without starting the plugin',async()=>{
    await install(plugin());let continueApproval!:()=>void,entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),approval=new Promise<void>(resolve=>{continueApproval=resolve;});
    const call=life.withInvocation('demo-tracker',async(selected,invocation)=>{expect(selected.plugin.manifest.version).toBe('0.1.0');entered();await approval;return invocation.execute('demo-tracker.items.list',{},{});});
    await ready;
    expect(sqlite.prepare("SELECT state,pid FROM plugin_runtime_leases WHERE kind='invocation'").get()).toEqual({state:'reserved',pid:null});
    const update=install(plugin('0.2.0'));continueApproval();
    await expect(call).resolves.toMatchObject({version:'0.1.0'});await update;await expect(execute()).resolves.toMatchObject({version:'0.2.0'});
  });
  it('releases a rejected host continuation with zero plugin starts or requests',async()=>{
    await install(plugin());let saved!:PluginInvocation;
    await expect(life.withInvocation('demo-tracker',async(_selected,invocation)=>{saved=invocation;throw new ApplicationError('AUTHORIZATION_REQUIRED','synthetic approval denial');})).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});
    expect(sqlite.prepare("SELECT state,pid FROM plugin_runtime_leases WHERE kind='invocation'").get()).toEqual({state:'closed',pid:null});expect(existsSync(join(life.dataDirectory('demo-tracker'),'started.log'))).toBe(false);
    expect(()=>saved.assertActive()).toThrow('已结束');expect(()=>saved.execute('demo-tracker.items.list',{},{})).toThrow('已结束');
  });
  it('rechecks disabled state after host approval and prevents dispatch after revocation',async()=>{
    await install(plugin());let continueApproval!:()=>void,entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),approval=new Promise<void>(resolve=>{continueApproval=resolve;});
    const call=life.withInvocation('demo-tracker',async(_selected,invocation)=>{entered();await approval;return invocation.execute('demo-tracker.items.list',{},{});});await ready;
    const disabled=life.setEnabled('demo-tracker',false,life.state('demo-tracker').revision);continueApproval();
    await expect(call).rejects.toMatchObject({code:'APP_NOT_ENABLED'});await disabled;expect(existsSync(join(life.dataDirectory('demo-tracker'),'started.log'))).toBe(false);
  });
  it('allows at most one write dispatch inside the same invocation reservation',async()=>{
    await install(plugin('0.1.0',{write:true}));
    await life.withInvocation('demo-tracker',async(_selected,invocation)=>{
      await invocation.execute('demo-tracker.items.list',{mode:'write',value:'ONCE'},{});
      expect(()=>invocation.execute('demo-tracker.items.list',{mode:'write',value:'TWICE'},{})).toThrow('不能再次提交');
    });
    expect(readFileSync(join(life.dataDirectory('demo-tracker'),'state.txt'),'utf8')).toBe('ONCE');expect(readFileSync(join(life.dataDirectory('demo-tracker'),'started.log'),'utf8').trim().split('\n')).toHaveLength(1);
  });
});
