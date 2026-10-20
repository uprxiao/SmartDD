import { chmodSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { treeHash } from '../../capabilities/assets';
import { readOwnedTree } from '../../capabilities/files';
import { agentFixture } from './agent-fixture';
import { fixtureBundle } from './fixtures';
let f: Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async () => { f = await agentFixture(); }); afterEach(() => f.cleanup());
describe('full immutable Skill projection and original M4 resource adoption', () => {
  it('preserves all original M4 bytes, marker and legacy hash through repeat adoption', async () => {
    const before = f.snapshotTree(f.standardPath), runtimeBefore = f.snapshotTree(f.legacyPath); await f.legacy.adoptStandard(f.standard.id,f.standard.hash); await f.legacy.adoptRuntime(f.legacyHash);
    expect(f.snapshotTree(f.standardPath)).toEqual(before); expect(f.snapshotTree(f.legacyPath)).toEqual(runtimeBefore); expect(treeHash(readOwnedTree(f.standardPath))).toBe(f.standard.hash); expect(JSON.parse(readFileSync(join(f.standardPath,'.smartdd-owned.json'),'utf8'))).toEqual({ owner: 'SmartDD',schema: 1 });
  });
  it('copies binary assets, executable scripts and complete standard references, rewriting only derived Skill metadata', async () => {
    const snapshot = f.plan(), before = f.snapshotTree(f.standardPath), original = readFileSync(join(f.store.root,f.application.relativePath,'skills/query/SKILL.md')); await f.sessions.create(snapshot,f.home); const projected = await f.projector.claude(snapshot.taskId), appRoot = join(projected.root,'skills',snapshot.packages[0].skills[0].nativeName);
    expect(readFileSync(join(appRoot,'assets/data.bin'))).toEqual(Buffer.from([0,255,192,128,10])); expect(readFileSync(join(appRoot,'references/version.txt'),'utf8')).toBe('original-v1-reference'); expect(lstatSync(join(appRoot,'scripts/run.sh')).mode & 0o111).toBe(0o100); expect(readFileSync(join(appRoot,'SKILL.md'),'utf8')).toContain('name: '+snapshot.packages[0].skills[0].nativeName);
    expect(readFileSync(join(f.store.root,f.application.relativePath,'skills/query/SKILL.md'))).toEqual(original); expect(f.snapshotTree(f.standardPath)).toEqual(before); for (const path of Object.keys(f.standard.files).filter(p => p!=='SKILL.md')) expect(readFileSync(join(projected.root,'skills',snapshot.standardSkills[0].projectionPath.split('/').at(-2)!,path),'utf8')).toBe(f.standard.files[path]); await f.sessions.verifyResources(snapshot.taskId);
  });
  it('keeps the original complete projection after a different package becomes the default', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const old = await f.projector.claude(snapshot.taskId), before = f.snapshotTree(old.root), next = fixtureBundle('2.0.0'); next.manifest.runtime.hash = f.source.manifest.runtime.hash; const installed = await f.packages.install(next); await f.packages.activate(installed.packageHash,1);
    const reused = await f.projector.claude(snapshot.taskId); expect(reused.resource.contentHash).toBe(old.resource.contentHash); expect(f.snapshotTree(old.root)).toEqual(before); expect((await f.sessions.get(snapshot.taskId)).snapshot.packages[0].version).toBe('1.0.0');
  });
  it('does not overwrite a user-owned namesake or follow a linked source file', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const projected = await f.projector.claude(snapshot.taskId), file = join(projected.root,'skills',snapshot.packages[0].skills[0].nativeName,'assets/data.bin'), foreign = join(f.root,'foreign.bin'); writeFileSync(foreign,'untouched'); rmSync(file); symlinkSync(foreign,file);
    await expect(f.projector.claude(snapshot.taskId)).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' }); expect(readFileSync(foreign,'utf8')).toBe('untouched'); expect(lstatSync(file).isSymbolicLink()).toBe(true);
  });
  it('rejects changed executable modes and keeps snapshot references available for repair', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const projection = await f.projector.claude(snapshot.taskId), file = join(projection.root,'skills',snapshot.packages[0].skills[0].nativeName,'scripts/run.sh'); chmodSync(file,0o600); await expect(f.sessions.verifyResources(snapshot.taskId)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect((await f.sessions.references(snapshot.taskId)).some(r => r.refId === projection.resource.resourceId)).toBe(true);
  });
  it('holds damaged or missing original legacy content instead of adopting a current replacement', async () => {
    const marker = join(f.standardPath,'.smartdd-owned.json'), before = readFileSync(marker); writeFileSync(marker,'{}'); await expect(f.legacy.adoptStandard(f.standard.id,f.standard.hash)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' }); expect(readFileSync(marker,'utf8')).toBe('{}'); writeFileSync(marker,before); rmSync(join(f.standardPath,'SKILL.md')); await expect(f.legacy.adoptStandard(f.standard.id,f.standard.hash)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
  });
});
