import {BRIDGE_LIMITS} from '@shared/application-bridge';
import {nativeApplicationConflicts} from '../native-application-conflicts';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAgentAdapters } from '../agent-assets';
import { ownedBundle, writeOwnedBundle } from '../owned-bundle';
import { agentFixture } from './agent-fixture';
let f: Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async () => { f = await agentFixture(); }); afterEach(() => f.cleanup());
describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('fixed adapter packages and actual complete Skill projection plans', () => {



  it('requires a callable fixed recovery entry and exact native-version evidence',async()=>{
    const source=bundledAgentAdapters()[0],version='1.0.7';
    const metadata={...source.metadata,version,bridgeRecovery:'supported' as const,configReload:'supported' as const,recoveryRequiresAgentRestart:false,recoveryEntry:'replaceBridge' as const,recoveryEvidence:source.metadata.cliVersions.map(cliVersion=>({cliVersion,baseline:'controlled adapter fixture only'}))};
    const files={...source.files,'index.cjs':Buffer.from(source.files['index.cjs'].toString().replace("exports.version = '1.0.0'",`exports.version = '${version}'`))};
    const missing=await f.adapters.install(metadata,files);
    expect(()=>f.adapters.recovery(missing.hash,metadata.cliVersions[0])).toThrow('已验证入口');
    const readyVersion='1.0.8',ready=await f.adapters.install({...metadata,version:readyVersion},{...files,'index.cjs':Buffer.from(files['index.cjs'].toString().replace(`exports.version = '${version}'`,`exports.version = '${readyVersion}'`)+"\nexports.replaceBridge = async function(request) { if (request.signal.aborted) throw new Error('aborted'); };\n")});
    const descriptor=f.adapters.recovery(ready.hash,metadata.cliVersions[0]);expect(descriptor.capability).toBe('supported');expect(descriptor.replace).toBeTypeOf('function');
    expect(f.adapters.recovery(ready.hash,'99.99.99')).toEqual({capability:'unverified'});
    const controller=new AbortController();controller.abort();
    await expect(descriptor.replace!({runId:'fixture',serverName:'mail',bridgeInstanceId:'fixture',generation:1,bootstrapPath:'/private/fixture',signal:controller.signal})).rejects.toMatchObject({code:'CANCELED'});
  });
  it('installs complete CJS adapters without replacing one version and retains the old adapter after a new install', async () => {
    const source = bundledAgentAdapters()[0], first = await f.adapters.install(source.metadata,source.files); expect(first.hash).toBe(f.installedAdapters[0].hash);
    const changed = { ...source.files,'planner.cjs': Buffer.from(source.files['planner.cjs'].toString() + '\n// changed\n') }; await expect(f.adapters.install(source.metadata,changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const next = await f.adapters.install({ ...source.metadata,version: '1.0.1' },{ ...source.files,'index.cjs': Buffer.from(source.files['index.cjs'].toString().replace("exports.version = '1.0.0'","exports.version = '1.0.1'")) }); expect(next.hash).not.toBe(first.hash); expect(f.adapters.verify(first.hash).hash).toBe(first.hash);
  });
  const negativePlatforms: {runner:'claude-code'|'codex';platform:NodeJS.Platform;arch:string}[] = ['claude-code','codex'].flatMap(runner => ([['win32','x64'],['linux','x64'],['darwin','x64']] as const).map(([platform,arch]) => ({runner:runner as 'claude-code'|'codex',platform,arch})));
  // R15 allows an undeclared semantic Codex version to use best-effort MCP (T25
  // above). These negative cases require an absent/unparseable version instead.

});
