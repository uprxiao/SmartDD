import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createUnixServer,connect as connectUnix} from 'node:net';
import {randomUUID} from 'node:crypto';
import * as childProcesses from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {PluginProcess, PluginProcessBudget, type PluginProcessOptions} from '../process';
import {validatePluginBundle} from '../package';
import {pluginSandboxProfile} from '../sandbox';
import {pluginHostReadOnlyRoots} from '../host-paths';
import {agentControlRootPath,codexDaemonRootPath} from '../../agent-control-path';
import {fixture} from './fixture';

vi.mock('node:child_process', async importOriginal => {
  const actual=await importOriginal<typeof import('node:child_process')>();
  return {...actual,spawn:vi.fn(actual.spawn)};
});

const runtime = String.raw`
import readline from 'node:readline';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const send = reply => process.stdout.write(JSON.stringify(reply)+'\n');
readline.createInterface({input:process.stdin}).on('line', async line => {
  const message = JSON.parse(line), input = message.params?.input ?? {};
  let result;
  if (message.method === 'initialize') {
    if (INIT === 'hang') return;
    result = {protocol:INIT === 'bad' ? 'wrong' : 'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0'};
  } else if (message.method === 'verify') result = {identity:message.params.config.baseUrl};
  else {
    appendFileSync(join(process.env.WILLYOU_PLUGIN_DATA,'calls.log'),input.mode+'\n');
    if (input.mode === 'hang') return;
    if (input.mode === 'crash') process.exit(3);
    if (input.mode === 'business-error') {send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'DO_NOT_ECHO_SYNTHETIC_SECRET',data:{code:'AUTH_FAILED'}}});return;}
    if (input.mode === 'frame') {process.stdout.write('x'.repeat(300000)); return;}
    if (input.mode === 'flood') {process.stderr.write('x'.repeat(4000)); return;}
    if (input.mode === 'malformed') {process.stdout.write('{no-json}\n'); return;}
    if (input.mode === 'wrong-id') {send({jsonrpc:'2.0',id:99999,result:{}}); return;}
    if (input.delay) await new Promise(resolve=>setTimeout(resolve,input.delay));
    if (input.mode === 'probe') {
      const attempt = action => {try {action();return 'allowed'}catch(error){return error.code}};
      const own = join(process.env.WILLYOU_PLUGIN_DATA,'own.txt');
      const child = spawnSync('/usr/bin/true',[],{encoding:'utf8'});
      result = {
        read:attempt(()=>readFileSync(input.path)), write:attempt(()=>writeFileSync(input.path,'changed')),
        own:attempt(()=>{writeFileSync(own,'own');readFileSync(own)}),
        child:child.error?.code ?? child.status,
        keys:Object.keys(process.env).sort(),
        incoming:message.params.connection,
        scope:message.params.scope,
      };
    } else if (input.mode === 'sqlite') {
      const {DatabaseSync}=await import('node:sqlite');
      const db=new DatabaseSync(join(process.env.WILLYOU_PLUGIN_DATA,'private.sqlite'));
      db.exec("CREATE TABLE IF NOT EXISTS private_items(value TEXT);INSERT INTO private_items VALUES('synthetic')");
      const rows=db.prepare('SELECT value FROM private_items').all();db.close();let hostError=null;
      try{const host=new DatabaseSync(input.path,{readOnly:true});host.prepare('SELECT value FROM host_items').all();host.close();}catch(error){hostError={code:error.code,errcode:error.errcode};}
      result={rows,hostError};
    } else if (input.mode === 'unix-hardlink') {
      try {const {linkSync}=await import('node:fs');linkSync(input.path,input.url);input.path=input.url;}
      catch(error){result={code:error.code};}
      if (!result) result=await new Promise(async resolve=>{
        const {connect}=await import('node:net');const socket=connect(input.path);let done=false;
        const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
        const timer=setTimeout(()=>finish({code:'TIMEOUT'}),1000);socket.once('error',error=>finish({code:error.code}));socket.once('connect',()=>finish({code:'connected'}));
      });
    } else if (input.mode === 'unix-socket') result=await new Promise(async resolve=>{
      const {connect}=await import('node:net');const socket=connect(input.path);let done=false;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
      const timer=setTimeout(()=>finish({code:'TIMEOUT'}),1000);socket.once('error',error=>finish({code:error.code}));socket.once('connect',()=>finish({code:'connected'}));
    });
    else if (input.mode === 'network') result = {status:(await fetch(input.url)).status};
    else result = {items:[{id:'1',title:'synthetic'}]};
  }
  send({jsonrpc:'2.0',id:message.id,result});
});
`;
const roots: string[] = [], children: PluginProcess[] = [];
// The same runtime contract can be exercised with a verified packaged Electron
// without starting its application main or changing any production input.
const testExecutable=process.env.WILLYOU_P1_PLUGIN_EXECUTABLE?realpathSync(process.env.WILLYOU_P1_PLUGIN_EXECUTABLE):process.execPath;
if(process.env.WILLYOU_P1_PLUGIN_EXECUTABLE&&!/^\/private\/tmp\/willyou-m13-p1-App[0-9]{3}\/mac-arm64\/WillYou\.app\/Contents\/MacOS\/WillYou$/.test(testExecutable))throw Error('Explicit isolated M13 packaged executable required');
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) await child.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true});
});
function setup(options: {init?: string; limits?: PluginProcessOptions['limits']; budget?: PluginProcessBudget; write?: boolean} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-runtime-'))); roots.push(root);
  const host = join(root,'host'), pack = join(host,'plugins/demo-tracker/0.1.0'), data = join(host,'plugin-data/demo-tracker'), keys = join(root,'keychain');
  for (const path of [pack,data,keys]) mkdirSync(path,{recursive:true,mode:0o700});
  const f = fixture(), cap = f.manifest.capabilities['demo-tracker.items.list'];
  f.manifest.ui.panels=[];
  if (options.write) {cap.semantics='write';cap.retry='never';}
  f.files.set('runtime/main.mjs',Buffer.from('const INIT='+JSON.stringify(options.init??'ok')+';\n'+runtime));
  f.files.set('schemas/input.json',Buffer.from(JSON.stringify({type:'object',additionalProperties:false,properties:{mode:{type:'string'},delay:{type:'integer'},path:{type:'string'},url:{type:'string'}}})));
  f.files.set('schemas/output.json',Buffer.from('{"type":"object"}'));
  const plugin = validatePluginBundle(f.bundle());
  for (const [path,bytes] of plugin.files) {const target=join(pack,path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,bytes,{mode:0o600});}
  const fakeDb=join(host,'smartdd.db');writeFileSync(fakeDb,'HOST_SENTINEL');
  const keychain=join(keys,'test.keychain');writeFileSync(keychain,'SYNTHETIC_KEYCHAIN_FILE');
  const processOptions: PluginProcessOptions={packageRoot:pack,dataRoot:data,protectedRoots:[host],readOnlyRoots:[testExecutable],keychainRoots:[keys],executable:testExecutable,limits:options.limits,budget:options.budget};
  const child=new PluginProcess(plugin,processOptions);children.push(child);
  const execute=(input:Record<string,unknown>,signal?:AbortSignal)=>child.execute('demo-tracker.items.list',input,{secret:'THIS_CALL_ONLY'},signal);
  return {root,host,pack,data,keys,keychain,fakeDb,child,execute,processOptions};
}

describe('production Electron plugin subprocess with mandatory Seatbelt',()=>{
  it('initializes, validates input, verifies and executes while stripping inherited credentials',async()=>{
    const f=setup();process.env.WILLYOU_M13_INHERITED_TEST_SECRET='NOT_FOR_PLUGIN';
    try {
      await expect(f.child.execute('demo-tracker.items.list',{unknown:true},{secret:'x'})).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(f.child.pid).toBeUndefined();
      await expect(f.child.verify('tracker-api',{baseUrl:'synthetic'})).resolves.toEqual({identity:'synthetic'});
      const result=await f.execute({mode:'probe',path:f.fakeDb}) as {keys:string[];incoming:unknown;own:string;child:unknown};
      expect(result.keys).not.toContain('WILLYOU_M13_INHERITED_TEST_SECRET');expect(result.keys).not.toContain('NODE_OPTIONS');
      expect(result.incoming).toEqual({secret:'THIS_CALL_ONLY'});expect(result.own).toBe('allowed');expect(result.child).toBe('EPERM');
    } finally {delete process.env.WILLYOU_M13_INHERITED_TEST_SECRET;}
  });
  it('denies host DB, other plugin, own-package writes and symlink escapes, while allowing own data and network',async()=>{
    const f=setup(), other=join(f.host,'plugin-data/other');mkdirSync(other);const privateFile=join(other,'private.txt');writeFileSync(privateFile,'OTHER');
    const alias=join(f.data,'escape-link');symlinkSync(f.fakeDb,alias);
    for (const path of [f.fakeDb,privateFile,alias,f.keychain]) expect(await f.execute({mode:'probe',path})).toMatchObject({read:'EPERM',write:'EPERM',own:'allowed',child:'EPERM'});
    expect(await f.execute({mode:'probe',path:join(f.pack,'runtime/main.mjs')})).toMatchObject({read:'allowed',write:'EPERM'});
    expect(readFileSync(f.fakeDb,'utf8')).toBe('HOST_SENTINEL');
    const server=createServer((_request,response)=>{response.end('ok');});
    try {await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('server');await expect(f.execute({mode:'network',url:`http://127.0.0.1:${address.port}/`})).resolves.toEqual({status:200});}
    finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
  it('denies writes to unpacked native resources and frameworks in the complete packaged host program',async()=>{
    const f=setup(),contents=join(f.root,'SyntheticWillYou.app/Contents'),binary=join(contents,'MacOS/WillYou'),appPath=join(contents,'Resources/app');
    const targets=[join(contents,'Resources/native/helper'),join(contents,'Resources/app.asar.unpacked/native.node'),join(contents,'Resources/plugins/zentao/runtime/main.mjs'),join(contents,'Frameworks/engine')];
    for(const path of [binary,join(appPath,'index.js'),...targets]){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'SYNTHETIC_PROGRAM_INPUT');}
    f.processOptions.readOnlyRoots=[testExecutable,...pluginHostReadOnlyRoots(appPath,binary)];
    for(const path of targets){const result=await f.execute({mode:'probe',path}) as {read:string;write:string};expect(result,'synthetic program probe: '+JSON.stringify({read:result.read,write:result.write,after:readFileSync(path,'utf8')})).toMatchObject({read:'allowed',write:'EPERM'});expect(readFileSync(path,'utf8')).toBe('SYNTHETIC_PROGRAM_INPUT');}
  });
  it.each(['bad','hang'])('rejects an invalid or missing handshake (%s)',async init=>{
    const f=setup({init,limits:{handshakeMs:init==='hang'?200:1000}});
    await expect(f.execute({})).rejects.toMatchObject({code:init==='bad'?'HOST_INCOMPATIBLE':'TIMEOUT'});await f.child.close();
  });
  it('blocks private Agent control sockets while retaining unrelated local sockets and ordinary network',async()=>{
    const f=setup(),base=agentControlRootPath();await f.child.initialize();mkdirSync(base,{recursive:true,mode:0o700});
    const directory=mkdtempSync(join(base,'test-'));roots.push(directory);
    const daemonBase=codexDaemonRootPath();mkdirSync(daemonBase,{recursive:true,mode:0o700});const physicalDirectory=mkdtempSync(join(daemonBase,'test-m13-'));roots.push(physicalDirectory);const physical=join(physicalDirectory,'s.sock');
    const blocked=join(directory,'server.sock'),allowed=join(f.root,'allowed.sock');let blockedConnections=0,allowedConnections=0;
    const aliases=mkdtempSync('/private/tmp/wy-m13-alias-');roots.push(aliases);const alias=join(aliases,'s');symlinkSync(directory,alias);const physicalAlias=join(aliases,'p');symlinkSync(physicalDirectory,physicalAlias);
    const privateServer=createUnixServer(socket=>{blockedConnections++;socket.end();}),physicalServer=createUnixServer(socket=>{blockedConnections++;socket.end();}),ordinaryServer=createUnixServer(socket=>{allowedConnections++;socket.end();});
    try{
      await Promise.all([new Promise<void>(resolve=>privateServer.listen(blocked,resolve)),new Promise<void>(resolve=>physicalServer.listen(physical,resolve)),new Promise<void>(resolve=>ordinaryServer.listen(allowed,resolve))]);
      const blockedPaths=[blocked,blocked.replace('/private/tmp/','/tmp/'),join(alias,'server.sock'),physical,physical.replace('/private/tmp/','/tmp/'),join(physicalAlias,'s.sock')];
      for(const area of [directory,physicalDirectory]){const file=join(area,'synthetic-owner.json');writeFileSync(file,'SYNTHETIC_CONTROL_METADATA');await expect(f.execute({mode:'probe',path:file})).resolves.toMatchObject({read:'EPERM',write:'EPERM'});}
      // A refusal proves sandbox isolation only if each adversarial path is a
      // valid, reachable endpoint without that sandbox (Darwin has a short cap).
      for(const path of blockedPaths){expect(Buffer.byteLength(path)).toBeLessThan(104);await new Promise<void>((resolve,reject)=>{const socket=connectUnix(path);socket.once('error',reject);socket.once('connect',()=>{socket.end();resolve();});});}
      await vi.waitFor(()=>expect(blockedConnections).toBe(6));blockedConnections=0;
      for(const path of blockedPaths)await expect(f.execute({mode:'unix-socket',path})).resolves.toEqual({code:'EPERM'});
      const hardlink=join(aliases,'h');let hardlinkSupported=true;
      try{linkSync(physical,hardlink);unlinkSync(hardlink);}catch(error){if((error as NodeJS.ErrnoException).code!=='EPERM')throw error;hardlinkSupported=false;}
      const hardlinkResult=hardlinkSupported?await f.execute({mode:'unix-hardlink',path:physical,url:hardlink}):null;
      if(hardlinkSupported)expect(hardlinkResult).toEqual({code:'EPERM'});
      await expect(f.execute({mode:'unix-socket',path:allowed})).resolves.toEqual({code:'connected'});
      expect(blockedConnections).toBe(0);expect(allowedConnections).toBe(1);
      const evidence=process.env.WILLYOU_P1_SOCKET_EVIDENCE;if(evidence){if(!evidence.startsWith('/private/tmp/willyou-m13-'))throw Error('Private socket evidence required');writeFileSync(evidence,JSON.stringify({schema:1,blockedPaths,unsandboxedConnections:6,blockedConnections,allowedConnections,hardlinkSupported,hardlinkResult,pluginStartedBeforeEndpoints:true},null,2)+'\n');}
    }finally{await Promise.all([new Promise<void>(resolve=>privateServer.close(()=>resolve())),new Promise<void>(resolve=>physicalServer.close(()=>resolve())),new Promise<void>(resolve=>ordinaryServer.close(()=>resolve()))]);}
  });
  it.each([['frame','TOO_LARGE'],['flood','TOO_LARGE'],['malformed','INVALID_RESPONSE'],['wrong-id','INVALID_RESPONSE'],['crash','CAPABILITY_UNAVAILABLE'],['hang','TIMEOUT']])('bounds %s and closes its process',async(mode,code)=>{
    const f=setup({limits:{executeMs:250,frameBytes:mode==='frame'?1024:256*1024,outputBytes:mode==='frame'?4*1024*1024:2048}});await expect(f.execute({mode})).rejects.toMatchObject({code});await f.child.close();
    expect(()=>process.kill(f.child.pid!,0)).toThrow();
  });
  it('enforces concurrent-call and shared process budgets without killing other runtimes',async()=>{
    const budget=new PluginProcessBudget(1), f=setup({budget,limits:{concurrentCalls:1}});await f.child.initialize();
    const a=f.execute({delay:200});await expect(f.execute({})).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    const other=setup({budget});await expect(other.execute({})).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    await expect(a).resolves.toHaveProperty('items');expect(budget.active).toBe(1);await f.child.close();expect(budget.active).toBe(0);
    const fresh=setup({budget});await expect(fresh.execute({})).resolves.toHaveProperty('items');
  });
  it('cancels reads, marks submitted writes unknown, and never automatically replays',async()=>{
    for (const write of [false,true]) {
      const f=setup({write}), abort=new AbortController();await f.child.initialize();
      const call=f.execute({mode:'hang'},abort.signal);
      await vi.waitFor(()=>expect(existsSync(join(f.data,'calls.log'))).toBe(true),{timeout:1000,interval:10});abort.abort();
      await expect(call).rejects.toMatchObject({code:write?'UPSTREAM_RESULT_UNKNOWN':'CANCELED'});await f.child.close();
      const lines=readFileSync(join(f.data,'calls.log'),'utf8').trim().split('\n');expect(lines).toEqual(['hang']);
    }
  });
  it('fails closed before spawn when the sandbox boundary is unavailable or package integrity changed',async()=>{
    const f=setup();
    const bad=new PluginProcess(f.child.plugin,{...f.processOptions,protectedRoots:[]});children.push(bad);
    await expect(bad.initialize()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});expect(bad.pid).toBeUndefined();
    writeFileSync(join(f.pack,'runtime/main.mjs'),'throw new Error("tampered")');
    await expect(f.execute({})).rejects.toMatchObject({code:'HASH_MISMATCH'});expect(f.child.pid).toBeUndefined();
    expect(()=>pluginSandboxProfile({...f.processOptions,dataRoot:f.pack})).toThrow();
  });
  it('never falls back to a direct executable when the OS sandbox cannot start',async()=>{
    const budget=new PluginProcessBudget(1),f=setup({budget});
    const spawn=vi.mocked(childProcesses.spawn);spawn.mockClear();spawn.mockImplementationOnce(()=>{throw new Error('synthetic sandbox unavailable');});
    await expect(f.execute({})).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    expect(spawn).toHaveBeenCalledTimes(1);expect(spawn.mock.calls[0][0]).toBe('/usr/bin/sandbox-exec');expect(budget.active).toBe(0);
  });
  it('keeps a healthy runtime available when another plugin process crashes',async()=>{
    const budget=new PluginProcessBudget(2),healthy=setup({budget}),crashy=setup({budget});
    await healthy.child.initialize();await expect(crashy.execute({mode:'crash'})).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});await crashy.child.close();
    await expect(healthy.execute({})).resolves.toHaveProperty('items');expect(budget.active).toBe(1);
  });
  it('does not dispatch a request over the frame budget and never retries a timed-out write',async()=>{
    const large=setup({write:true,limits:{frameBytes:256}});
    await expect(large.execute({path:'x'.repeat(512)})).rejects.toMatchObject({code:'TOO_LARGE'});
    expect(existsSync(join(large.data,'calls.log'))).toBe(false);
    const slow=setup({write:true,limits:{executeMs:150}});
    await expect(slow.execute({mode:'hang'})).rejects.toMatchObject({code:'UPSTREAM_RESULT_UNKNOWN'});await slow.child.close();
    expect(readFileSync(join(slow.data,'calls.log'),'utf8')).toBe('hang\n');
  });
  it('uses Electron built-in SQLite for private storage without shipping a native addon, while denying the valid host DB',async()=>{
    const f=setup(),path=join(f.host,'valid-host.sqlite'),host=new DatabaseSync(path);
    host.exec("CREATE TABLE host_items(value TEXT);INSERT INTO host_items VALUES('synthetic host data')");host.close();
    const control=new DatabaseSync(path,{readOnly:true});expect(control.prepare('SELECT value FROM host_items').all()).toEqual([{value:'synthetic host data'}]);control.close();
    await expect(f.execute({mode:'sqlite',path})).resolves.toMatchObject({rows:[{value:'synthetic'}],hostError:{code:'ERR_SQLITE_ERROR',errcode:14}});
  });
  it('sends host scope separately from declared input and refuses an invalid scope before starting a process',async()=>{
    const f=setup(),scope={projectId:'project-original',operationId:randomUUID(),callerKind:'agent' as const,runId:'run-original'};
    await expect(f.child.execute('demo-tracker.items.list',{mode:'probe'}, {},undefined,undefined,{...scope,projectId:''})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(f.child.pid).toBeUndefined();
    await expect(f.child.execute('demo-tracker.items.list',{mode:'probe'}, {},undefined,undefined,scope)).resolves.toMatchObject({scope});
  });
  it('retains bounded business error identifiers without echoing remote text, and keeps submitted write failures unknown',async()=>{
    const read=setup();await expect(read.execute({mode:'business-error'})).rejects.toMatchObject({code:'AUTH_FAILED'});await expect(read.execute({mode:'business-error'})).rejects.not.toHaveProperty('message',expect.stringContaining('DO_NOT_ECHO'));
    const write=setup({write:true});await expect(write.execute({mode:'business-error'})).rejects.toMatchObject({code:'UPSTREAM_RESULT_UNKNOWN'});expect(readFileSync(join(write.data,'calls.log'),'utf8')).toBe('business-error\n');
  });
});
