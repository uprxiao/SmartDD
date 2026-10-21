import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { ApplicationError, isPackagePath } from '@shared/applications';
import { capabilitySessionSnapshotSchema, type CapabilitySessionPointer, type CapabilitySessionSnapshotV2, type SessionResourceReference } from '@shared/application-session';
import { canonicalJson, compareCodePoints, digest } from './manifest';
import { ensureStoreDirectory, verifyPackageTree } from './package-files';
import type { ResourceRecord, ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import { PackageRegistry } from './package-registry';
import { RuntimeRegistry } from './runtime-registry';
import {assertLegacySessionSource} from './legacy-session-source';
const snapshotFailureMessages={json:'固定能力快照无法解析，保留原记录，不重建选择',shape:'固定能力快照结构无效，保留原记录，不重建选择',hash:'固定能力快照摘要不符，保留原记录，不重建选择',identity:'固定能力快照身份不符，保留原记录，不重建选择'} as const;
class SnapshotReadFailure extends Error {constructor(readonly kind:keyof typeof snapshotFailureMessages){super(kind);}}
interface SnapshotRow { task_id: string;schema_version: number;snapshot_json: string;snapshot_hash: string;created_at: string;legacy_status: string;retention_state: 'active' | 'tombstone' | 'hold' }
interface IdentityRow { task_id: string;runner: string;identity_root: string;session_id: string | null;cwd: string;discovery_home: string;selection_hash: string }
export interface SessionRegistryDeps {
  /** Trusted host selection policy; executed again under C lock before first commit. */
  assertInitialSelection(snapshot: CapabilitySessionSnapshotV2): void;
  /** Agent-adapter / standard / legacy-runtime verifiers must check complete owned bytes. */
  verifyExtraResource(resource: ResourceRecord,snapshot: CapabilitySessionSnapshotV2): void;
}
export interface StoredCapabilitySession { snapshot: CapabilitySessionSnapshotV2;pointer: CapabilitySessionPointer;selectionHash: string;discoveryHome: string;retention: SnapshotRow['retention_state'];legacyStatus: string }
const SELECT = 'SELECT * FROM capability_session_snapshots WHERE task_id=?';
export const selectionHash = (snapshot: CapabilitySessionSnapshotV2): string => digest(canonicalJson({ ...snapshot,native: { ...snapshot.native,sessionId: null } }));
export function canonicalFuturePath(path: string): string {
  if (!isAbsolute(path)) throw new ApplicationError('INVALID_INPUT','原生身份目录必须为绝对路径');
  const remainder: string[] = []; let parent = resolve(path);
  while (!existsSync(parent)) { const previous = dirname(parent); if (previous === parent) throw new ApplicationError('INVALID_INPUT','无法解析原生身份目录'); remainder.unshift(parent.slice(previous.length).replace(/^\/+/,'')); parent = previous; }
  return join(realpathSync(parent),...remainder);
}
export function applicationSkillContentHash(manifest: ReturnType<PackageRegistry['get']>['manifest'],path: string): string {
  const prefix = path + '/';
  const files = manifest.files.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f,path: f.path.slice(prefix.length) })).sort((a,b) => compareCodePoints(a.path,b.path));
  return digest(canonicalJson(files));
}
/** SQLite is authoritative. S/snapshot.json is only a repairable owned mirror. */
export class CapabilitySessionRegistry {
  private readonly packages: PackageRegistry;
  private readonly runtimes: RuntimeRegistry;
  constructor(readonly store: ResourceStore,private readonly deps: SessionRegistryDeps) { this.packages = new PackageRegistry(store,'snapshot-reader'); this.runtimes = new RuntimeRegistry(store); }
  private expectedSources(snapshot: CapabilitySessionSnapshotV2): Map<string,{ kind: string;hash: string }> {
    const requested = new Map<string,{ kind: string;hash: string }>();
    const add = (id: string,kind: string,hash: string) => { const previous = requested.get(id); if (previous && (previous.kind !== kind || previous.hash !== hash)) throw new ApplicationError('SNAPSHOT_CORRUPT','快照资源身份冲突'); requested.set(id,{ kind,hash }); };
    add(`agent-adapter:${snapshot.runner}:${snapshot.adapterBinding.hash}`,'agent-adapter',snapshot.adapterBinding.hash);
    if(snapshot.legacyBinding){const original=assertLegacySessionSource(this.store,snapshot);for(const skill of original.snapshot.skills)add(`standard-skill:${skill.skillId}:${skill.hash}`,'standard-skill',skill.hash);add('legacy-runtime:'+original.evidence.runtimeHash,'legacy-runtime',original.evidence.runtimeHash);if(original.pluginSource)add(original.pluginSource.resourceId,'legacy-plugin-source',original.pluginSource.contentHash);if(original.originalProjection)add(original.originalProjection.resourceId,'legacy-static-plugin',original.originalProjection.contentHash);for(const r of original.originalCodexProjections??[])add(r.resourceId,'legacy-agent-projection',r.contentHash);}
    for (const p of snapshot.packages) { add('app:' + p.packageHash,'application-package',p.packageHash); add('runtime:' + p.runtimeHash,'runtime',p.runtimeHash); }
    for (const s of snapshot.standardSkills) add(`standard-skill:${s.skillId}:${s.hash}`,'standard-skill',s.hash);
    for (const m of snapshot.mcp) add((m.kind === 'applications' ? 'runtime:' : 'legacy-runtime:') + m.runtimeHash,m.kind === 'applications' ? 'runtime' : 'legacy-runtime',m.runtimeHash);
    return requested;
  }
  private sourceReferences(snapshot: CapabilitySessionSnapshotV2): SessionResourceReference[] {
    return [...this.expectedSources(snapshot)].map(([id,expected]) => {
      const resource = this.store.get(id);
      if (resource.kind !== expected.kind || resource.contentHash !== expected.hash || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','固定会话资源身份不一致或尚未就绪');
      return { refKind: expected.kind,refId: id,refHash: expected.hash,relativePath: resource.relativePath };
    }).sort((a,b) => compareCodePoints(a.refId,b.refId));
  }
  private validatePackages(snapshot: CapabilitySessionSnapshotV2): void {
    for (const p of snapshot.packages) {
      const installed = this.packages.get(p.packageHash), manifest = installed.manifest;
      const contracts = Object.fromEntries(manifest.tools.map(t => [t.name,t.contractMajor]));
      if (p.appId !== manifest.appId || p.version !== manifest.version || p.runtimeHash !== manifest.runtime.hash || p.dataApi !== manifest.dataApi || canonicalJson(p.hostApi) !== canonicalJson(manifest.hostApi) || canonicalJson(p.toolContractMajors) !== canonicalJson(contracts) || p.allowedOperations.some(op => !manifest.permissions.includes(op)) || p.skills.length !== manifest.skills.length) throw new ApplicationError('SNAPSHOT_CORRUPT','快照的应用版本、工具或动作与原包不同');
      for (const skill of p.skills) {
        const source = manifest.skills.find(s => s.id === skill.skillId);
        if (!source || source.path !== skill.sourceRelativePath || applicationSkillContentHash(manifest,source.path) !== skill.contentHash) throw new ApplicationError('SNAPSHOT_CORRUPT','固定Skill完整目录摘要与原包不一致');
      }
      const bridge = snapshot.mcp.find(m => m.kind === 'applications'); if (bridge?.protocolMajor !== manifest.runtime.protocolMajor) throw new ApplicationError('HOST_INCOMPATIBLE','固定业务桥协议与包契约不同');
    }
  }
  private read(taskId: string): StoredCapabilitySession {
    const row = this.store.sqlite.prepare(SELECT).get(taskId) as SnapshotRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','此任务尚无能力快照');
    if(row.schema_version===0){if(row.legacy_status==='history-unknown')throw new ApplicationError('SESSION_ON_HOLD','历史能力未知，不能自动补入当前应用');throw new ApplicationError('SNAPSHOT_CORRUPT','已记录的能力快照损坏，保留原记录，不重建选择');}
    if(row.schema_version!==2)throw new ApplicationError('HOST_INCOMPATIBLE','原能力快照格式暂不支持，请使用兼容的 WillYou 版本；原记录已保留');
    try {
      let decoded:unknown;try{decoded=JSON.parse(row.snapshot_json);}catch{throw new SnapshotReadFailure('json');}
      const parsed=capabilitySessionSnapshotSchema.safeParse(decoded);if(!parsed.success)throw new SnapshotReadFailure('shape');
      const snapshot=parsed.data,identity=this.store.sqlite.prepare('SELECT * FROM capability_session_identities WHERE task_id=?').get(taskId) as IdentityRow|undefined;
      if(digest(canonicalJson(snapshot))!==row.snapshot_hash)throw new SnapshotReadFailure('hash');
      if(snapshot.taskId!==taskId||!identity||identity.runner!==snapshot.runner||identity.session_id!==snapshot.native.sessionId||identity.cwd!==snapshot.native.cwd||identity.selection_hash!==selectionHash(snapshot))throw new SnapshotReadFailure('identity');
      if(snapshot.legacyBinding&&identity.discovery_home!==assertLegacySessionSource(this.store,snapshot).identity.home)throw new Error('legacy discovery identity');
      const actual = this.store.sqlite.prepare('SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(taskId) as SessionResourceReference[];
      const expected = this.expectedSources(snapshot);
      if ([...expected].some(([id,s]) => !actual.some(r => r.refId === id && r.refKind === s.kind && r.refHash === s.hash)) || actual.some(r => !isPackagePath(r.relativePath) || (!expected.has(r.refId) && !['session-projection','agent-projection','legacy-runtime','claude-projection-source','claude-projection-archive','claude-delivery'].includes(r.refKind)))) throw new Error('reference integrity');
      for (const ref of actual) {
        const resource = this.store.get(ref.refId);
        if (resource.contentHash !== ref.refHash || resource.relativePath !== ref.relativePath || resource.kind !== ref.refKind) throw new Error('resource reference identity');
      }
      const names = this.store.sqlite.prepare('SELECT server_name AS serverName,kind FROM capability_session_mcp_names WHERE task_id=? ORDER BY kind').all(taskId) as { serverName: string;kind: string }[];
      if (canonicalJson(names) !== canonicalJson(snapshot.mcp.map(m => ({ serverName: m.serverName,kind: m.kind })).sort((a,b) => compareCodePoints(a.kind,b.kind)))) throw new Error('MCP identity integrity');
      return { snapshot,pointer: { schema: 2,taskId,snapshotHash: row.snapshot_hash },selectionHash: identity.selection_hash,discoveryHome: identity.discovery_home,retention: row.retention_state,legacyStatus: row.legacy_status };
    } catch (error) {
      if(error instanceof SnapshotReadFailure)throw new ApplicationError('SNAPSHOT_CORRUPT',snapshotFailureMessages[error.kind]);
      if (error instanceof ApplicationError && ['RESOURCE_STATE_CHANGED','OWNERSHIP_CONFLICT'].includes(error.code)) throw error;
      throw new ApplicationError('SNAPSHOT_CORRUPT','固定能力快照、引用或原生身份损坏，保留现场不重建选择');
    }
  }
  /** Internal coordinated callers already hold C and a short SQLite transaction. */
  inspectCoordinated(taskId: string): StoredCapabilitySession { return this.read(taskId); }
  async get(taskId: string): Promise<StoredCapabilitySession> {
    return withResourceLock(this.store.root,() => {
      try { return this.read(taskId); }
      catch (error) { if (error instanceof ApplicationError && error.code === 'SNAPSHOT_CORRUPT') this.quarantine(taskId,'corrupt'); throw error; }
    });
  }
  async create(input: CapabilitySessionSnapshotV2,discoveryHome: string): Promise<StoredCapabilitySession> {
    const parsed = capabilitySessionSnapshotSchema.safeParse(input);
    if (!parsed.success || !isAbsolute(discoveryHome)) throw new ApplicationError('INVALID_INPUT','会话能力或原生发现目录无效');
    const snapshot = parsed.data, bytes = canonicalJson(snapshot), hash = digest(bytes); if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new ApplicationError('INVALID_INPUT','会话快照超过元数据预算');
    const nativeRoot = canonicalFuturePath(snapshot.native.stateRoot), home = canonicalFuturePath(discoveryHome);
    const saved = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const previous = this.store.sqlite.prepare(SELECT).get(snapshot.taskId) as SnapshotRow | undefined;
      if (previous) { if (previous.snapshot_hash !== hash) throw new ApplicationError('SNAPSHOT_IMMUTABLE','原任务能力已经固定，不能改成新版本或新路径'); const known = this.read(snapshot.taskId); if (known.discoveryHome !== home) throw new ApplicationError('SNAPSHOT_IMMUTABLE','原生发现目录已经固定'); return known; }
      this.deps.assertInitialSelection(snapshot); this.validatePackages(snapshot); const refs = this.sourceReferences(snapshot);
      if (snapshot.native.sessionId && this.store.sqlite.prepare('SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=?').get(snapshot.runner,nativeRoot,snapshot.native.sessionId)) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生会话已关联另一任务，不能新增另一套能力');
      for (const mcp of snapshot.mcp) if (this.store.sqlite.prepare('SELECT 1 FROM capability_session_mcp_names WHERE server_name=?').get(mcp.serverName)) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','已有会话使用此MCP名称，不能改名覆盖');
      this.store.sqlite.prepare("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES(?,2,?,?,?,?,'active')").run(snapshot.taskId,bytes,hash,snapshot.createdAt,snapshot.provenance);
      this.store.sqlite.prepare('INSERT INTO capability_snapshot_versions(snapshot_hash,task_id,snapshot_json,selection_hash,created_at) VALUES(?,?,?,?,?)').run(hash,snapshot.taskId,bytes,selectionHash(snapshot),snapshot.createdAt);
      this.store.sqlite.prepare('INSERT INTO capability_session_identities(task_id,runner,identity_root,session_id,cwd,discovery_home,selection_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(snapshot.taskId,snapshot.runner,nativeRoot,snapshot.native.sessionId,snapshot.native.cwd,home,selectionHash(snapshot),snapshot.createdAt,snapshot.createdAt);
      const put = this.store.sqlite.prepare('INSERT INTO capability_session_refs(task_id,ref_kind,ref_id,ref_hash,relative_path) VALUES(?,?,?,?,?)');
      for (const ref of refs) put.run(snapshot.taskId,ref.refKind,ref.refId,ref.refHash,ref.relativePath);
      for (const mcp of snapshot.mcp) this.store.sqlite.prepare('INSERT INTO capability_session_mcp_names(server_name,task_id,kind) VALUES(?,?,?)').run(mcp.serverName,snapshot.taskId,mcp.kind);
      return this.read(snapshot.taskId);
    }).immediate());
    await this.ensureMirror(snapshot.taskId); return saved;
  }
  async bindNativeSession(taskId: string,expectedHash: string,native: { runner: CapabilitySessionSnapshotV2['runner'];stateRoot: string;cwd: string;sessionId: string }): Promise<StoredCapabilitySession> {
    const saved = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const current = this.read(taskId), snapshot = current.snapshot, identity = this.store.sqlite.prepare('SELECT * FROM capability_session_identities WHERE task_id=?').get(taskId) as IdentityRow;
      if (current.retention !== 'active' || native.runner !== snapshot.runner || native.stateRoot !== snapshot.native.stateRoot || native.cwd !== snapshot.native.cwd || canonicalFuturePath(native.stateRoot) !== identity.identity_root) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生身份、目录或保留状态不同，不能补写到此快照');
      if (snapshot.native.sessionId !== null) { if (snapshot.native.sessionId !== native.sessionId) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生会话ID已固定，不能替换'); return current; }
      if (current.pointer.snapshotHash !== expectedHash) throw new ApplicationError('RESOURCE_STATE_CHANGED','快照已变化，请重新读取原身份');
      const parsed = capabilitySessionSnapshotSchema.safeParse({ ...snapshot,native: { ...snapshot.native,sessionId: native.sessionId } });
      if (!parsed.success) throw new ApplicationError('INVALID_INPUT','原生会话ID无效'); const next = parsed.data;
      if (this.store.sqlite.prepare('SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=? AND task_id<>?').get(native.runner,identity.identity_root,native.sessionId,taskId)) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生会话已属于另一任务');
      const bytes = canonicalJson(next), hash = digest(bytes), now = new Date().toISOString();
      if(snapshot.legacyBinding){const original=assertLegacySessionSource(this.store,snapshot);const result=this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET bound_native_session_id=?,updated_at=? WHERE task_id=? AND source_snapshot_hash=? AND state='migrated' AND bound_native_session_id IS NULL").run(native.sessionId,now,taskId,original.row.source_snapshot_hash);if(result.changes!==1)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原M4迁移的原生身份已经绑定');}
      this.store.sqlite.prepare('UPDATE capability_session_snapshots SET snapshot_json=?,snapshot_hash=? WHERE task_id=? AND snapshot_hash=?').run(bytes,hash,taskId,expectedHash);
      this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_snapshot_versions(snapshot_hash,task_id,snapshot_json,selection_hash,created_at) VALUES(?,?,?,?,?)').run(hash,taskId,bytes,selectionHash(next),now);
      this.store.sqlite.prepare('UPDATE capability_session_identities SET session_id=?,updated_at=? WHERE task_id=?').run(native.sessionId,now,taskId);
      this.store.sqlite.prepare("UPDATE capability_runs SET snapshot_hash=? WHERE task_id=? AND snapshot_hash=? AND state IN ('prepared','active','stopping')").run(hash,taskId,expectedHash);
      return this.read(taskId);
    }).immediate()); await this.ensureMirror(taskId); return saved;
  }
  async verifyNativeIdentity(taskId: string,actual: { runner: CapabilitySessionSnapshotV2['runner'];stateRoot: string;cwd: string;sessionId: string | null;home: string }): Promise<void> {
    const current = await this.get(taskId), native = current.snapshot.native;
    if (current.retention !== 'active') throw new ApplicationError('SESSION_ON_HOLD','此会话处于保留状态，不能授予运行能力');
    const identity = this.store.sqlite.prepare('SELECT identity_root FROM capability_session_identities WHERE task_id=?').get(taskId) as { identity_root: string };
    if (actual.runner !== current.snapshot.runner || actual.stateRoot !== native.stateRoot || actual.cwd !== native.cwd || actual.sessionId !== native.sessionId || canonicalFuturePath(actual.stateRoot) !== identity.identity_root || canonicalFuturePath(actual.home) !== current.discoveryHome) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生身份或发现目录与固定会话不同，不自动迁移或注入');
    // A bound history must keep its original directory; canonicalFuturePath alone
    // also accepts an absent path, which is valid for new sessions but not resume.
    if (native.sessionId !== null) {
      let available = false; try { available = statSync(actual.stateRoot).isDirectory(); } catch { /* Keep the original identity; never recreate or choose another root. */ }
      if (!available) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生会话状态目录缺失或不可用，保留原路径，不新建空根恢复');
    }
  }
  async references(taskId: string): Promise<SessionResourceReference[]> {
    await this.get(taskId);
    return this.store.sqlite.prepare('SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(taskId) as SessionResourceReference[];
  }
  async verifyResources(taskId: string): Promise<void> {
    const current = await this.get(taskId);
    if (current.retention !== 'active') throw new ApplicationError('SESSION_ON_HOLD','此会话能力处于保留或待核查状态');
    this.validatePackages(current.snapshot);
    for (const ref of await this.references(taskId)) {
      const resource = this.store.get(ref.refId);
      if (resource.kind !== ref.refKind || resource.contentHash !== ref.refHash || resource.relativePath !== ref.relativePath || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','固定资源缺失、状态改变或引用身份不同');
      if (ref.refKind === 'application-package') { const p = this.packages.get(ref.refHash); verifyPackageTree(join(this.store.root,ref.relativePath),p,this.store.storeId); }
      else if (ref.refKind === 'runtime') this.runtimes.verify(ref.refHash);
      else this.deps.verifyExtraResource(resource,current.snapshot);
    }
  }
  /** Host-only active roots. Full S and its long-term refs remain untouched. */
  scopedReferencesCoordinated(taskId:string,appIds:readonly string[],projectionIds:readonly string[]=[]):SessionResourceReference[]{
    const current=this.inspectCoordinated(taskId),snapshot=current.snapshot;
    if(snapshot.legacyBinding||snapshot.provenance!=='created'||!appIds.length||appIds.length>32||new Set(appIds).size!==appIds.length||appIds.some(id=>!snapshot.packages.some(p=>p.appId===id))||new Set(projectionIds).size!==projectionIds.length||projectionIds.length>4096)throw new ApplicationError('INVALID_INPUT','本轮应用范围必须来自原固定选择');
    this.validatePackages({...snapshot,packages:snapshot.packages.filter(p=>appIds.includes(p.appId))});
    const expected=this.expectedSources({...snapshot,packages:snapshot.packages.filter(p=>appIds.includes(p.appId))}),all=this.store.sqlite.prepare('SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=?').all(taskId) as SessionResourceReference[],roots:SessionResourceReference[]=[];
    for(const [id,source]of expected){const ref=all.find(r=>r.refId===id);if(!ref||ref.refKind!==source.kind||ref.refHash!==source.hash)throw new ApplicationError('SNAPSHOT_CORRUPT','本轮所需原资源引用缺失或身份不同');roots.push(ref);}
    // The ordinary launcher always reads its original M4 runtime, including
    // when its context MCP is disabled. Narrow only application-specific roots.
    for(const ref of all.filter(r=>r.refKind==='legacy-runtime'))if(!roots.some(r=>r.refId===ref.refId))roots.push(ref);
    for(const id of projectionIds){const ref=all.find(r=>r.refId===id);if(!ref||!['session-projection','agent-projection','claude-delivery'].includes(ref.refKind))throw new ApplicationError('SCOPE_DENIED','本轮投影须已登记到原会话');if(!roots.some(r=>r.refId===id))roots.push(ref);}
    return roots.sort((a,b)=>compareCodePoints(a.refId,b.refId));
  }
  async verifyScopedResources(taskId:string,appIds:readonly string[],projectionIds:readonly string[]):Promise<void>{
    const current=await this.get(taskId);if(current.retention!=='active')throw new ApplicationError('SESSION_ON_HOLD','原会话能力处于保留状态');
    const roots=this.scopedReferencesCoordinated(taskId,appIds,projectionIds);
    for(const ref of roots){const resource=this.store.get(ref.refId);if(resource.kind!==ref.refKind||resource.contentHash!==ref.refHash||resource.relativePath!==ref.relativePath||resource.state!=='ready'||resource.integrity!=='valid')throw new ApplicationError('RESOURCE_STATE_CHANGED','本轮固定资源身份或状态已改变');if(ref.refKind==='application-package'){const pack=this.packages.get(ref.refHash);verifyPackageTree(join(this.store.root,ref.relativePath),pack,this.store.storeId);}else if(ref.refKind==='runtime')this.runtimes.verify(ref.refHash);else this.deps.verifyExtraResource(resource,current.snapshot);}
  }
  async addProjectionReference(taskId: string,expectedHash: string,resourceId: string): Promise<void> {
    const current = await this.get(taskId), resource = this.store.get(resourceId);
    if (!['session-projection','agent-projection','claude-projection-source','claude-projection-archive','claude-delivery'].includes(resource.kind) || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','投影未完成发布');
    this.deps.verifyExtraResource(resource,current.snapshot);
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const known = this.read(taskId), fresh = this.store.get(resourceId);
      if (known.retention !== 'active' || known.pointer.snapshotHash !== expectedHash || known.selectionHash !== current.selectionHash || fresh.state !== 'ready' || fresh.generation !== resource.generation) throw new ApplicationError('RESOURCE_STATE_CHANGED','登记投影期间快照或资源已变化');
      this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_session_refs(task_id,ref_kind,ref_id,ref_hash,relative_path) VALUES(?,?,?,?,?)').run(taskId,resource.kind,resourceId,resource.contentHash,resource.relativePath);
      const ref = this.store.sqlite.prepare('SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind=? AND ref_id=?').get(taskId,resource.kind,resourceId) as { ref_hash: string;relative_path: string };
      if (ref.ref_hash !== resource.contentHash || ref.relative_path !== resource.relativePath) throw new ApplicationError('SNAPSHOT_CORRUPT','已有投影引用与本次资源不同');
    }).immediate());
  }
  /** The old launcher also consumes its fixed runtime when the context MCP is disabled. */
  async addLegacyRuntimeReference(taskId: string,expectedHash: string,hash: string): Promise<void> {
    const current = await this.get(taskId), resource = this.store.get('legacy-runtime:' + hash);
    if (resource.kind !== 'legacy-runtime' || resource.contentHash !== hash || resource.relativePath !== 'runtime/' + hash || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','原启动资源未就绪');
    this.deps.verifyExtraResource(resource,current.snapshot);
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const known = this.read(taskId), fresh = this.store.get(resource.resourceId);
      if (known.retention !== 'active' || known.pointer.snapshotHash !== expectedHash || fresh.generation !== resource.generation || fresh.state !== 'ready') throw new ApplicationError('RESOURCE_STATE_CHANGED','登记启动资源期间原快照已变化');
      const prior = this.store.sqlite.prepare("SELECT ref_hash FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-runtime'").all(taskId) as {ref_hash:string}[];
      if (prior.some(ref=>ref.ref_hash!==hash)) throw new ApplicationError('SNAPSHOT_IMMUTABLE','原启动资源已经固定，不能替换');
      this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_session_refs VALUES(?,?,?,?,?)').run(taskId,'legacy-runtime',resource.resourceId,hash,resource.relativePath);
    }).immediate());
  }
  async tombstone(taskId: string): Promise<void> {
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      this.store.sqlite.prepare("UPDATE capability_session_holds SET previous_retention='tombstone' WHERE task_id=?").run(taskId);
      const result = this.store.sqlite.prepare("UPDATE capability_session_snapshots SET retention_state=CASE WHEN retention_state='hold' THEN 'hold' ELSE 'tombstone' END WHERE task_id=?").run(taskId);
      if (!result.changes) throw new ApplicationError('NOT_FOUND','此任务尚无能力保留记录');
    }).immediate());
  }
  async holdUnknown(input: { taskId: string;projectId: string | null;runner: CapabilitySessionSnapshotV2['runner'];stateRoot: string;cwd: string;sessionId: string | null;reason: 'history-unknown' | 'snapshot-corrupt' }): Promise<void> {
    const parsed = z.object({ taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),projectId: z.string().min(1).max(128).nullable(),runner: z.enum(['claude-code','codex']),stateRoot: z.string().refine(s => isAbsolute(s) && !/[\x00\r\n]/.test(s)),cwd: z.string().refine(s => isAbsolute(s) && !/[\x00\r\n]/.test(s)),sessionId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(),reason: z.enum(['history-unknown','snapshot-corrupt']) }).strict().safeParse(input);
    if (!parsed.success) throw new ApplicationError('INVALID_INPUT','历史保留身份无效或包含未允许字段');
    input = parsed.data;
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const existing = this.store.sqlite.prepare(SELECT).get(input.taskId) as SnapshotRow | undefined;
      if (existing) { this.quarantine(input.taskId,input.reason); return; }
      const snapshot = { schema: 0,...input }, bytes = canonicalJson(snapshot);
      this.store.sqlite.prepare("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES(?,0,?,?,?,?,'hold')").run(input.taskId,bytes,digest(bytes),new Date().toISOString(),input.reason);
      const nativeRoot = canonicalFuturePath(input.stateRoot), now = new Date().toISOString();
      const claimed = input.sessionId && this.store.sqlite.prepare('SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=?').get(input.runner,nativeRoot,input.sessionId);
      if (!claimed) this.store.sqlite.prepare("INSERT INTO capability_session_identities(task_id,runner,identity_root,session_id,cwd,discovery_home,selection_hash,created_at,updated_at) VALUES(?,?,?,?,?,'',?,?,?)").run(input.taskId,input.runner,nativeRoot,input.sessionId,input.cwd,digest(bytes),now,now);

    }).immediate());
  }
  private quarantine(taskId: string,reason: string): void {
    const row = this.store.sqlite.prepare(SELECT).get(taskId) as SnapshotRow | undefined; if (!row) return;
    this.store.sqlite.transaction(() => {
      this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_session_holds(task_id,previous_retention,reason,created_at) VALUES(?,?,?,?)').run(taskId,row.retention_state,reason,new Date().toISOString());
      this.store.sqlite.prepare("UPDATE capability_session_snapshots SET retention_state='hold',legacy_status=? WHERE task_id=?").run(reason,taskId);
    }).immediate();
  }
  async repairFromRecordedVersion(taskId: string,expectedHash: string): Promise<StoredCapabilitySession> {
    const saved = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const row = this.store.sqlite.prepare(SELECT).get(taskId) as SnapshotRow | undefined;
      const history = this.store.sqlite.prepare('SELECT snapshot_json,selection_hash FROM capability_snapshot_versions WHERE snapshot_hash=? AND task_id=?').get(expectedHash,taskId) as { snapshot_json: string;selection_hash: string } | undefined;
      const hold = this.store.sqlite.prepare('SELECT previous_retention,reason FROM capability_session_holds WHERE task_id=?').get(taskId) as { previous_retention: string;reason: string } | undefined;
      if (!row || row.schema_version !== 2 || row.snapshot_hash !== expectedHash || !history || (hold && !['corrupt','snapshot-corrupt'].includes(hold.reason))) throw new ApplicationError('SESSION_ON_HOLD','没有与原登记hash匹配的已知版本，不能猜测或按当前默认重建');
      let original: CapabilitySessionSnapshotV2;
      try { original = capabilitySessionSnapshotSchema.parse(JSON.parse(history.snapshot_json)); } catch { throw new ApplicationError('SNAPSHOT_CORRUPT','原登记备份也不可核验'); }
      if (digest(canonicalJson(original)) !== expectedHash || selectionHash(original) !== history.selection_hash) throw new ApplicationError('SNAPSHOT_CORRUPT','原登记版本摘要不匹配');
      this.store.sqlite.prepare('UPDATE capability_session_snapshots SET snapshot_json=?,retention_state=?,legacy_status=? WHERE task_id=? AND snapshot_hash=?').run(history.snapshot_json,hold?.previous_retention ?? row.retention_state,original.provenance,taskId,expectedHash);
      const verified = this.read(taskId); this.store.sqlite.prepare('DELETE FROM capability_session_holds WHERE task_id=?').run(taskId); return verified;
    }).immediate()); await this.ensureMirror(taskId); return saved;
  }
  hasUnresolvedHistory(): boolean { return !!this.store.sqlite.prepare("SELECT 1 FROM capability_session_snapshots WHERE schema_version<>2 OR retention_state='hold' OR legacy_status IN ('corrupt','history-unknown','snapshot-corrupt') LIMIT 1").get(); }
  async ensureMirror(taskId: string): Promise<{ repaired: boolean;backup: string | null }> {
    return withResourceLock(this.store.root,() => {
      const current = this.read(taskId), path = ensureStoreDirectory(this.store.root,'sessions/' + taskId), marker = join(path,'.smartdd-owned.json');
      const owner = { owner: 'SmartDD',schema: 2,storeId: this.store.storeId,kind: 'session',taskId,sourceHash: current.selectionHash };
      if (!existsSync(marker)) {
        // The session root is established before any plugin or bridge files are prepared.
        const names = readdirSync(path); if (names.length) throw new ApplicationError('OWNERSHIP_CONFLICT','会话目录包含未登记内容，保留原样');
        writeFileSync(marker,canonicalJson(owner) + '\n',{ flag: 'wx',mode: 0o600 });
      }
      if (lstatSync(marker).isSymbolicLink()) throw new ApplicationError('OWNERSHIP_CONFLICT','会话归属标记被链接占用');
      let known: unknown; try { known = JSON.parse(readFileSync(marker,'utf8')); } catch { throw new ApplicationError('OWNERSHIP_CONFLICT','会话归属标记不可读'); }
      if (canonicalJson(known) !== canonicalJson(owner)) throw new ApplicationError('OWNERSHIP_CONFLICT','会话目录归属或固定选择不同，不能覆盖');
      const target = join(path,'snapshot.json'), bytes = canonicalJson({ schema: 2,snapshotHash: current.pointer.snapshotHash,selectionHash: current.selectionHash,snapshot: current.snapshot }) + '\n'; let backup: string | null = null;
      if (existsSync(target)) {
        const stat = lstatSync(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new ApplicationError('OWNERSHIP_CONFLICT','快照镜像被其他内容占用');
        if (readFileSync(target,'utf8') === bytes) return { repaired: false,backup: null };
        backup = join(ensureStoreDirectory(this.store.root,'conflicts'),`snapshot-${taskId}-${randomUUID()}.json`); linkSync(target,backup);
      }
      const temp = join(path,'.snapshot-' + randomUUID() + '.tmp');
      try {
        writeFileSync(temp,bytes,{ flag: 'wx',mode: 0o600 }); const fd = openSync(temp,constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temp,target); const dir = openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(dir); } finally { closeSync(dir); }
      } catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error; }
      return { repaired: true,backup };
    });
  }
}
