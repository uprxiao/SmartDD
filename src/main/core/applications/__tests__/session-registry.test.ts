import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationError } from '@shared/applications';
import { capabilitySessionSnapshotSchema, applicationNativeSkillName, applicationMcpServerName, type CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { runBundledMigrations } from '../../../db/migrations';
import { canonicalJson, digest } from '../manifest';
import { fileNames } from '../package-files';
import { PackageRegistry } from '../package-registry';
import { ResourceStore, type ResourceRecord } from '../resource-store';
import { RuntimeRegistry } from '../runtime-registry';
import { CapabilitySessionRegistry, applicationSkillContentHash } from '../session-registry';
import { treeHash } from '../../capabilities/assets';
import { readOwnedTree,writeOwnedTree } from '../../capabilities/files';
import { fixtureBundle } from './fixtures';
let root: string,home: string,stateRoot: string,cwd: string,sqlite: Database.Database,store: ResourceStore,packages: PackageRegistry,sessions: CapabilitySessionRegistry,runtimeHash: string,adapterHash: string,standardHash: string,legacyHash: string;
const originals = new Map<string,Buffer>(), trees = new Map<string,Record<string,string>>(), projections = new Map<string,{ taskId: string;files: Record<string,string> }>();
async function codeResource(resourceId: string,kind: string,path: string,content: string) {
  const bytes = Buffer.from(content), hash = digest(bytes); originals.set(resourceId,bytes);
  return store.publish({ resourceId,kind,relativePath: path,contentHash: hash,dependencies: [],materialize: directory => { mkdirSync(directory,{ mode: 0o700 }); writeFileSync(join(directory,'entry.cjs'),bytes,{ mode: 0o600 }); writeFileSync(join(directory,'.smartdd-owned.json'),canonicalJson({ owner: 'SmartDD',storeId: store.storeId,sourceHash: hash }),{ mode: 0o600 }); },verify: dir => {
    if (JSON.parse(readFileSync(join(dir,'.smartdd-owned.json'),'utf8')).storeId !== store.storeId || digest(readFileSync(join(dir,'entry.cjs'))) !== hash || canonicalJson(fileNames(dir).sort()) !== canonicalJson(['.smartdd-owned.json','entry.cjs'])) throw new ApplicationError('HASH_MISMATCH','fixture complete tree changed');
  } });
}
async function legacyTree(resourceId: string,kind: string,path: string,files: Record<string,string>) {
  const hash = treeHash(files); trees.set(resourceId,files);
  return store.publish({ resourceId,kind,relativePath: path,contentHash: hash,dependencies: [],materialize: directory => writeOwnedTree(directory,files,join(store.root,'conflicts')),verify: dir => { if (treeHash(readOwnedTree(dir)) !== hash) throw new ApplicationError('HASH_MISMATCH','legacy tree bytes changed'); } });
}
function verifyExtra(resource: ResourceRecord,snapshot?: CapabilitySessionSnapshotV2) {
  const projection = projections.get(resource.resourceId);
  if (projection) {
    if (snapshot?.taskId !== projection.taskId) throw new ApplicationError('OWNERSHIP_CONFLICT','projection belongs to another session');
    const root = join(store.root,resource.relativePath), actual = readOwnedTree(root);
    if (canonicalJson(actual) !== canonicalJson(projection.files) || digest(canonicalJson(actual)) !== resource.contentHash || [...snapshot.packages.flatMap(p => p.skills.map(s => s.projectionPath)),...snapshot.standardSkills.map(s => s.projectionPath)].some(path => !existsSync(path))) throw new ApplicationError('HASH_MISMATCH','projection changed');
    return;
  }
  const dir = join(store.root,resource.relativePath);
  if (trees.has(resource.resourceId)) { const actual = readOwnedTree(dir); if (canonicalJson(actual) !== canonicalJson(trees.get(resource.resourceId)) || treeHash(actual) !== resource.contentHash) throw new ApplicationError('HASH_MISMATCH','legacy tree identity changed'); return; }
  const path = join(store.root,resource.relativePath), bytes = readFileSync(join(path,'entry.cjs'));
  if (!originals.has(resource.resourceId) || !bytes.equals(originals.get(resource.resourceId)!) || digest(bytes) !== resource.contentHash || lstatSync(join(path,'entry.cjs')).isSymbolicLink() || fileNames(path).length !== 2) throw new ApplicationError('HASH_MISMATCH','fixture registered code resource changed');
}
async function app(version = '1.0.0') { const source = fixtureBundle(version); source.manifest.runtime.hash = runtimeHash; return { source,installed: await packages.install(source) }; }
function plan(taskId: string = randomUUID(),hash = packages.active('zentao')!.packageHash): CapabilitySessionSnapshotV2 {
  const p = packages.get(hash), manifest = p.manifest, skill = manifest.skills[0], nativeName = applicationNativeSkillName(p.appId,skill.id,p.packageHash), plugin = join(store.root,'sessions',taskId,'claude','plugin','skills');
  return { schema: 2,taskId,projectId: 'p1',createdAt: new Date().toISOString(),runner: 'claude-code',adapterBinding: { id: 'claude-code',version: '1.0.0',hash: adapterHash,projectionFormatVersion: 1,nativeToolNames: { smartdd_zentao_query_v1: 'mcp__' + applicationMcpServerName(digest(taskId)) + '__smartdd_zentao_query_v1' } },native: { sessionId: null,stateRoot,cwd },agentAtCreation: { version: 'fixture-cli-1',adapterRevision: 1 },catalogGeneration: 'fixture-generation',packages: [{ appId: p.appId,version: p.version,packageHash: p.packageHash,hashAlgorithm: 'app-manifest-v1',hostApi: manifest.hostApi,dataApi: manifest.dataApi,runtimeHash,toolContractMajors: Object.fromEntries(manifest.tools.map(t => [t.name,t.contractMajor])),skills: [{ skillId: skill.id,nativeName,contentHash: applicationSkillContentHash(manifest,skill.path),sourceRelativePath: skill.path,projectionPath: join(plugin,nativeName,'SKILL.md') }],bindings: [],allowedOperations: [...manifest.permissions] }],standardSkills: [{ skillId: 'fixture-standard',versionId: 'fixture-standard:' + standardHash,hash: standardHash,hashAlgorithm: 'legacy-tree-v1',projectionPath: join(plugin,'fixture-standard','SKILL.md') }],mcp: [{ kind: 'applications',serverName: applicationMcpServerName(digest(taskId)),protocolMajor: 1,runtimeHash },{ kind: 'legacy-project-context',serverName: 'smartdd_project_' + digest(taskId).slice(0,12),protocolMajor: 1,runtimeHash: legacyHash }],provenance: 'created' };
}
beforeEach(async () => {
  originals.clear(); trees.clear(); projections.clear(); root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-sessions-'))); home = join(root,'native-home'); stateRoot = join(home,'.claude'); cwd = join(root,'project'); mkdirSync(stateRoot,{ recursive: true }); mkdirSync(cwd); sqlite = new Database(join(root,'state.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); sqlite.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','fixture',1,1)").run(); store = new ResourceStore(sqlite,root); packages = new PackageRegistry(store,'fixture');
  const runtime = await new RuntimeRegistry(store).install({ id: 'applications',protocolMajor: 1,bridgeEntry: 'bridge.cjs',files: { 'bridge.cjs': Buffer.from('module.exports = {};\n') } }); runtimeHash = runtime.contentHash;
  const adapter = Buffer.from('module.exports = { fixtureAdapter: 1 };'); adapterHash = digest(adapter); await codeResource('agent-adapter:claude-code:' + adapterHash,'agent-adapter','agent-adapters/claude-code/1.0.0/' + adapterHash,adapter.toString());
  const standard = { 'SKILL.md': '---\nname: fixture-standard\ndescription: isolated legacy tree\n---\nRead references/data.txt.\n','references/data.txt': 'legacy unchanged fixture' }; standardHash = treeHash(standard); await legacyTree('standard-skill:fixture-standard:' + standardHash,'standard-skill','packages/fixture-standard/' + standardHash,standard);
  const legacy = { 'context_mcp.py': 'print("isolated legacy fixture, not launched")\n' }; legacyHash = treeHash(legacy); await legacyTree('legacy-runtime:' + legacyHash,'legacy-runtime','legacy-runtime/' + legacyHash,legacy);
  const first = await app(); await packages.activate(first.installed.packageHash,0);
  sessions = new CapabilitySessionRegistry(store,{ assertInitialSelection: snapshot => { if (snapshot.provenance === 'created' && snapshot.packages.some(p => packages.active(p.appId)?.packageHash !== p.packageHash)) throw new ApplicationError('RESOURCE_STATE_CHANGED','fixture defaults changed during creation'); },verifyExtraResource: verifyExtra });
});
afterEach(() => { sqlite.close(); rmSync(root,{ recursive: true,force: true }); });
const refRows = (taskId: string) => sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(taskId);
describe('fixed capability selection, native identity and authoritative snapshot mirrors', () => {
  it('commits complete source references and MCP identities with one selection and verifies actual bytes', async () => {
    const input = plan(), saved = await sessions.create(input,home);
    expect(saved.snapshot).toEqual(input); expect(saved.pointer.snapshotHash).toBe(digest(canonicalJson(input))); expect(refRows(input.taskId)).toHaveLength(5); await sessions.verifyResources(input.taskId);
    const mirror = JSON.parse(readFileSync(join(store.root,'sessions',input.taskId,'snapshot.json'),'utf8')); expect(mirror.snapshotHash).toBe(saved.pointer.snapshotHash); expect(mirror.snapshot).toEqual(input);
    expect(sqlite.prepare('SELECT count(*) AS n FROM capability_session_mcp_names WHERE task_id=?').get(input.taskId)).toEqual({ n: 2 });
    input.packages[0].allowedOperations.push('forged.operation'); expect((await sessions.get(saved.snapshot.taskId)).snapshot.packages[0].allowedOperations).toEqual(['zentao.read']);
  });
  it('preserves old package and names after default activation and rejects a replacement snapshot', async () => {
    const original = plan(), saved = await sessions.create(original,home), second = await app('2.0.0'); await packages.activate(second.installed.packageHash,1);
    expect((await sessions.get(original.taskId)).pointer).toEqual(saved.pointer); expect((await sessions.create(original,home)).snapshot.packages[0].version).toBe('1.0.0'); await sessions.verifyResources(original.taskId);
    const replacing = plan(original.taskId); await expect(sessions.create(replacing,home)).rejects.toMatchObject({ code: 'SNAPSHOT_IMMUTABLE' });
    expect((await sessions.get(original.taskId)).snapshot.mcp).toEqual(original.mcp); expect(refRows(original.taskId)).toHaveLength(5);
  });
  it('rejects stale new-task selection without leaving partial reference rows', async () => {
    const stale = plan(), second = await app('2.0.0'); await packages.activate(second.installed.packageHash,1);
    await expect(sessions.create(stale,home)).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' }); expect(sqlite.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').all(stale.taskId)).toEqual([]); expect(refRows(stale.taskId)).toEqual([]);
  });
  it('rejects undeclared tools, mismatched Skill trees, extra actions and two versions of one app', async () => {
    const a = plan(); a.packages[0].allowedOperations.push('zentao.future-write'); await expect(sessions.create(a,home)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' });
    const b = plan(); b.packages[0].skills[0].contentHash = 'f'.repeat(64); await expect(sessions.create(b,home)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' });
    const c = plan(); c.packages[0].toolContractMajors.forged_tool = 1; await expect(sessions.create(c,home)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' });
    const d = plan(); d.packages.push(d.packages[0]); expect(capabilitySessionSnapshotSchema.safeParse(d).success).toBe(false); expect(sqlite.prepare('SELECT * FROM capability_session_snapshots').all()).toEqual([]);
  });
  it('fills a null native ID once, retaining selection, references and stable names', async () => {
    const input = plan(), saved = await sessions.create(input,home), beforeRefs = refRows(input.taskId), native = { runner: input.runner,stateRoot,cwd,sessionId: 'native-session-1' };
    const bound = await sessions.bindNativeSession(input.taskId,saved.pointer.snapshotHash,native); expect(bound.selectionHash).toBe(saved.selectionHash); expect(bound.pointer.snapshotHash).not.toBe(saved.pointer.snapshotHash); expect(refRows(input.taskId)).toEqual(beforeRefs); expect(bound.snapshot.mcp).toEqual(input.mcp);
    expect((await sessions.bindNativeSession(input.taskId,saved.pointer.snapshotHash,native)).pointer).toEqual(bound.pointer);
    await expect(sessions.bindNativeSession(input.taskId,bound.pointer.snapshotHash,{ ...native,sessionId: 'different-native' })).rejects.toMatchObject({ code: 'NATIVE_IDENTITY_CONFLICT' });
    await sessions.verifyNativeIdentity(input.taskId,{ ...native,home }); await expect(sessions.verifyNativeIdentity(input.taskId,{ ...native,stateRoot: join(home,'.another'),home })).rejects.toMatchObject({ code: 'NATIVE_IDENTITY_CONFLICT' });
  });
  it('prevents two tasks from claiming the same native history including a symlink alias', async () => {
    const first = plan(); first.native.sessionId = 'native-shared'; await sessions.create(first,home);
    const alias = join(home,'alias'); symlinkSync(stateRoot,alias); const other = plan(); other.native = { ...other.native,stateRoot: alias,sessionId: 'native-shared' };
    await expect(sessions.create(other,home)).rejects.toMatchObject({ code: 'NATIVE_IDENTITY_CONFLICT' }); expect(sqlite.prepare('SELECT count(*) AS n FROM capability_session_snapshots').get()).toEqual({ n: 1 });
  });
  it('does not reassign historical MCP names even after the task becomes a tombstone', async () => {
    const first = plan(); await sessions.create(first,home); await sessions.tombstone(first.taskId); const other = plan(); other.mcp[0].serverName = first.mcp[0].serverName;
    await expect(sessions.create(other,home)).rejects.toMatchObject({ code: 'AGENT_CAPABILITY_NAME_CONFLICT' }); expect((await sessions.get(first.taskId)).retention).toBe('tombstone'); expect(refRows(first.taskId)).toHaveLength(5);
  });
  it('rebuilds a changed mirror from SQLite while preserving the mismatch and fixed DB hash', async () => {
    const input = plan(), saved = await sessions.create(input,home), path = join(store.root,'sessions',input.taskId,'snapshot.json'); writeFileSync(path,'synthetic damaged mirror');
    const repaired = await sessions.ensureMirror(input.taskId); expect(repaired.repaired).toBe(true); expect(readFileSync(repaired.backup!,'utf8')).toBe('synthetic damaged mirror'); expect(JSON.parse(readFileSync(path,'utf8')).snapshot).toEqual(input); expect((await sessions.get(input.taskId)).pointer).toEqual(saved.pointer);
    expect(await sessions.ensureMirror(input.taskId)).toEqual({ repaired: false,backup: null });
  });
  it('never follows or overwrites a foreign mirror target', async () => {
    const input = plan(); await sessions.create(input,home); const path = join(store.root,'sessions',input.taskId,'snapshot.json'), foreign = join(root,'user-owned.txt'); writeFileSync(foreign,'user data'); rmSync(path); symlinkSync(foreign,path);
    await expect(sessions.ensureMirror(input.taskId)).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' }); expect(readFileSync(foreign,'utf8')).toBe('user data'); expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });
  it.each(['before','after'] as const)('repairs DB bytes only from the registered hash and preserves deletion occurring %s corruption', async when => {
    const input = plan(), saved = await sessions.create(input,home); if (when === 'before') await sessions.tombstone(input.taskId);
    sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json='invalid bytes' WHERE task_id=?").run(input.taskId); await expect(sessions.get(input.taskId)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' }); expect(sessions.hasUnresolvedHistory()).toBe(true);
    if (when === 'after') await sessions.tombstone(input.taskId);
    const repaired = await sessions.repairFromRecordedVersion(input.taskId,saved.pointer.snapshotHash); expect(repaired.snapshot).toEqual(input); expect(repaired.retention).toBe('tombstone'); expect(sessions.hasUnresolvedHistory()).toBe(false);
    await expect(sessions.verifyResources(input.taskId)).rejects.toMatchObject({ code: 'SESSION_ON_HOLD' });
  });
  it('refuses to recover from a mirror or current defaults when the expected DB hash is not recorded', async () => {
    const input = plan(); await sessions.create(input,home); sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json='broken',snapshot_hash=? WHERE task_id=?").run('f'.repeat(64),input.taskId);
    await expect(sessions.get(input.taskId)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' }); await expect(sessions.repairFromRecordedVersion(input.taskId,'f'.repeat(64))).rejects.toMatchObject({ code: 'SESSION_ON_HOLD' }); expect(sessions.hasUnresolvedHistory()).toBe(true);
  });
  it('keeps unknown legacy empty of new apps and excludes unknown scopes from cleanup', async () => {
    const input = plan(); await sessions.holdUnknown({ taskId: input.taskId,projectId: input.projectId,runner: input.runner,stateRoot,cwd,sessionId: 'old-native',reason: 'history-unknown' });
    await expect(sessions.get(input.taskId)).rejects.toMatchObject({ code: 'SESSION_ON_HOLD' }); await expect(sessions.create(input,home)).rejects.toMatchObject({ code: 'SNAPSHOT_IMMUTABLE' }); expect(sessions.hasUnresolvedHistory()).toBe(true); expect(refRows(input.taskId)).toEqual([]);
    const another = plan(); another.native.sessionId = 'old-native'; await expect(sessions.create(another,home)).rejects.toMatchObject({ code: 'NATIVE_IDENTITY_CONFLICT' });
    const legacy = plan(); legacy.provenance = 'migrated-known-legacy'; legacy.packages = []; legacy.mcp = legacy.mcp.filter(m => m.kind !== 'applications'); await sessions.create(legacy,home); expect((await sessions.get(legacy.taskId)).snapshot.packages).toEqual([]);
    const forged = plan(); forged.provenance = 'migrated-known-legacy'; expect(capabilitySessionSnapshotSchema.safeParse(forged).success).toBe(false);
  });
  it('reports damaged resource bytes separately while retaining the original fixed selection and references', async () => {
    const input = plan(); await sessions.create(input,home); const resource = store.get('app:' + input.packages[0].packageHash), file = join(store.root,resource.relativePath,'adapter/index.cjs'), original = readFileSync(file); writeFileSync(file,'damaged package');
    expect((await sessions.get(input.taskId)).snapshot).toEqual(input); await expect(sessions.verifyResources(input.taskId)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(refRows(input.taskId)).toHaveLength(5);
    writeFileSync(file,original); await sessions.verifyResources(input.taskId); expect((await sessions.get(input.taskId)).snapshot.packages[0].packageHash).toBe(input.packages[0].packageHash);
  });
  it('adds only a verified projection for the same fixed session and retains it with the history', async () => {
    const input = plan(),saved = await sessions.create(input,home), relative = 'sessions/' + input.taskId + '/claude/plugin', files: Record<string,string> = {};
    for (const application of input.packages) {
      const installed = packages.get(application.packageHash);
      for (const skill of application.skills) for (const source of installed.manifest.files.filter(f => f.path.startsWith(skill.sourceRelativePath + '/'))) {
        const name = 'skills/' + skill.nativeName + '/' + source.path.slice(skill.sourceRelativePath.length + 1),text = readFileSync(join(store.root,installed.relativePath,source.path),'utf8');
        files[name] = source.path.endsWith('/SKILL.md') ? text.replace(/^name:.*$/m,'name: ' + skill.nativeName) : text;
      }
    }
    for (const standard of input.standardSkills) for (const [name,text] of Object.entries(trees.get('standard-skill:' + standard.skillId + ':' + standard.hash)!)) files['skills/' + standard.skillId + '/' + name] = text;
    const hash = digest(canonicalJson(files)),id = 'session-projection:' + input.taskId + ':' + hash; projections.set(id,{ taskId: input.taskId,files });
    await store.publish({ resourceId: id,kind: 'session-projection',contentHash: hash,relativePath: relative,dependencies: ['app:' + input.packages[0].packageHash],materialize: dir => writeOwnedTree(dir,files,join(store.root,'conflicts')),verify: dir => { if (canonicalJson(readOwnedTree(dir)) !== canonicalJson(files)) throw new Error('fixture projection mismatch'); } });
    await sessions.addProjectionReference(input.taskId,saved.pointer.snapshotHash,id); expect(refRows(input.taskId)).toHaveLength(6); await sessions.verifyResources(input.taskId);
    const other = plan(),next = await sessions.create(other,home); await expect(sessions.addProjectionReference(other.taskId,next.pointer.snapshotHash,id)).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' }); expect(refRows(other.taskId)).toHaveLength(5);
    await sessions.tombstone(input.taskId); expect(refRows(input.taskId)).toHaveLength(6); expect(() => sqlite.prepare('DELETE FROM capability_resources WHERE resource_id=?').run(id)).toThrow(/FOREIGN KEY/);
  });
  it('does not persist arbitrary fields through unknown-legacy metadata', async () => {
    const input = plan(), unknown = { taskId: input.taskId,projectId: input.projectId,runner: input.runner,stateRoot,cwd,sessionId: null,reason: 'history-unknown' as const,secret: 'fixture-not-to-be-stored' };
    await expect(sessions.holdUnknown(unknown)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(sqlite.prepare('SELECT * FROM capability_session_snapshots').all()).toEqual([]);
    expect(capabilitySessionSnapshotSchema.safeParse({ ...input,environment: { TOKEN: 'fixture-not-to-be-stored' } }).success).toBe(false);
  });
  it('quarantines a mismatched reference without substituting another active resource', async () => {
    const input = plan(); await sessions.create(input,home); sqlite.prepare('UPDATE capability_session_refs SET ref_hash=? WHERE task_id=? AND ref_kind=?').run('0'.repeat(64),input.taskId,'application-package');
    await expect(sessions.get(input.taskId)).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' }); expect(sessions.hasUnresolvedHistory()).toBe(true); await expect(sessions.repairFromRecordedVersion(input.taskId,digest(canonicalJson(input)))).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' });
  });
});
