import { spawn,type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { build as viteBuild } from 'vite';
import Database from 'better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { withResourceLock } from '../resource-lock';
import { withDiscoveryLock } from '../discovery-catalog-lock';
import { MacProcessIdentityReader } from '../process-identity';
let build:string,root:string;
const children = new Set<ChildProcess>();
type Kind = 'C'|'H';
const directory = (kind:Kind) => join(root,kind === 'C' ? 'locks/resource.lock' : 'catalog.lock');
const lock = <T>(kind:Kind,action:()=>T,options:{ timeoutMs?:number;signal?:AbortSignal }={}) => kind === 'C' ? withResourceLock(root,action,options) : withDiscoveryLock(root,{ pid:process.pid,startedAt:'fixture-not-recovery-authority' },action,options);
async function holder(kind:Kind,mode='hold'):Promise<ChildProcess> {
  const child=spawn(process.execPath,[join(build,'child.cjs'),root,kind,mode,resolve('out/native/willyou-process-identity')],{ env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe'] });children.add(child);child.once('exit',()=>children.delete(child));
  await new Promise<void>((accept,reject)=>{
    let output='',errors='';const timer=setTimeout(()=>reject(Error('coordinator checkpoint timeout '+errors)),4000);
    child.stderr!.on('data',data=>errors+=data);child.stdout!.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);try{expect(JSON.parse(output.split('\n')[0])).toEqual({pid:child.pid,kind});accept();}catch(error){reject(error);}}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('coordinator exited before checkpoint '+errors));});
  });return child;
}
async function kill(child:ChildProcess):Promise<void> { if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;} }
beforeAll(async()=>{build=mkdtempSync(join(tmpdir(),'willyou-coordinator-build-'));await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/coordinator-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-coordinator-')));});
afterEach(async()=>{await Promise.all([...children].map(kill));rmSync(root,{recursive:true,force:true});});
describe('C/H actual critical-section termination and exclusive handoff',()=>{
  it.each(['C','H'] as const)('keeps a live %s owner then reacquires after SIGKILL without changing the business ledger',async kind=>{
    const ledger=join(root,'business-ledger');writeFileSync(ledger,'unmodified operation and resource leases');
    const child=await holder(kind),owner=readFileSync(join(directory(kind),'owner.json'));
    await expect(lock(kind,()=>{throw Error('must not enter while owner lives');},{timeoutMs:40})).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    expect(readFileSync(join(directory(kind),'owner.json'))).toEqual(owner);
    await kill(child);
    expect(await lock(kind,()=>42,{timeoutMs:1000})).toBe(42);
    expect(existsSync(directory(kind))).toBe(false);expect(readFileSync(ledger,'utf8')).toBe('unmodified operation and resource leases');
  });
  it.each(['C','H'] as const)('serializes concurrent %s recovery contenders after the original owner stops',async kind=>{
    const child=await holder(kind);await kill(child);const counter=join(root,'counter');writeFileSync(counter,'0');
    await Promise.all(Array.from({length:4},async()=>{
      const contender=spawn(process.execPath,[join(build,'child.cjs'),root,kind,'increment'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','ignore','pipe']});children.add(contender);contender.once('exit',()=>children.delete(contender));
      let errors='';contender.stderr!.on('data',data=>errors+=data);const [exit]=await once(contender,'exit');expect({exit,errors}).toEqual({exit:0,errors:''});
    }));
    expect(readFileSync(counter,'utf8')).toBe('4');expect(existsSync(directory(kind))).toBe(false);
  });
  it.each(['C','H'] as const)('preserves unrecognized legacy %s owners even with an absent PID',async kind=>{
    mkdirSync(directory(kind),{recursive:true});const owner={schema:1,token:'historical-owner',pid:2147483646,startedAt:'darwin-proc-v1:1:1'};writeFileSync(join(directory(kind),'owner.json'),JSON.stringify(owner));
    await expect(lock(kind,()=>42,{timeoutMs:20})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(JSON.parse(readFileSync(join(directory(kind),'owner.json'),'utf8'))).toEqual(owner);
  });
  it.each(['C','H'] as const)('cancels a %s gate wait without changing a live owner',async kind=>{
    const child=await holder(kind),before=readFileSync(join(directory(kind),'owner.json')),abort=new AbortController(),work=lock(kind,()=>42,{signal:abort.signal});abort.abort();
    await expect(work).rejects.toMatchObject({code:'CANCELED'});expect(readFileSync(join(directory(kind),'owner.json'))).toEqual(before);await kill(child);
  });
  it.each(['C','H'] as const)('preserves a stopped %s directory containing unrecognized user files',async kind=>{
    const child=await holder(kind);await kill(child);const file=join(directory(kind),'user-data');writeFileSync(file,'keep');
    await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(file,'utf8')).toBe('keep');
  });
  it.each(['C','H'] as const)('rejects a replaced %s gate inode without deleting the original owner',async kind=>{
    const child=await holder(kind);await kill(child);const dir=kind==='C'?join(root,'locks'):root,file=join(dir,'.'+(kind==='C'?'resource':'catalog')+'.lock.gate.sqlite'),before=readFileSync(join(directory(kind),'owner.json'));
    renameSync(file,file+'.original');writeFileSync(file,'');await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(join(directory(kind),'owner.json'))).toEqual(before);
  });
  it.each(['C','H'] as const)('rejects a linked %s gate before opening or writing its target',async kind=>{
    const dir=kind==='C'?join(root,'locks'):root;mkdirSync(dir,{recursive:true});const target=join(root,'user-sqlite'),file=join(dir,'.'+(kind==='C'?'resource':'catalog')+'.lock.gate.sqlite');writeFileSync(target,'user data');symlinkSync(target,file);
    await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(target,'utf8')).toBe('user data');
  });
  it.each(['C','H'] as const)('rejects a hard-linked %s owner file without deleting the other name',async kind=>{
    const child=await holder(kind);await kill(child);const file=join(directory(kind),'owner.json'),other=join(root,'owner-other'),before=readFileSync(file);linkSync(file,other);
    await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(other)).toEqual(before);expect(readFileSync(file)).toEqual(before);
  });
  it.skipIf(process.platform!=='darwin').each(['stopped','unknown'] as const)('requires exact kernel exit for a legacy H owner: %s',async state=>{
    const native=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),host=native.read(process.pid)!,child=await holder('H','legacy'),before=readFileSync(join(directory('H'),'owner.json'));
    const acquire=()=>withDiscoveryLock(root,host,()=>42,{timeoutMs:50,processes:native});
    await expect(acquire()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(join(directory('H'),'owner.json'))).toEqual(before);await kill(child);
    if(state==='stopped'){expect(await acquire()).toBe(42);expect(existsSync(directory('H'))).toBe(false);}
    else{await expect(withDiscoveryLock(root,host,()=>42,{timeoutMs:30,processes:{read:pid=>native.read(pid),state:()=> 'unknown'}})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(join(directory('H'),'owner.json'))).toEqual(before);}
  });
  it.each(['C','H'] as const)('preserves the %s directory when its gate content or journal mode is unrecognized',async kind=>{
    const child=await holder(kind);await kill(child);const dir=kind==='C'?join(root,'locks'):root,file=join(dir,'.'+(kind==='C'?'resource':'catalog')+'.lock.gate.sqlite'),before=readFileSync(join(directory(kind),'owner.json'));
    const sqlite=new Database(file);sqlite.pragma('journal_mode=WAL');sqlite.close();await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(join(directory(kind),'owner.json'))).toEqual(before);
    writeFileSync(file,'unrecognized gate database');await expect(lock(kind,()=>42)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(join(directory(kind),'owner.json'))).toEqual(before);
  });
});
