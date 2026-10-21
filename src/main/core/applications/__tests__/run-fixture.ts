import {SessionCapabilityProjector} from '../session-projector';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fixtureBundle } from './fixtures';
import { PackageRegistry } from '../package-registry';
import { RuntimeRegistry } from '../runtime-registry';
import { applicationNativeSkillName, applicationMcpServerName } from '@shared/application-session';
import { applicationSkillContentHash } from '../session-registry';
import Database from 'better-sqlite3';
import { runBundledMigrations } from '../../../db/migrations';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { ApplicationError, type ApplicationManifest } from '@shared/applications';
import { ResourceStore, type ResourceRecord } from '../resource-store';
import { CapabilitySessionRegistry } from '../session-registry';
import { CapabilityRunRegistry } from '../run-registry';
import { canonicalJson, digest } from '../manifest';
import { fileNames } from '../package-files';
import type { ProcessIdentity, ProcessIdentityReader } from '../process-identity';
export class FixtureProcessReader implements ProcessIdentityReader {
  readonly identities = new Map<number,string>([[process.pid,'darwin-proc-v1:100:10']]);
  readonly unknown = new Set<number>();
  read(pid: number): ProcessIdentity | null { const startedAt = this.identities.get(pid); return startedAt && !this.unknown.has(pid) ? { pid,startedAt } : null; }
  state(identity: ProcessIdentity) { if (this.unknown.has(identity.pid)) return 'unknown' as const; return this.identities.get(identity.pid) === identity.startedAt ? 'running' as const : 'stopped' as const; }
}
export async function runFixture(reader: ProcessIdentityReader = new FixtureProcessReader(),options: { application?: boolean;secondApplication?:boolean;fullProjection?:boolean;runtime?: Buffer;allowedOperations?: string[];applicationBundle?: {manifest:ApplicationManifest;files:Record<string,Buffer>} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-runs-'))), sqlite = new Database(join(root,'state.sqlite'));
  sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','isolated run fixture',1,1)");
  const store = new ResourceStore(sqlite,root), entries = new Map<string,Buffer>(); let onVerify: ((resource: ResourceRecord) => void) | undefined;
  const resource = async (kind: string,version: string,dependencies: string[] = []) => {
    const bytes = Buffer.from('module.exports = ' + JSON.stringify({ kind,version }) + ';\n'), hash = digest(bytes), id = kind + ':' + (kind === 'agent-adapter' ? 'claude-code:' : '') + hash;
    const spec = { resourceId: id,kind,contentHash: hash,relativePath: 'run-fixtures/' + kind + '/' + hash,dependencies,materialize: (dir: string) => { mkdirSync(dir); writeFileSync(join(dir,'entry.cjs'),bytes); writeFileSync(join(dir,'.smartdd-owned.json'),canonicalJson({ storeId: store.storeId,hash })); },verify: (dir: string) => { if (!readFileSync(join(dir,'entry.cjs')).equals(bytes)) throw new Error('fixture bytes changed'); } };
    entries.set(id,bytes); return store.publish(spec);
  };
  const child = await resource('fixture-dependency','1'), parent = await resource('fixture-dependency','2',[child.resourceId]), adapter = await resource('agent-adapter','1',[parent.resourceId]);
  let projector:SessionCapabilityProjector|undefined;
  const sessions = new CapabilitySessionRegistry(store,{ assertInitialSelection: snapshot => { if ((!options.application && snapshot.packages.length) || snapshot.adapterBinding.hash !== adapter.contentHash) throw new Error('fixture host selection'); },verifyExtraResource: (r,snapshot) => { if(options.fullProjection&&r.kind==='session-projection'){projector!.verify(r,snapshot);return;}const dir = join(store.root,r.relativePath), bytes = readFileSync(join(dir,'entry.cjs')); if (!bytes.equals(entries.get(r.resourceId)!) || digest(bytes) !== r.contentHash || fileNames(dir).length !== 2 || JSON.parse(readFileSync(join(dir,'.smartdd-owned.json'),'utf8')).storeId !== store.storeId) throw new ApplicationError('HASH_MISMATCH','fixture whole tree changed'); onVerify?.(r); } });
  const home = join(root,'home'), cwd = join(root,'project'); mkdirSync(home); mkdirSync(cwd);
  const snapshot: CapabilitySessionSnapshotV2 = { schema: 2,taskId: randomUUID(),projectId: 'p1',runner: 'claude-code',createdAt: new Date().toISOString(),native: { sessionId: null,stateRoot: join(home,'.claude'),cwd },adapterBinding: { id: 'claude-code',version: '1.0.0',hash: adapter.contentHash,projectionFormatVersion: 1,nativeToolNames: {} },agentAtCreation: { version: 'controlled-fixture',adapterRevision: 1 },catalogGeneration: 'isolated-fixture',packages: [],standardSkills: [],mcp: [],provenance: 'created' };
  let application: ReturnType<PackageRegistry['get']> | undefined, applicationSource: ReturnType<typeof fixtureBundle> | undefined;
  const packageRegistry = new PackageRegistry(store,'controlled-tool-fixture');
  if (options.application) {
    const runtime = await new RuntimeRegistry(store).install({ id: 'applications',protocolMajor: 1,bridgeEntry: 'mcp-bridge.cjs',files: { 'mcp-bridge.cjs': options.runtime ?? Buffer.from('module.exports = {};\n') } });
    applicationSource = options.applicationBundle ? {manifest:structuredClone(options.applicationBundle.manifest),files:{...options.applicationBundle.files}} : fixtureBundle();
    const manifest = applicationSource.manifest;
    if(options.applicationBundle && manifest.runtime.hash !== runtime.contentHash)throw new Error('fixture runtime does not match its supplied immutable bundle');
    manifest.runtime.hash = runtime.contentHash;
    if(!options.applicationBundle){
    applicationSource.files['schemas/input.json'] = Buffer.from(JSON.stringify({ type: 'object',properties: { value: { type: 'string',maxLength: 1000 },connectionId: { type: 'string',format: 'uuid' } },required: ['value'],additionalProperties: false }));
    applicationSource.files['schemas/output.json'] = Buffer.from(JSON.stringify({ type: 'object',properties: { value: { type: 'string' },packageHash: { type: 'string' },projectId: { type: 'string' },taskId: { type: 'string' },operationId: { type: 'string' } },required: ['value','packageHash','projectId','taskId','operationId'],additionalProperties: false }));
    manifest.permissions.push('zentao.write'); manifest.tools.push({ ...manifest.tools[0],name: 'smartdd_zentao_write_v1',permission: 'zentao.write',annotations: { readOnlyHint: false,destructiveHint: false,idempotentHint: false,openWorldHint: true } });
    manifest.files = Object.entries(applicationSource.files).map(([path,bytes]) => ({ path,size: bytes.length,sha256: digest(bytes),executable: false }));
    }
    application = await packageRegistry.install(applicationSource); await packageRegistry.activate(application.packageHash,0);
    const packageHash = application.packageHash, mcpName = applicationMcpServerName(digest(snapshot.taskId));
    snapshot.packages = [{ appId: application.appId,version: application.version,packageHash: application.packageHash,hashAlgorithm: 'app-manifest-v1',hostApi: manifest.hostApi,dataApi: manifest.dataApi,runtimeHash: runtime.contentHash,toolContractMajors: Object.fromEntries(manifest.tools.map(tool => [tool.name,tool.contractMajor])),skills: manifest.skills.map(skill=>{const native=applicationNativeSkillName(manifest.appId,skill.id,packageHash);return{skillId:skill.id,nativeName:native,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(store.root,'sessions',snapshot.taskId,'claude/plugin/skills',native,'SKILL.md')};}),bindings: [],allowedOperations: options.allowedOperations ?? manifest.permissions }];
    snapshot.mcp = [{ kind: 'applications',serverName: mcpName,protocolMajor: 1,runtimeHash: runtime.contentHash }]; snapshot.adapterBinding.nativeToolNames = Object.fromEntries(manifest.tools.map(tool => [tool.name,'mcp__' + mcpName + '__' + tool.name]));
  }
  let secondApplication:ReturnType<PackageRegistry['get']>|undefined;
  if(options.secondApplication){
    if(!applicationSource||!application)throw new Error('second application fixture requires the first application');
    const source={manifest:structuredClone(applicationSource.manifest),files:{...applicationSource.files}},manifest=source.manifest;
    manifest.appId='mail';manifest.displayName='Controlled second app';manifest.permissions=manifest.permissions.map(p=>p.replace('zentao.','mail.'));manifest.tools=manifest.tools.map(t=>({...t,name:t.name.replace('zentao','mail'),permission:t.permission.replace('zentao.','mail.')}));
    secondApplication=await packageRegistry.install(source);const packageHash=secondApplication.packageHash,mcpName=snapshot.mcp.find(m=>m.kind==='applications')!.serverName;
    snapshot.packages.push({appId:secondApplication.appId,version:secondApplication.version,packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(skill=>{const native=applicationNativeSkillName(manifest.appId,skill.id,packageHash);return{skillId:skill.id,nativeName:native,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(store.root,'sessions',snapshot.taskId,'claude/plugin/skills',native,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions});
    Object.assign(snapshot.adapterBinding.nativeToolNames,Object.fromEntries(manifest.tools.map(t=>[t.name,'mcp__'+mcpName+'__'+t.name])));
  }
  const session = await sessions.create(snapshot,home);if(options.fullProjection){projector=new SessionCapabilityProjector(store,sessions);await projector.claude(snapshot.taskId);} let allowed = true, revocations = 0, revoke: (() => void | Promise<void>) | undefined;
  const registry = () => new CapabilityRunRegistry(store,sessions,{ processes: reader,assertCurrent: () => { if (!allowed) throw new ApplicationError('SCOPE_DENIED','fixture current policy revoked'); },revoke: async () => { revocations++; await revoke?.(); },revocationTimeoutMs: 30 });
  const runs = registry();
  return { root,sqlite,store,sessions,snapshot,session,home,reader,runs,registry,resource,adapter,parent,child,application,secondApplication,applicationSource,packageRegistry,create: () => runs.reserve({ taskId: snapshot.taskId,snapshotHash: session.pointer.snapshotHash,bindings: [] }),setAllowed: (value: boolean) => { allowed = value; },setRevoke: (value: () => void | Promise<void>) => { revoke = value; },revocations: () => revocations,setVerify: (value: (r: ResourceRecord) => void) => { onVerify = value; },cleanup: () => { sqlite.close(); rmSync(root,{ recursive: true,force: true }); } };
}
