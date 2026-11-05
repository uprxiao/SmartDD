import {applicationToolDeclarations} from '@shared/application-capabilities';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runBundledMigrations } from '../../../db/migrations';
import { applicationMcpServerName, applicationNativeSkillName, type CapabilitySessionSnapshot, type CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { ApplicationError } from '@shared/applications';
import { BUNDLED_SKILLS, runtimeFiles, treeHash } from '../../capabilities/assets';
import { writeOwnedTree } from '../../capabilities/files';
import { ResourceStore, type ResourceRecord } from '../resource-store';
import { PackageRegistry } from '../package-registry';
import { RuntimeRegistry } from '../runtime-registry';
import { AgentAdapterRegistry } from '../agent-adapter-registry';
import { bundledAgentAdapters } from '../agent-assets';
import { CapabilitySessionRegistry, applicationSkillContentHash } from '../session-registry';
import { LegacyCapabilityResourceAdopter } from '../legacy-resource-adopter';
import { ownedBundle, writeOwnedBundle } from '../owned-bundle';
import { canonicalJson, digest } from '../manifest';
import { fileNames } from '../package-files';
import { fixtureBundle } from './fixtures';
export async function agentFixture(options: {applicationVersion?:string} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-agent-'))), sqlite = new Database(join(root,'state.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','agent fixture',1,1)");
  const home = join(root,'home'),cwd = join(root,'project'); mkdirSync(home);mkdirSync(cwd);
  const store = new ResourceStore(sqlite,root), packages = new PackageRegistry(store,'agent-fixture'), adapters = new AgentAdapterRegistry(store), legacy = new LegacyCapabilityResourceAdopter(store);
  const installedAdapters = await Promise.all(bundledAgentAdapters().map(a => adapters.install(a.metadata,a.files)));
  const runtime = await new RuntimeRegistry(store).install({ id: 'applications',protocolMajor: 1,bridgeEntry: 'mcp-bridge.cjs',files: { 'mcp-bridge.cjs': Buffer.from('module.exports = {};\n') } });
  const source = fixtureBundle(options.applicationVersion); source.manifest.runtime.hash = runtime.contentHash;
  source.files['skills/query/references/version.txt'] = Buffer.from('original-v1-reference'); source.files['skills/query/assets/data.bin'] = Buffer.from([0,255,192,128,10]); source.files['skills/query/scripts/run.sh'] = Buffer.from('#!/bin/sh\nprintf synthetic\n');
  source.manifest.files = Object.entries(source.files).map(([path,bytes]) => ({ path,sha256: digest(bytes),size: bytes.length,executable: path.endsWith('/run.sh') })); const application = await packages.install(source); await packages.activate(application.packageHash,0);
  const standard = BUNDLED_SKILLS[0], standardPath = join(store.root,'packages',standard.id,standard.hash); writeOwnedTree(standardPath,standard.files,join(store.root,'conflicts')); await legacy.adoptStandard(standard.id,standard.hash);
  const legacyFiles = runtimeFiles(),legacyHash = treeHash(legacyFiles),legacyPath = join(store.root,'runtime',legacyHash); writeOwnedTree(legacyPath,legacyFiles,join(store.root,'conflicts')); await legacy.adoptRuntime(legacyHash);
  let extra: ((resource:ResourceRecord,snapshot:CapabilitySessionSnapshot)=>void)|undefined;
  const sessions = new CapabilitySessionRegistry(store,{ assertInitialSelection: snapshot => { const a = adapters.get(snapshot.adapterBinding.hash); if (a.metadata.agentId !== snapshot.runner || snapshot.packages.some(p => packages.active(p.appId)?.packageHash !== p.packageHash)) throw new ApplicationError('RESOURCE_STATE_CHANGED','fixture selection changed'); },verifyExtraResource: (resource,snapshot) => { if (resource.kind === 'agent-adapter') adapters.verifyReference(resource,snapshot); else if(resource.kind==='agent-projection'&&extra)extra(resource,snapshot);else legacy.verify(resource); } });
  /** Pre-R1.0 per-session standard Skill name, kept only to build historical snapshots. */
  const standardNativeSkillName = (skillId: string,hash: string): string => `smartdd-s-${skillId}-${hash.slice(0,12)}`;
  const plan = (runner: 'claude-code' | 'codex' = 'claude-code'): CapabilitySessionSnapshotV2 => {
    const taskId = randomUUID(), adapter = installedAdapters.find(a => a.metadata.agentId === runner)!, name = applicationNativeSkillName(application.appId,source.manifest.skills[0].id,application.packageHash), standardName = standardNativeSkillName(standard.id,standard.hash), plugin = join(store.root,'sessions',taskId,'claude/plugin/skills'), skillPath = (n: string) => join(runner === 'codex' ? join(home,'.agents/skills') : plugin,n,'SKILL.md'),mcpName = applicationMcpServerName(digest(taskId));
    return { schema: 2,taskId,projectId: 'p1',createdAt: new Date().toISOString(),runner,adapterBinding: { id: runner,version: adapter.metadata.version,hash: adapter.hash,projectionFormatVersion: 1,nativeToolNames: Object.fromEntries(applicationToolDeclarations(source.manifest).map(t => [t.name,'mcp__' + mcpName + '__' + t.name])) },native: { sessionId: null,stateRoot: join(home,runner === 'codex' ? '.codex' : '.claude'),cwd },agentAtCreation: { version: adapter.metadata.cliVersions[0],adapterRevision: 1 },catalogGeneration: 'fixture-catalog-1',packages: [{ appId: application.appId,version: application.version,packageHash: application.packageHash,hashAlgorithm: 'app-manifest-v1',hostApi: source.manifest.hostApi,dataApi: 1,runtimeHash: runtime.contentHash,toolContractMajors: Object.fromEntries(applicationToolDeclarations(source.manifest).map(t => [t.name,t.contractMajor])),skills: [{ skillId: source.manifest.skills[0].id,nativeName: name,contentHash: applicationSkillContentHash(source.manifest,source.manifest.skills[0].path),sourceRelativePath: source.manifest.skills[0].path,projectionPath: skillPath(name) }],bindings: [],allowedOperations: source.manifest.permissions }],standardSkills: [{ skillId: standard.id,versionId: standard.id + ':' + standard.hash,hash: standard.hash,hashAlgorithm: 'legacy-tree-v1',projectionPath: skillPath(standardName) }],mcp: [{ kind: 'applications',serverName: mcpName,protocolMajor: 1,runtimeHash: runtime.contentHash },{ kind: 'legacy-project-context',serverName: 'smartdd_project_' + digest(taskId).slice(0,12),protocolMajor: 1,runtimeHash: legacyHash }],provenance: 'created' };
  };
  return { root,home,cwd,sqlite,store,packages,adapters,legacy,sessions,source,application,standard,standardPath,legacyPath,legacyHash,installedAdapters,plan,setExtraVerifier:(fn:(resource:ResourceRecord,snapshot:CapabilitySessionSnapshot)=>void)=>{extra=fn;},snapshotTree: (path: string) => Object.fromEntries(fileNames(path).map(name => [name,digest(readFileSync(join(path,name)))])),cleanup: () => { sqlite.close();rmSync(root,{ recursive: true,force: true }); } };
}
