// T49 steps 8-10: actual application publication/OS termination, not a model,
// Agent or App UI. Normal publication and deliberate kernel-lock pauses differ.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applicationMcpServerName, applicationNativeSkillName } from '../../../src/shared/application-session';
import { fixtureBundle } from '../../../src/main/core/applications/__tests__/fixtures';
import { runFixture } from '../../../src/main/core/applications/__tests__/run-fixture';
import { applicationSkillContentHash } from '../../../src/main/core/applications/session-registry';
import { digest, manifestHash } from '../../../src/main/core/applications/manifest';
import { ResourceStore } from '../../../src/main/core/applications/resource-store';
import { PackageRegistry } from '../../../src/main/core/applications/package-registry';
import { MacProcessIdentityReader } from '../../../src/main/core/applications/process-identity';
import { ApplicationVersionMaintenance } from '../../../src/main/core/applications/version-maintenance';

let compiled: string;
const helper = resolve('out/native/willyou-process-identity');
const proofPath = process.env.WILLYOU_M10_T49_PROOF ?? join(tmpdir(), 'willyou-t49-proof-' + process.pid + '-' + Date.now() + '.jsonl');
type Fixture = Awaited<ReturnType<typeof runFixture>>;
function selection(f: Fixture, source: ReturnType<typeof fixtureBundle>) {
  const snapshot = structuredClone(f.snapshot), manifest = source.manifest, hash = manifestHash(manifest);
  snapshot.taskId = randomUUID(); snapshot.createdAt = new Date().toISOString();
  const serverName = applicationMcpServerName(digest(snapshot.taskId));
  snapshot.packages = [{ appId: manifest.appId, version: manifest.version, packageHash: hash, hashAlgorithm: 'app-manifest-v1', hostApi: manifest.hostApi, dataApi: manifest.dataApi, runtimeHash: manifest.runtime.hash,
    toolContractMajors: Object.fromEntries(manifest.tools.map(tool => [tool.name, tool.contractMajor])),
    skills: manifest.skills.map(skill => { const name = applicationNativeSkillName(manifest.appId, skill.id, hash); return { skillId: skill.id, nativeName: name, contentHash: applicationSkillContentHash(manifest, skill.path), sourceRelativePath: skill.path, projectionPath: join(f.store.root, 'sessions', snapshot.taskId, 'claude/plugin/skills', name, 'SKILL.md') }; }), bindings: [], allowedOperations: manifest.permissions }];
  snapshot.mcp = [{ kind: 'applications', serverName, protocolMajor: 1, runtimeHash: manifest.runtime.hash }];
  snapshot.adapterBinding.nativeToolNames = Object.fromEntries(manifest.tools.map(tool => [tool.name, 'mcp__' + serverName + '__' + tool.name]));
  return snapshot;
}
async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGKILL'); await done;
}
async function checkpoint(child: ChildProcess) {
  return new Promise<{ phase: string; pid: number }>((done, fail) => {
    let text = '', errors = '';
    const timer = setTimeout(() => fail(Error('T49 publisher readiness timeout: ' + errors)), 10000);
    child.stderr!.on('data', data => { errors = (errors + String(data)).slice(-4096); });
    child.stdout!.on('data', data => { text += String(data); if (text.includes('\n')) { clearTimeout(timer); try { done(JSON.parse(text.split('\n')[0])); } catch (error) { fail(error); } } });
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('exit', () => { clearTimeout(timer); fail(Error('T49 publisher exited before checkpoint: ' + errors)); });
  });
}
describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('T49 real package publication, competing consumers and durable recovery', () => {
  beforeAll(async () => {
    writeFileSync(proofPath, '', { flag: 'wx', mode: 0o600 });
    compiled = mkdtempSync(join(tmpdir(), 'willyou-t49-publisher-build-'));
    await build({ configFile: false, publicDir: false, logLevel: 'error', resolve: { alias: { '@shared': resolve('src/shared') } }, ssr: { noExternal: true },
      build: { ssr: resolve('scripts/applications/acceptance/package-publisher-child.ts'), target: 'node22', outDir: compiled, minify: false,
        rollupOptions: { external: id => id === 'better-sqlite3' || id.startsWith('node:') || builtinModules.includes(id), output: { format: 'cjs', entryFileNames: 'publisher.cjs', inlineDynamicImports: true } } } });
  }, 30000);
  afterAll(() => { if (compiled) rmSync(compiled, { recursive: true, force: true }); });
  it.each(['registered', 'materialized', 'renamed'] as const)('keeps incomplete %s unavailable to install, session, activation and GC; recovers exact content after SIGKILL', async phase => {
    const processes = new MacProcessIdentityReader(helper), f = await runFixture(processes, { application: true });
    let child: ChildProcess | undefined;
    const proof: Record<string, unknown> = { phase, proofPath, layer: 'service/native process; controlled host selection, no Agent/App/model/network', outcomes: [] };
    try {
      const source = fixtureBundle('2.0.0'); source.manifest.runtime.hash = f.applicationSource!.manifest.runtime.hash;
      const hash = manifestHash(source.manifest), original = await f.sessions.get(f.snapshot.taskId), oldDefault = f.packageRegistry.active('zentao');
      proof.originalSnapshotHash = original.pointer.snapshotHash; proof.originalPackageHash = f.application!.packageHash;
      const input = join(f.root, 'next-bundle.json'); writeFileSync(input, JSON.stringify({ manifest: source.manifest, files: Object.fromEntries(Object.entries(source.files).map(([path, bytes]) => [path, bytes.toString('base64')])) }));
      child = spawn(process.execPath, [join(compiled, 'publisher.cjs'), f.root, helper, input, phase], { env: { PATH: process.env.PATH, HOME: f.home, NODE_PATH: resolve('node_modules'), ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      expect(await checkpoint(child)).toEqual({ phase, pid: child.pid });
      const owner = processes.read(child.pid!)!; expect(owner).not.toBeNull(); expect(processes.state(owner)).toBe('running');
      const store = new ResourceStore(f.sqlite, f.root, undefined, { processes }), packages = new PackageRegistry(store, 'T49-parent');
      const pending = store.get('app:' + hash); expect(pending.state).not.toBe('ready'); expect(packages.active('zentao')).toEqual(oldDefault);
      const operation = pending.operationId!, before = f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=? ORDER BY lease_id').all(operation);
      const candidate = selection(f, source), healthy = selection(f, f.applicationSource!);
      const blockedByKernel = phase === 'renamed';
      const work = [
        expect(packages.install(source)).rejects.toMatchObject({ code: blockedByKernel ? 'RESOURCE_BUSY' : 'RESOURCE_RECOVERY_REQUIRED' }),
        expect(packages.activate(hash, oldDefault!.generation)).rejects.toMatchObject({ code: blockedByKernel ? 'RESOURCE_BUSY' : 'RESOURCE_STATE_CHANGED' }),
        expect(f.sessions.create(candidate, f.home)).rejects.toMatchObject({ code: blockedByKernel ? 'RESOURCE_BUSY' : 'RESOURCE_STATE_CHANGED' }),
        (async () => { const maintenance = new ApplicationVersionMaintenance(store, processes); if (blockedByKernel) { await expect(maintenance.list('zentao')).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); return; } const row = (await maintenance.list('zentao')).items.find(item => item.packageHash === hash)!; expect(row.canCleanup).toBe(false); await expect(maintenance.cleanup({ appId: 'zentao', packageHash: hash, planHash: row.planHash })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); })(),
        ...(blockedByKernel ? [] : [(async () => { expect((await f.sessions.create(healthy, f.home)).snapshot.packages[0].packageHash).toBe(f.application!.packageHash); })()]),
      ];
      const results = await Promise.allSettled(work);
      proof.outcomes = results.map(result => result.status); proof.child = owner; proof.operationId = operation; proof.packageHash = hash; proof.renamedPauseHoldsKernelGate = blockedByKernel;
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'T49 competing operation assertions');
      expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=? ORDER BY lease_id').all(operation)).toEqual(before);
      expect(f.sqlite.prepare('SELECT task_id FROM capability_session_snapshots WHERE task_id=?').get(candidate.taskId)).toBeUndefined();
      await terminate(child); expect(processes.state(owner)).toBe('stopped');
      if (blockedByKernel) expect((await f.sessions.create(healthy, f.home)).snapshot.packages[0].packageHash).toBe(f.application!.packageHash);
      const ready = await packages.recoverInstall(source, operation); expect(ready).toMatchObject({ packageHash: hash, state: 'ready' });
      for (const [path, bytes] of Object.entries(source.files)) expect(readFileSync(join(store.root, ready.relativePath, path))).toEqual(bytes);
      expect(packages.active('zentao')).toEqual(oldDefault); expect(await f.sessions.get(f.snapshot.taskId)).toEqual(original);
      expect((await packages.recoverInstall(source, operation)).packageHash).toBe(hash);
      const repeats = await Promise.allSettled([packages.install(source), new PackageRegistry(store, 'T49-concurrent-request').install(source)]);
      for (const result of repeats) { expect(result.status).toBe('fulfilled'); if (result.status === 'fulfilled') expect(result.value.packageHash).toBe(hash); }
      expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_packages WHERE app_id=? AND version=?').get('zentao', '2.0.0')).toEqual({ n: 1 });
      expect(packages.active('zentao')).toEqual(oldDefault);
      await packages.activate(hash, oldDefault!.generation);
      expect((await f.sessions.create(candidate, f.home)).snapshot.packages[0].packageHash).toBe(hash);
      expect((await f.sessions.get(f.snapshot.taskId)).pointer).toEqual(original.pointer);
      expect(f.sqlite.prepare("SELECT count(*) AS n FROM capability_resource_leases WHERE owner_id=? AND state<>'released'").get(operation)).toEqual({ n: 0 });
      proof.completed = true;
    } finally {
      if (child) await terminate(child);
      try { appendFileSync(proofPath, JSON.stringify(proof) + '\n'); console.info('M10-T49-PUBLICATION ' + JSON.stringify(proof)); }
      finally { await f.runs.dispose(); f.cleanup(); }
    }
  }, 30000);
});
