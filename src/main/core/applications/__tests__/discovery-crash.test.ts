import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {DiscoveryCatalog,type DiscoveryCheckpoint} from '../discovery-catalog';
import {MacProcessIdentityReader} from '../process-identity';
import {agentFixture} from './agent-fixture';
let build:string,f:Awaited<ReturnType<typeof agentFixture>>;
const children=new Set<ChildProcess>();
beforeAll(async()=>{build=mkdtempSync(join(tmpdir(),'willyou-h-publisher-build-'));await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared'),'@root':resolve('.')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/discovery-publisher-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{f=await agentFixture();});
async function kill(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}children.delete(child);}
afterEach(async()=>{await Promise.all([...children].map(kill));f.cleanup();});
describe.skipIf(process.platform!=='darwin')('actual H publication termination including pre-C intent and both short locks',()=>{
  it.each(['intent-recorded','registered','renamed','catalog-published','records-committed'] satisfies ('intent-recorded'|DiscoveryCheckpoint)[])('restores the original %s operation after SIGKILL, preserving bytes and references',async phase=>{
    const native=resolve('out/native/willyou-process-identity'),processes=new MacProcessIdentityReader(native),catalog=new DiscoveryCatalog(f.store,f.home,processes),sources=f.projector.sourceSkills(f.plan('codex')),input=join(f.root,'publication-sources.json');
    writeFileSync(input,JSON.stringify(sources.map(s=>({...s,executables:[...s.executables],files:Object.fromEntries(Object.entries(s.files).map(([p,b])=>[p,Buffer.from(b).toString('base64')]))}))));
    const child=spawn(process.execPath,[join(build,'child.cjs'),f.root,f.home,native,phase,input],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});children.add(child);
    await new Promise<void>((accept,reject)=>{let text='',errors='';const timer=setTimeout(()=>reject(Error('H checkpoint timeout '+errors)),4000);child.stderr!.on('data',data=>errors+=data);child.stdout!.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timer);try{expect(JSON.parse(text.split('\n')[0])).toEqual({phase,pid:child.pid});accept();}catch(error){reject(error);}}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('H exited before checkpoint '+errors));});});
    const pendingPath=join(catalog.root,'pending.json'),pendingBytes=readFileSync(pendingPath),original=JSON.parse(pendingBytes.toString()),refs=f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all(),sourceTrees=sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId))));
    if(phase==='intent-recorded'){expect(f.sqlite.prepare('SELECT 1 FROM capability_resource_operations WHERE operation_id=?').get(original.operationId)).toBeUndefined();expect(existsSync(join(catalog.root,'catalog.lock'))).toBe(true);}
    if(phase==='renamed'){expect(existsSync(join(catalog.root,'catalog.lock'))).toBe(true);expect(existsSync(join(f.store.root,'locks/resource.lock'))).toBe(false);}
    await expect(catalog.recover(original.operationId,sources)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(pendingPath)).toEqual(pendingBytes);
    const identity=processes.read(child.pid!)!;await kill(child);expect(processes.state(identity)).toBe('stopped');
    if(phase==='intent-recorded'){
      const unknown=new DiscoveryCatalog(f.store,f.home,{read:pid=>processes.read(pid),state:()=> 'unknown'});
      await expect(unknown.recover(original.operationId,sources)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(pendingPath)).toEqual(pendingBytes);
    }
    const restored=await catalog.recover(original.operationId,sources);expect(restored.entries).toHaveLength(sources.length);catalog.verify(restored);expect(existsSync(pendingPath)).toBe(false);
    expect(f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all()).toEqual(refs);expect(sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId))))).toEqual(sourceTrees);
    expect(f.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(original.operationId)).toEqual({state:'committed'});expect(f.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE owner_id=? AND state<>'released'").get(original.operationId)).toBeUndefined();
  },12000);
});
