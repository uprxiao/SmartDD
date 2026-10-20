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
import { bundledAgentAdapters } from '../agent-assets';
import { RuntimeRegistry } from '../runtime-registry';
import { agentFixture } from './agent-fixture';
let build: string, output: string, runtimeEntry: string, f: Awaited<ReturnType<typeof agentFixture>>, capabilities: CapabilityService;
beforeAll(() => { build=mkdtempSync(join(tmpdir(),'willyou-m10-index-build-'));output=join(build,'bundles');const runtime=join(build,'runtime');runtimeEntry=join(runtime,'mcp-bridge.cjs');execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',runtime],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',output,runtimeEntry],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'}); });
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{f=await agentFixture({applicationVersion:'2.0.0'});const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});capabilities=new CapabilityService({db,projects:new ProjectService(db,secrets),secrets,userData:f.root});});
afterEach(()=>{capabilities.dispose();f.cleanup();});
describe('indexed production resource bootstrap and nonfatal readiness',()=>{
  it('builds an index whose complete adapter/runtime hashes match the runtime registries',async()=>{
    const source=new CapabilityBundleSource(output);expect(source.index.build.appVersion).toMatch(/^\d+\.\d+\.\d+$/);expect(source.index.adapters).toHaveLength(2);expect(source.index.runtimes).toHaveLength(1);
    const installed=await new RuntimeRegistry(f.store).install(source.runtime());expect(installed.contentHash).toBe(source.index.runtimes[0].hash);
    for(const bundle of source.adapters()){const record=await f.adapters.install(bundle.metadata,bundle.files);expect(record.hash).toBe(bundle.hash);expect(bundledAgentAdapters().find(a=>a.metadata.agentId===bundle.metadata.agentId)!.files).toEqual(bundle.files);}
  });
  it('initializes once from actual indexed files and exposes only prepared resources, with native discovery still unverified',async()=>{
    const service=new AgentSupportService(f.store,capabilities,output),first=service.initialize();expect(service.initialize()).toBe(first);await first;const status=service.status();expect(status.state).toBe('ready');expect(status.adapters.map(a=>a.agentId).sort()).toEqual(['claude-code','codex']);expect(status.adapters.every(a=>a.filesReady&&a.nativeDiscovery==='unverified'&&a.bridgeRecovery==='unverified')).toBe(true);expect(status.legacyResourceCount).toBe(3);expect(existsSync(join(f.home,'.agents'))).toBe(false);
    status.adapters.length=0;expect(service.status().adapters).toHaveLength(2);expect(f.packages.active('zentao')?.packageHash).toBe(f.application.packageHash);
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
    const foreign=join(f.root,'user-output');mkdirSync(foreign);writeFileSync(join(foreign,'user.txt'),'keep');expect(()=>execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',foreign,runtimeEntry],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:5000,stdio:'pipe'})).toThrow();expect(readFileSync(join(foreign,'user.txt'),'utf8')).toBe('keep');
  });
});
