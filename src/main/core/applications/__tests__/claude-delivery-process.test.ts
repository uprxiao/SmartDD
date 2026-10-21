import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {builtinModules} from 'node:module';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {build as viteBuild} from 'vite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {ClaudeDeliveryCoordinator} from '../claude-delivery';
import {readClaudeSlot} from '../claude-delivery-state';
import {SessionCapabilityProjector} from '../session-projector';
import {MacProcessIdentityReader} from '../process-identity';
import {runFixture,FixtureProcessReader} from './run-fixture';
let build:string,helper:string,f:Awaited<ReturnType<typeof runFixture>>,processes:MacProcessIdentityReader,c:ClaudeDeliveryCoordinator;const children=new Set<ChildProcess>();
async function kill(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null){children.delete(child);return;}const exited=once(child,'exit');child.kill('SIGKILL');await exited;children.delete(child);}
async function publisher(phase:string,mode='prepare'){
 const child=spawn(process.execPath,[join(build,'child.cjs'),f.root,helper,f.snapshot.taskId,phase,mode],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});children.add(child);let stderr='';child.stderr!.on('data',b=>stderr+=b.toString());
 const message=await new Promise<{phase:string;pid:number}>((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('private Claude checkpoint timeout '+stderr)),12000);child.stdout!.on('data',data=>{text+=data.toString();if(text.includes('\n')){clearTimeout(timer);try{done(JSON.parse(text.split('\n')[0]));}catch(e){reject(e);}}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('private Claude publisher exited '+stderr));});});expect(message).toEqual({phase,pid:child.pid!});return child;
}
describe.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('actual isolated Claude directory publisher and repeated recovery termination',()=>{
 beforeAll(async()=>{helper=resolve('out/native/willyou-process-identity');build=mkdtempSync(join(tmpdir(),'willyou-claude-delivery-build-'));await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared'),'@root':resolve('.')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/claude-delivery-publisher-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});});
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 beforeEach(async()=>{f=await runFixture(new FixtureProcessReader(),{application:true,secondApplication:true,fullProjection:true});processes=new MacProcessIdentityReader(helper);c=new ClaudeDeliveryCoordinator(f.store,f.sessions,new SessionCapabilityProjector(f.store,f.sessions),processes,randomUUID());rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});});
 afterEach(async()=>{for(const child of [...children])await kill(child);await f.runs.dispose();f.cleanup();});
 it.each(['registered','backed-up','delivered'] as const)('keeps a live %s publisher,then completes the same journal/generation after actual SIGKILL',async phase=>{
  const child=await publisher(phase),owner=processes.read(child.pid!)!,before=readClaudeSlot(f.store,f.snapshot.taskId)!,id=before.pending!.id,generation=before.pending!.generation;
  await expect(c.recover(f.snapshot.taskId)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readClaudeSlot(f.store,f.snapshot.taskId)!.pending!.id).toBe(id);await kill(child);expect(processes.state(owner)).toBe('stopped');
  const token=await c.recover(f.snapshot.taskId);console.log('CLAUDE_DELIVERY_PROCESS_EVIDENCE '+JSON.stringify({phase,operationId:id,generation,publisher:owner,publisherStateAfterSIGKILL:processes.state(owner),recovered:readClaudeSlot(f.store,f.snapshot.taskId)?.current,parent:processes.read(process.pid),actualAgent:false}));expect(token).toMatchObject({generation,appIds:['mail']});expect(readClaudeSlot(f.store,f.snapshot.taskId)!.pending).toBeNull();expect(existsSync(f.snapshot.packages[1].skills[0].projectionPath)).toBe(true);expect(existsSync(f.snapshot.packages[0].skills[0].projectionPath)).toBe(false);const row=f.sqlite.prepare('SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(id) as {state:string;plan_json:string};expect(row.state).toBe('committed');expect(JSON.parse(row.plan_json).completedPending.participants).toHaveLength(2);await c.cancel(token!);
 },25000);
 it('retains every lease handoff when a second actual recovery owner is killed immediately after its C registration',async()=>{
  const original=await publisher('backed-up');await kill(original);const second=await publisher('claimed','recover'),before=readClaudeSlot(f.store,f.snapshot.taskId)!;expect(before.pending!.participants).toHaveLength(2);const ids=before.pending!.participants.map(p=>p.leaseId);await kill(second);
  const token=await c.recover(f.snapshot.taskId),op=f.sqlite.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(before.pending!.id) as {plan_json:string},participants=JSON.parse(op.plan_json).completedPending.participants as {leaseId:string}[];console.log('CLAUDE_DELIVERY_PROCESS_EVIDENCE '+JSON.stringify({phase:'recovery-owner-killed-after-C-registration',operationId:before.pending!.id,participants,parent:processes.read(process.pid),actualAgent:false}));expect(participants).toHaveLength(3);for(const id of ids)expect(participants.map(p=>p.leaseId)).toContain(id);for(const p of participants)expect(f.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(p.leaseId)).toEqual({state:'released'});await c.cancel(token!);
 },25000);
});
