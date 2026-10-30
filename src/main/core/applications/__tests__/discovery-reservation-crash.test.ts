import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {DiscoveryCatalog} from '../discovery-catalog';
import {CapabilityRunRegistry} from '../run-registry';
import {MacProcessIdentityReader} from '../process-identity';
import {treeHash} from '../../capabilities/assets';
import {writeOwnedTree} from '../../capabilities/files';
import {projectSkillName,standardNativeSkillName} from '../session-projector';
import {agentFixture} from './agent-fixture';

let build:string,a:Awaited<ReturnType<typeof agentFixture>>,b:Awaited<ReturnType<typeof agentFixture>>;
const children=new Set<ChildProcess>();
beforeAll(async()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-h-reservation-build-'));
  await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared'),'@root':resolve('.')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/discovery-reservation-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{a=await agentFixture();b=await agentFixture();});
async function kill(child:ChildProcess){
  if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}
  children.delete(child);
}
afterEach(async()=>{await Promise.all([...children].map(kill));a.cleanup();b.cleanup();});
async function launch(phase:string,taskId:string){
  const child=spawn(process.execPath,[join(build,'child.cjs'),a.root,a.home,resolve('out/native/willyou-process-identity'),phase,taskId],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});
  children.add(child);
  const row=await new Promise<{phase:string;pid:number;runId:string;ptyId:string}>((accept,reject)=>{
    let text='',errors='';
    const timer=setTimeout(()=>reject(Error('reservation checkpoint timeout '+errors)),4000);
    child.stderr!.on('data',data=>errors+=data);
    child.stdout!.on('data',data=>{
      text+=data;if(!text.includes('\n'))return;clearTimeout(timer);
      try{const parsed=JSON.parse(text.split('\n')[0]);expect(parsed).toMatchObject({phase,pid:child.pid});accept(parsed);}catch(error){reject(error);}
    });
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('reservation child exited before checkpoint '+errors));});
  });
  return {child,row};
}
async function nextSource(){
  const files={...b.standard.files,'references/reservation.txt':'independent store publication'},hash=treeHash(files),nativeName=standardNativeSkillName(b.standard.id,hash);
  writeOwnedTree(join(b.store.root,'packages',b.standard.id,hash),files,join(b.store.root,'conflicts'));
  const resource=await b.legacy.adoptStandard(b.standard.id,hash);
  return {nativeName,sourceHash:hash,sourceResourceId:resource.resourceId,files:Object.fromEntries(Object.entries(files).map(([path,bytes])=>[path,path==='SKILL.md'?projectSkillName(Buffer.from(bytes),nativeName):Buffer.from(bytes)])),executables:new Set<string>()};
}
describe.skipIf(process.platform!=='darwin')('real reservation host loss across two stores sharing H',()=>{
  it.each(['h-intent','c-committed'] as const)('retains the foreign %s residue until its own store proves safe recovery',async phase=>{
    const processes=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
    const original=new DiscoveryCatalog(a.store,a.home,processes),other=new DiscoveryCatalog(b.store,a.home,processes);
    a.setExtraVerifier((resource,snapshot)=>original.verifyReference(resource,snapshot));
    const snapshot=a.plan('codex'),sources=a.projector.sourceSkills(snapshot),collection=await original.publish(sources);
    snapshot.catalogGeneration=collection.generation;
    const saved=await a.sessions.create(snapshot,a.home);
    for(const entry of collection.entries)await a.sessions.addProjectionReference(snapshot.taskId,saved.pointer.snapshotHash,entry.resourceId);
    await a.sessions.verifyResources(snapshot.taskId);
    const sourceTrees=sources.map(source=>a.snapshotTree(a.store.directory(a.store.get(source.sourceResourceId))));
    const refs=a.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all();
    const catalogBytes=readFileSync(join(original.root,'catalog.json'));
    const {child,row}=await launch(phase,snapshot.taskId);
    const file=join(original.root,'catalog-consumers',a.store.storeId+'-'+row.runId+'.json'),bytes=readFileSync(file);
    const consumer=JSON.parse(bytes.toString()),identity=processes.read(child.pid!);
    expect(identity).not.toBeNull();expect(consumer).toMatchObject({phase:'preparing',runId:row.runId,ptyId:row.ptyId,owner:{pid:child.pid,startedAt:identity!.startedAt,storeId:a.store.storeId}});
    const committed=a.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(row.runId);
    if(phase==='h-intent')expect(committed).toBeUndefined();else expect(committed).toMatchObject({state:'preparing',owner_pid:child.pid});
    await kill(child);expect(processes.state(identity!)).toBe('stopped');

    // B cannot claim or reap A's residue, including the pre-C window that has
    // no corresponding run row in either store. H lock recovery is real.
    const bRunsBefore=b.sqlite.prepare('SELECT * FROM capability_runs').all();
    expect(await other.recoverConsumers()).toEqual([]);
    expect(readFileSync(file)).toEqual(bytes);
    expect(a.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(row.runId)).toEqual(committed);
    expect(b.sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual(bRunsBefore);
    const source=await nextSource();
    await expect(other.publish([source],{waitMs:40})).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    expect(readFileSync(file)).toEqual(bytes);expect(readFileSync(join(original.root,'catalog.json'))).toEqual(catalogBytes);
    expect(existsSync(join(original.root,'pending.json'))).toBe(false);

    const recovered=new DiscoveryCatalog(a.store,a.home,processes);
    if(phase==='c-committed'){
      expect(await recovered.recoverConsumers()).toEqual([{runId:row.runId,state:'retained'}]);
      expect(readFileSync(file)).toEqual(bytes);
      const runs=new CapabilityRunRegistry(a.store,a.sessions,{processes,assertCurrent:()=>{},revoke:()=>{}});
      expect(await runs.recover()).toEqual([{runId:row.runId,state:'stopped'}]);
      expect(a.sqlite.prepare('SELECT state FROM capability_run_processes WHERE run_id=?').all(row.runId)).toEqual([{state:'canceled'}]);
      expect(runs.get(row.runId).state).toBe('stopped');
      expect(a.sqlite.prepare('SELECT revocation_state FROM capability_runs WHERE run_id=?').get(row.runId)).toEqual({revocation_state:'revoked'});
    }
    expect(await recovered.recoverConsumers()).toEqual([{runId:row.runId,state:'released'}]);
    expect(readdirSync(join(original.root,'catalog-consumers'))).toEqual([]);
    const published=await other.publish([source]);
    other.verify(published);expect(published.entries).toHaveLength(collection.entries.length+1);
    expect(published.entries.filter(entry=>entry.storeId===a.store.storeId)).toEqual(collection.entries);
    expect(sources.map(s=>a.snapshotTree(a.store.directory(a.store.get(s.sourceResourceId))))).toEqual(sourceTrees);
    expect((await a.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);
    expect(a.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all()).toEqual(refs);
    expect(a.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(b.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  },14000);
});
