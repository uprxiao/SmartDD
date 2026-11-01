import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../db/schema';
import { SecretsStore } from '../../../secrets';
import { CapabilityService } from '../../capabilities/capability-service';
import { ProjectService } from '../../projects/project-service';
import { AgentSupportService } from '../agent-support-service';
import { CapabilityBundleSource } from '../bundle-source';
import { bundledAgentAdapters,bundledLegacyAgentAdapters } from '../agent-assets';
import {activateBuiltinDistribution,builtinActivationReport,builtinActivationRequired,recoverBuiltinActivation} from '../activation-startup';
import {acquireDatabaseAccess} from '../../../db/database-access-gate';
import {ResourceStore} from '../resource-store';
import { RuntimeRegistry } from '../runtime-registry';
import {FixtureProcessReader} from './run-fixture';
import { agentFixture } from './agent-fixture';
let build: string, output: string, runtimeEntry: string, f: Awaited<ReturnType<typeof agentFixture>>, capabilities: CapabilityService;
beforeAll(() => { build=mkdtempSync(join(tmpdir(),'willyou-m10-index-build-'));output=join(build,'bundles');const runtime=join(build,'runtime');runtimeEntry=join(runtime,'mcp-bridge.cjs');execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',runtime],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',output,runtimeEntry,'--retained-v1-test-fixture'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'}); });
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{f=await agentFixture({applicationVersion:'2.0.0'});const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});capabilities=new CapabilityService({db,projects:new ProjectService(db,secrets),secrets,userData:f.root});});
afterEach(()=>{capabilities.dispose();f.cleanup();});
describe('indexed production resource bootstrap and nonfatal readiness',()=>{
  it('builds an index whose complete adapter/runtime hashes match the runtime registries',async()=>{
    const source=new CapabilityBundleSource(output);expect(source.index.build.appVersion).toMatch(/^\d+\.\d+\.\d+$/);expect(source.index.adapters).toHaveLength(6);expect(source.index.runtimes).toHaveLength(1);
    const installed=await new RuntimeRegistry(f.store).install(source.runtime());expect(installed.contentHash).toBe(source.index.runtimes[0].hash);
    for(const bundle of source.adapters()){const record=await f.adapters.install(bundle.metadata,bundle.files);expect(record.hash).toBe(bundle.hash);expect([...bundledAgentAdapters(),...bundledLegacyAgentAdapters()].find(a=>a.metadata.agentId===bundle.metadata.agentId&&a.metadata.version===bundle.metadata.version)!.files).toEqual(bundle.files);}
  });
  it('initializes once from actual indexed files and exposes only prepared resources, with native discovery still unverified',async()=>{
    const service=new AgentSupportService(f.store,capabilities,output),first=service.initialize();expect(service.initialize()).toBe(first);await first;const status=service.status();expect(status.state).toBe('ready');expect(status.adapters.map(a=>a.agentId+'@'+a.version).sort()).toEqual(['claude-code@1.0.0','claude-code@1.1.0','codex@1.0.0','codex@1.1.0','codex@1.2.0','codex@1.3.0']);expect(status.adapters.every(a=>a.filesReady&&a.nativeDiscovery==='unverified'&&a.bridgeRecovery==='unverified'&&a.configReload==='unverified'&&a.recoveryRequiresAgentRestart===null&&a.recoveryEvidence?.length===0)).toBe(true);expect(status.legacyResourceCount).toBe(3);expect(existsSync(join(f.home,'.agents'))).toBe(false);
    status.adapters.length=0;expect(service.status().adapters).toHaveLength(6);expect(f.packages.active('zentao')?.packageHash).toBe(f.application.packageHash);
  });
  it('does not throw when the distribution index is missing, leaving existing installed versions usable',async()=>{
    const service=new AgentSupportService(f.store,capabilities,join(f.root,'missing-index'));await expect(service.initialize()).resolves.toBeUndefined();expect(service.status()).toMatchObject({state:'unavailable',errorCode:'INVALID_PACKAGE'});expect(f.adapters.verify(f.installedAdapters[0].hash).resource.state).toBe('ready');
  });
  it('rejects modified code without installing its replacement or reporting discovery',async()=>{
    const copy=join(f.root,'damaged-distribution');cpSync(output,copy,{recursive:true});const index=new CapabilityBundleSource(copy).index,path=join(copy,index.adapters[0].path,'planner.cjs');writeFileSync(path,'module.exports = {changed:true};');const service=new AgentSupportService(f.store,capabilities,copy);await service.initialize();expect(service.status()).toMatchObject({state:'unavailable',errorCode:'HASH_MISMATCH'});expect(f.adapters.verify(f.installedAdapters[0].hash).metadata.version).toBe('1.0.0');expect(readFileSync(path,'utf8')).toContain('changed:true');
  });
  it('does not traverse a linked distribution directory or remove its external target',()=>{
    const copy=join(f.root,'linked-distribution');cpSync(output,copy,{recursive:true});const source=new CapabilityBundleSource(copy),entry=source.index.adapters[0], original=join(copy,entry.path),foreign=join(f.root,'foreign-source');renameSync(original,foreign);symlinkSync(foreign,original);expect(()=>source.adapters()).toThrow('文件树无效');expect(existsSync(join(foreign,'planner.cjs'))).toBe(true);
  });
  it('refuses an unknown build output tree rather than deleting user files',()=>{
    const foreign=join(f.root,'user-output');mkdirSync(foreign);writeFileSync(join(foreign,'user.txt'),'keep');expect(()=>execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',foreign,runtimeEntry,'--retained-v1-test-fixture'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:5000,stdio:'pipe'})).toThrow();expect(readFileSync(join(foreign,'user.txt'),'utf8')).toBe('keep');
  });
});

it('does not activate the first fresh default when the second indexed application cannot be installed',async()=>{
 const copy=join(f.root,'incomplete-app-set');cpSync(output,copy,{recursive:true});const source=new CapabilityBundleSource(copy);
 f.sqlite.exec('DELETE FROM capability_active_packages');
 const second=source.index.apps[1];rmSync(join(copy,second.path),{recursive:true});
 const service=new AgentSupportService(f.store,capabilities,copy);await service.initialize();
 expect(service.status().applications.some(item=>item.errorCode)).toBe(true);
 expect(f.sqlite.prepare('SELECT * FROM capability_active_packages').all()).toEqual([]);
});

it.skipIf(process.platform!=='darwin')('activates the trusted distribution as a complete set and retains the old package',async()=>{
 const lease=await acquireDatabaseAccess(f.root,'maintenance'),old=f.packages.active('zentao');
 try{
  expect(builtinActivationRequired(f.store,output)).toBe(true);await activateBuiltinDistribution(f.store,lease,output);expect(builtinActivationRequired(f.store,output)).toBe(false);
  const source=new CapabilityBundleSource(output);for(const app of source.index.apps)expect(f.packages.active(app.appId)?.packageHash).toBe(app.hash);
  expect(f.packages.get(old!.packageHash).state).toBe('ready');expect(f.sqlite.prepare("SELECT state FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([{state:'committed'}]);
 }finally{lease.release();}
},20000);
it.skipIf(process.platform!=='darwin')('resumes a caught runtime materialization failure from the original distribution and activation operation',async()=>{
 const lease=await acquireDatabaseAccess(f.root,'maintenance'),old=f.packages.active('zentao');let inject=true;
 const interrupted=new ResourceStore(f.sqlite,f.root,phase=>{if(phase==='registered'&&inject){inject=false;throw new Error('materialization interruption');}});
 try{
  await expect(activateBuiltinDistribution(interrupted,lease,output)).rejects.toThrow('materialization interruption');expect(f.packages.active('zentao')).toEqual(old);
  const operation=f.sqlite.prepare("SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'").get() as {operation_id:string;state:string};expect(operation.state).toBe('verified');
  await recoverBuiltinActivation(f.store,lease,operation.operation_id,output);expect(builtinActivationRequired(f.store,output)).toBe(false);
  expect(f.sqlite.prepare("SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'").all()).toEqual([{operation_id:operation.operation_id,state:'committed'}]);
 }finally{lease.release();}
},20000);

it.skipIf(process.platform!=='darwin')('reaches exact-resource recovery without releasing a live or unknown publisher, then resumes a stopped identity',async()=>{
 const lease=await acquireDatabaseAccess(f.root,'maintenance'),reader=new FixtureProcessReader();let fault=true;
 const interrupted=new ResourceStore(f.sqlite,f.root,phase=>{if(phase==='registered'&&fault){fault=false;throw new Error('seed interrupted publisher');}},{processes:reader});
 try{
  await expect(activateBuiltinDistribution(interrupted,lease,output)).rejects.toThrow('seed interrupted publisher');
  const activation=f.sqlite.prepare("SELECT operation_id FROM capability_resource_operations WHERE kind='application-activation'").get() as {operation_id:string};
  const publication=f.sqlite.prepare("SELECT operation_id FROM capability_resource_operations WHERE kind='install-runtime' AND state='failed'").get() as {operation_id:string};
  // Persistent-state fault injection, distinct from the native SIGKILL suite.
  f.sqlite.prepare("UPDATE capability_resource_operations SET state='preparing' WHERE operation_id=?").run(publication.operation_id);f.sqlite.prepare("UPDATE capability_resources SET state='staged' WHERE operation_id=?").run(publication.operation_id);f.sqlite.prepare("UPDATE capability_resource_leases SET state='active',ended_at=NULL WHERE owner_id=?").run(publication.operation_id);
  const reopened=new ResourceStore(f.sqlite,f.root,undefined,{processes:reader}),before=f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=?').all(publication.operation_id);
  await expect(recoverBuiltinActivation(reopened,lease,activation.operation_id,output)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=?').all(publication.operation_id)).toEqual(before);
  reader.unknown.add(process.pid);await expect(recoverBuiltinActivation(reopened,lease,activation.operation_id,output)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=?').all(publication.operation_id)).toEqual(before);
  reader.unknown.delete(process.pid);reader.identities.set(process.pid,'darwin-proc-v1:999:2');await recoverBuiltinActivation(new ResourceStore(f.sqlite,f.root,undefined,{processes:reader}),lease,activation.operation_id,output);
  expect(builtinActivationRequired(f.store,output)).toBe(false);expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'").get()).toEqual({n:0});
 }finally{lease.release();}
},20000);

it('returns a read-only upgrade report naming the actual target versions without mutating defaults',()=>{
 const before=f.sqlite.serialize(),report=builtinActivationReport(f.store,output),source=new CapabilityBundleSource(output);
 expect(report.targets.map(t=>({appId:t.appId,hash:t.packageHash,version:t.version}))).toEqual(source.index.apps.map(t=>({appId:t.appId,hash:t.hash,version:t.version})));
 expect(report.preflight?.issues).toEqual([]);expect(report.preflight?.requiredBytes).toBeGreaterThan(16*1024*1024);expect(f.sqlite.serialize()).toEqual(before);
});
