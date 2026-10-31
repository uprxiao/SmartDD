import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { APP_HASH_PATTERN, ApplicationError, isPackagePath } from '@shared/applications';
import { canonicalJson, digest } from './manifest';
import { ensureStoreDirectory } from './package-files';
import { withResourceLock } from './resource-lock';

export interface ResourceRecord {
  resourceId: string; kind: string; contentHash: string; ownerStoreId: string; relativePath: string;pathScope: 'C' | 'H';scopeIdentity: string;
  state: 'staged' | 'verified' | 'ready' | 'deleting' | 'removed' | 'recovery-required';
  generation: number; integrity: 'unknown' | 'valid' | 'invalid'; operationId: string | null;
}
export interface PublishResource {
  resourceId: string; kind: string; contentHash: string; relativePath: string; dependencies: string[];
  materialize: (stage: string) => void; verify: (directory: string) => void;
  register?: (operationId: string) => void;
}
export type PublishCheckpoint = 'registered' | 'materialized' | 'renamed';
const SELECT = `SELECT resource_id AS resourceId,kind,content_hash AS contentHash,owner_store_id AS ownerStoreId,
  COALESCE(scope_relative_path,relative_path) AS relativePath,path_scope AS pathScope,CASE WHEN path_scope='C' THEN owner_store_id ELSE scope_identity END AS scopeIdentity,state,generation,integrity,operation_id AS operationId FROM capability_resources`;

/** Durable C-store publication. File copies never run inside a SQLite write transaction. */
export class ResourceStore {
  readonly root: string;
  readonly storeId: string;
  readonly instanceId = randomUUID();
  private readonly activeOperations = new Set<string>();
  constructor(readonly sqlite: Database.Database, userData: string, private readonly checkpoint?: (at: PublishCheckpoint) => void) {
    mkdirSync(userData, { recursive: true, mode: 0o700 });
    const parent = realpathSync(userData);
    try { mkdirSync(join(parent, 'capabilities'), { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.root = join(parent, 'capabilities');
    if (lstatSync(this.root).isSymbolicLink() || !lstatSync(this.root).isDirectory()) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用资源根被其他内容占用');
    const owner = join(this.root, '.store-id.json');
    try { writeFileSync(owner, canonicalJson({ schema: 1, storeId: randomUUID() }) + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    try {
      if (lstatSync(owner).isSymbolicLink()) throw new Error();
      const info = JSON.parse(readFileSync(owner, 'utf8'));
      if (info.schema !== 1 || !/^[a-f0-9-]{36}$/.test(info.storeId)) throw new Error();
      this.storeId = info.storeId;
    } catch { throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '应用资源库身份无法核验'); }
  }
  get(id: string): ResourceRecord {
    const row = this.sqlite.prepare(SELECT + ' WHERE resource_id=?').get(id) as ResourceRecord | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND', '应用资源记录不存在');
    if (row.ownerStoreId !== this.storeId || !isPackagePath(row.relativePath)) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用资源归属不一致');
    if (!['C','H'].includes(row.pathScope) || (row.pathScope === 'H' && (!APP_HASH_PATTERN.test(row.scopeIdentity) || !row.relativePath.startsWith('.agents/skills/')))) throw new ApplicationError('OWNERSHIP_CONFLICT','资源位置范围无法核验');
    return row;
  }
  directory(resource: ResourceRecord): string {
    if (resource.pathScope === 'C') return join(this.root,resource.relativePath);
    const home = this.sqlite.prepare('SELECT canonical_home AS home FROM capability_discovery_roots WHERE home_id=?').get(resource.scopeIdentity) as { home: string } | undefined;
    if (!home || digest(home.home) !== resource.scopeIdentity || realpathSync(home.home) !== home.home || !resource.relativePath.startsWith('.agents/skills/')) throw new ApplicationError('OWNERSHIP_CONFLICT','共享投影的实际发现根无法核验');
    return join(home.home,resource.relativePath);
  }
  private checkSpec(spec: PublishResource): void {
    if (!/^[a-z][a-z0-9:._-]{0,199}$/.test(spec.resourceId) || !isPackagePath(spec.relativePath) || !APP_HASH_PATTERN.test(spec.contentHash)
      || new Set(spec.dependencies).size !== spec.dependencies.length || spec.dependencies.includes(spec.resourceId)) throw new ApplicationError('INVALID_PACKAGE', '资源发布声明无效');
  }
  private assertDependencies(ids: string[]): void {
    for (const id of ids) {
      const resource = this.get(id);
      if (resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED', '应用依赖尚未就绪');
    }
  }
  private assertIdentity(row: ResourceRecord, spec: PublishResource): void {
    if (row.pathScope !== 'C' || row.kind !== spec.kind || row.contentHash !== spec.contentHash || row.relativePath !== spec.relativePath) throw new ApplicationError('OWNERSHIP_CONFLICT', '资源标识与发布身份不一致');
  }
  private lease(resourceId: string, operationId: string, kind = 'install',identity?:{pid:number;startedAt:string}): string {
    const leaseId = randomUUID();
    this.sqlite.prepare(`INSERT INTO capability_resource_leases
      (lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at)
      VALUES(?,?,?,?,?,?,?, 'active',?)`).run(leaseId, resourceId, kind, operationId, this.instanceId, process.pid, identity?.startedAt??new Date(Date.now() - process.uptime() * 1000).toISOString(), new Date().toISOString());
    return leaseId;
  }
  private endLease(leaseId: string): void {
    this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND host_instance_id=?").run(new Date().toISOString(), leaseId, this.instanceId);
  }
  private phase(operationId: string, state: string, code: string | null = null): void {
    const now = new Date().toISOString();
    this.sqlite.prepare('UPDATE capability_resource_operations SET state=?,error_code=?,updated_at=? WHERE operation_id=? AND owner_store_id=?').run(state, code, now, operationId, this.storeId);
    this.sqlite.prepare('UPDATE capability_install_journal SET state=?,error_code=?,updated_at=? WHERE install_id=?').run(state, code, now, operationId);
  }
  async use<T>(resourceId: string, ownerKind: string, ownerId: string, action: (directory: string) => T | Promise<T>,options:{identity?:{pid:number;startedAt:string}}={}): Promise<T> {
    if(options.identity&&(options.identity.pid!==process.pid||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(options.identity.startedAt)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','资源活动进程身份无效');
    let leaseId = '', directory = '';
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const rows = this.sqlite.prepare(`WITH RECURSIVE needed(id) AS (VALUES(?) UNION SELECT d.dependency_id FROM capability_resource_dependencies d JOIN needed n ON d.resource_id=n.id) SELECT id FROM needed`).all(resourceId) as { id: string }[];
      this.assertDependencies(rows.map(r => r.id));
      const resource = this.get(resourceId);
      if (resource.pathScope !== 'C') throw new ApplicationError('OWNERSHIP_CONFLICT','共享发现资源须先取得对应H目录占用');
      directory = this.directory(resource);
      leaseId = this.lease(resourceId, ownerId, ownerKind,options.identity);
    }).immediate());
    try { return await action(directory); }
    finally { await withResourceLock(this.root, () => this.endLease(leaseId)); }
  }
  async publish(spec: PublishResource, signal?: AbortSignal): Promise<ResourceRecord> {
    this.checkSpec(spec);
    const operationId = randomUUID();
    let reuse = false, leaseId = '';
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      this.assertDependencies(spec.dependencies);
      const old = this.sqlite.prepare(SELECT + ' WHERE resource_id=?').get(spec.resourceId) as ResourceRecord | undefined;
      if (old) {
        this.assertIdentity(this.get(spec.resourceId), spec);
        if (old.state !== 'removed' && (old.state !== 'ready' || old.integrity !== 'valid')) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '资源有未完成的发布或清理，先恢复原操作');
        const actual = (this.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(spec.resourceId) as { dependency_id: string }[]).map(d => d.dependency_id);
        if (canonicalJson(actual) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError('RESOURCE_STATE_CHANGED', '资源依赖与原发布不一致');
        if (old.state === 'removed') {
          const now = new Date().toISOString();
          this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, 'restore-' + spec.kind, this.storeId, canonicalJson({ resourceId: spec.resourceId, hash: spec.contentHash, relativePath: spec.relativePath, dependencies: [...spec.dependencies].sort(), instanceId: this.instanceId, pid: process.pid }), now, now);
          this.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',generation=generation+1,operation_id=? WHERE resource_id=? AND state='removed'").run(operationId,spec.resourceId);
          leaseId = this.lease(spec.resourceId, operationId); return;
        }
        reuse = true; leaseId = this.lease(spec.resourceId, operationId); return;
      }
      const now = new Date().toISOString();
      this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at)
        VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, 'install-' + spec.kind, this.storeId, canonicalJson({ resourceId: spec.resourceId, hash: spec.contentHash, relativePath: spec.relativePath, dependencies: [...spec.dependencies].sort(), instanceId: this.instanceId, pid: process.pid }), now, now);
      this.sqlite.prepare(`INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity,operation_id)
        VALUES(?,?,?,?,'C',?,'staged',1,'unknown',?)`).run(spec.resourceId, spec.kind, spec.contentHash, this.storeId, spec.relativePath, operationId);
      for (const id of spec.dependencies) this.sqlite.prepare('INSERT INTO capability_resource_dependencies(resource_id,dependency_id) VALUES(?,?)').run(spec.resourceId, id);
      spec.register?.(operationId);
      leaseId = this.lease(spec.resourceId, operationId);
    }).immediate(), { signal });
    if (reuse) {
      try { spec.verify(join(this.root, spec.relativePath)); return this.get(spec.resourceId); }
      finally { await withResourceLock(this.root, () => this.endLease(leaseId)); }
    }
    this.activeOperations.add(operationId);
    try {
      this.checkpoint?.('registered');
      await this.finish(spec, operationId, leaseId, signal);
      return this.get(spec.resourceId);
    } catch (error) {
      await this.recordFailure(spec.resourceId, operationId, leaseId, error);
      throw error;
    } finally { this.activeOperations.delete(operationId); }
  }
  private async finish(spec: PublishResource, operationId: string, leaseId: string, signal?: AbortSignal): Promise<void> {
    ensureStoreDirectory(this.root, 'staging');
    const stage = join(this.root, 'staging', operationId), target = join(this.root, spec.relativePath);
    if (!existsSync(target)) {
      if (!existsSync(stage)) spec.materialize(stage);
      spec.verify(stage);
    } else spec.verify(target);
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const row = this.get(spec.resourceId); this.assertIdentity(row, spec);
      if (row.operationId !== operationId || row.state === 'deleting' || row.state === 'removed') throw new ApplicationError('RESOURCE_STATE_CHANGED', '发布资源状态已变化');
      this.assertDependencies(spec.dependencies);
      this.sqlite.prepare("UPDATE capability_resources SET state='verified',integrity='valid' WHERE resource_id=?").run(spec.resourceId);
      this.phase(operationId, 'verified');
    }).immediate(), { signal });
    this.checkpoint?.('materialized');
    await withResourceLock(this.root, () => {
      this.assertDependencies(spec.dependencies);
      const row = this.get(spec.resourceId);
      if (row.operationId !== operationId || row.state !== 'verified') throw new ApplicationError('RESOURCE_STATE_CHANGED', '发布资源状态已变化');
      if (dirname(spec.relativePath) !== '.') ensureStoreDirectory(this.root, dirname(spec.relativePath));
      if (existsSync(target)) spec.verify(target);
      else renameSync(stage, target);
      this.phase(operationId, 'published');
      this.checkpoint?.('renamed');
      this.sqlite.transaction(() => {
        this.assertDependencies(spec.dependencies);
        this.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid' WHERE resource_id=? AND operation_id=?").run(spec.resourceId, operationId);
        this.phase(operationId, 'committed'); this.endLease(leaseId);
      }).immediate();
    }, { signal });
    // A duplicate verified stage is private to this completed operation, never an application path.
    if (existsSync(stage) && !lstatSync(stage).isSymbolicLink()) rmSync(stage, { recursive: true });
  }
  private async recordFailure(resourceId: string, operationId: string, leaseId: string, error: unknown): Promise<void> {
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const row = this.get(resourceId);
      if (row.operationId !== operationId || row.state === 'ready') return;
      this.sqlite.prepare("UPDATE capability_resources SET state='recovery-required',integrity='unknown' WHERE resource_id=?").run(resourceId);
      this.phase(operationId, 'failed', error instanceof ApplicationError ? error.code : 'INSTALL_FAILED');
      this.endLease(leaseId);
    }).immediate());
  }
  async recover(spec: PublishResource, operationId: string, signal?: AbortSignal): Promise<ResourceRecord> {
    this.checkSpec(spec);
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new ApplicationError('INVALID_PACKAGE', '恢复操作标识无效');
    let leaseId = '', alreadyReady = false;
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const row = this.get(spec.resourceId); this.assertIdentity(row, spec);
      if (row.operationId !== operationId || this.activeOperations.has(operationId)) throw new ApplicationError('RESOURCE_BUSY', '原发布操作仍在执行或归属不同');
      const operation = this.sqlite.prepare('SELECT state,plan_json AS plan FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(operationId, this.storeId) as { state: string; plan: string } | undefined;
      if (!operation) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '缺少原发布日志');
      const plan = JSON.parse(operation.plan) as { pid: number; resourceId: string; hash: string; relativePath: string; dependencies: string[] };
      if (plan.resourceId !== spec.resourceId || plan.hash !== spec.contentHash || plan.relativePath !== spec.relativePath || canonicalJson(plan.dependencies) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError('RESOURCE_STATE_CHANGED', '恢复输入与原发布不一致');
      if (operation.state !== 'failed' && operation.state !== 'committed') {
        try { process.kill(plan.pid, 0); throw new ApplicationError('RESOURCE_BUSY', '原发布进程仍存在，保留占用'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      }
      if (row.state === 'deleting' || row.state === 'removed') throw new ApplicationError('RESOURCE_STATE_CHANGED', '不能从清理状态恢复发布');
      this.assertDependencies(spec.dependencies);
      this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE owner_id=? AND owner_kind='install' AND state<>'released'").run(new Date().toISOString(), operationId);
      alreadyReady = row.state === 'ready' && operation.state === 'committed';
      leaseId = this.lease(spec.resourceId, operationId);
      if (!alreadyReady) this.phase(operationId, 'recovering');
    }).immediate(), { signal });
    if (alreadyReady) {
      try { spec.verify(join(this.root, spec.relativePath)); return this.get(spec.resourceId); }
      finally { await withResourceLock(this.root, () => this.endLease(leaseId)); }
    }
    this.activeOperations.add(operationId);
    try { await this.finish(spec, operationId, leaseId, signal); return this.get(spec.resourceId); }
    catch (error) { await this.recordFailure(spec.resourceId, operationId, leaseId, error); throw error; }
    finally { this.activeOperations.delete(operationId); }
  }
}
