import {openManagedDatabase} from '../../../db/managed-client';
import {mkdtempSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {builtinModules} from 'node:module';
import Database from 'better-sqlite3';
import {build as viteBuild} from 'vite';
import {beforeAll,afterAll,it,expect,describe} from 'vitest';
import {agentFixture} from './agent-fixture';
import {ResourceStore} from '../resource-store';
import {MacProcessIdentityReader} from '../process-identity';
import {acquireDatabaseAccess} from '../../../db/database-access-gate';
import {recoverBuiltinActivation,builtinActivationRequired} from '../activation-startup';
describe.skipIf(process.platform!=='darwin')('actual activation publisher termination',()=>{
 let build:string,source:string,helper:string;
 beforeAll(async()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-activation-child-'));source=join(build,'bundles');helper=resolve('out/native/willyou-process-identity');
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});
  execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',source,join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});
  await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared'),'@root':resolve('.')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/activation-publisher-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});
 },30000);
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 it.each(['registered','materialized','renamed','activation-transaction','activation-committed'] as const)('retains real publisher ownership at %s until SIGKILL, then resumes the original activation',async phase=>{
  const f=await agentFixture(),reader=new MacProcessIdentityReader(helper);let child:ChildProcess|undefined,db:Database.Database|undefined,managed:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
  try{
   f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));child=spawn(process.execPath,[join(build,'child.cjs'),f.root,source,helper,phase],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});let errors='';child.stderr!.on('data',bytes=>errors+=bytes);
   const checkpoint=await new Promise<{phase:string;pid:number}>((accept,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('publisher timeout '+errors)),10000);child!.stdout!.on('data',bytes=>{text+=bytes;if(text.includes('\n')){clearTimeout(timer);try{accept(JSON.parse(text.split('\n')[0]));}catch(error){reject(error);}}});child!.once('error',error=>{clearTimeout(timer);reject(error);});child!.once('exit',()=>{clearTimeout(timer);reject(new Error('early publisher exit '+errors));});});
   expect(checkpoint).toEqual({phase,pid:child.pid});const identity=reader.read(child.pid!)!;expect(identity).not.toBeNull();await expect(acquireDatabaseAccess(f.root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');
   const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;expect(reader.state(identity)).toBe('stopped');
   db=new Database(join(f.root,'smartdd.db'));const operation=db.prepare("SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'").get() as {operation_id:string;state:string};expect(operation.state).toBe(phase==='activation-committed'?'committed':'verified');
   const resource=db.prepare("SELECT resource_id,operation_id FROM capability_resources WHERE state IN ('staged','verified')").get() as {resource_id:string;operation_id:string};if(!phase.startsWith('activation-'))expect(resource).toBeDefined();
   const lease=await acquireDatabaseAccess(f.root,'maintenance');try{
    if(phase.startsWith('activation-'))for(const state of ['running','unknown'] as const){
      const guarded=new ResourceStore(db,f.root,undefined,{processes:{read:pid=>reader.read(pid),state:()=>state}}),before=db.serialize();
      await expect(guarded.recoverActivationLeases(operation.operation_id,lease)).rejects.toThrow('仍存活或身份未知');expect(db.serialize()).toEqual(before);
    }
   }finally{lease.release();}
   db.close();let recovered=0;
   managed=await openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>builtinActivationRequired(store,source),recoverActivation:async(store,held,id)=>{expect(held.mode).toBe('maintenance');expect(id).toBe(operation.operation_id);recovered++;await recoverBuiltinActivation(store,held,id,source);}});
   db=managed.sqlite;const store=new ResourceStore(db,f.root,undefined,{processes:reader});
   expect(recovered).toBe(phase==='activation-committed'?0:1);
   if(resource)expect(store.get(resource.resource_id)).toMatchObject({state:'ready',operationId:resource.operation_id});expect(builtinActivationRequired(store,source)).toBe(false);
   expect(db.prepare("SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([{operation_id:operation.operation_id,state:'committed'}]);expect(db.prepare("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'").get()).toEqual({n:0});
   await expect(acquireDatabaseAccess(f.root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');
   if(phase==='activation-committed'){
    const receipts=db.prepare("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'").all();
    db.exec("CREATE TABLE after_upgrade_business(value TEXT); INSERT INTO after_upgrade_business VALUES('preserve-new-write')");managed.close();
    managed=await openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>builtinActivationRequired(store,source),recoverActivation:async()=>{throw new Error('committed upgrade must not replay');}});db=managed.sqlite;
    expect(db.prepare('SELECT * FROM after_upgrade_business').all()).toEqual([{value:'preserve-new-write'}]);expect(db.prepare("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual(receipts);
   }

  }finally{if(child&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;}managed?.close();if(db?.open)db.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
 },20000);
});
