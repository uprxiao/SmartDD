import type {DatabaseAccessLease} from '../../db/database-access-gate';
import {assertClaudePublication} from './claude-delivery-state';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { APP_HASH_PATTERN, ApplicationError, isPackagePath } from '@shared/applications';
import { canonicalJson, digest } from './manifest';
import { ensureStoreDirectory } from './package-files';
import { withResourceLock } from './resource-lock';
import type {ProcessIdentity,ProcessIdentityReader} from './process-identity';

export interface ResourceRecord {
  resourceId: string; kind: string; contentHash: string; ownerStoreId: string; relativePath: string;pathScope: 'C' | 'H';scopeIdentity: string;
  state: 'staged' | 'verified' | 'ready' | 'deleting' | 'removed' | 'recovery-required';
  generation: number; integrity: 'unknown' | 'valid' | 'invalid'; operationId: string | null;
}
export interface PublishResource {
  resourceId: string; kind: string; contentHash: string; relativePath: string; dependencies: string[];
  materialize: (stage: string) => void; verify: (directory: string) => void;
  register?: (operationId: string) => void;
  /** Host-only short precondition, rechecked in each publication/repair transaction. */
  assertPublish?: (operationId: string) => void;
}
export type PublishCheckpoint = 'registered' | 'materialized' | 'renamed';
const SELECT = `SELECT resource_id AS resourceId,kind,content_hash AS contentHash,owner_store_id AS ownerStoreId,relative_path AS rawRelativePath,scope_relative_path AS physicalAliasPath,
  COALESCE(scope_relative_path,relative_path) AS relativePath,path_scope AS pathScope,CASE WHEN path_scope='C' THEN owner_store_id ELSE scope_identity END AS scopeIdentity,state,generation,integrity,operation_id AS operationId FROM capability_resources`;

/** Durable C-store publication. File copies never run inside a SQLite write transaction. */
export class ResourceStore {
  readonly root: string;
  readonly storeId: string;
  readonly instanceId = randomUUID();
  private readonly activeOperations = new Set<string>();
  private readonly host:ProcessIdentity|null;
  constructor(readonly sqlite: Database.Database, userData: string, private readonly checkpoint?: (at: PublishCheckpoint) => void,private readonly options:{processes?:ProcessIdentityReader}={}) {
    const host=options.processes?.read(process.pid);this.host=host&&host.pid===process.pid&&/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(host.startedAt)?{...host}:null;
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
    const found = this.sqlite.prepare(SELECT + ' WHERE resource_id=?').get(id) as (ResourceRecord & {rawRelativePath:string;physicalAliasPath:string|null}) | undefined;
    if(!found)throw new ApplicationError('NOT_FOUND','应用资源记录不存在');const {rawRelativePath,physicalAliasPath,...row}=found;
    if(['claude-delivery-root','claude-delivery'].includes(row.kind)&&(!physicalAliasPath||row.pathScope!=='C'))throw new ApplicationError('OWNERSHIP_CONFLICT','Claude交付缺少显式物理位置');
    if(row.pathScope==='C'&&physicalAliasPath){const match=/^sessions\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/claude\/plugin$/.exec(physicalAliasPath),taskId=match?.[1];if(!taskId||!(row.kind==='claude-delivery-root'&&row.resourceId==='claude-delivery-root:'+taskId&&rawRelativePath===`claude-deliveries/${taskId}/anchor`||row.kind==='claude-delivery'&&row.resourceId===`claude-delivery:${taskId}:${row.contentHash}`&&rawRelativePath===`claude-deliveries/${taskId}/records/${row.contentHash}`))throw new ApplicationError('OWNERSHIP_CONFLICT','C目录物理别名不属于已登记的Claude交付种类');}
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
  private assertRecordedDependencies(spec:PublishResource):void{
    const actual=(this.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(spec.resourceId) as {dependency_id:string}[]).map(r=>r.dependency_id);
    if(canonicalJson(actual)!==canonicalJson([...spec.dependencies].sort()))throw new ApplicationError('RESOURCE_STATE_CHANGED','原资源的依赖集合已经变化');
    this.assertDependencies(spec.dependencies);
  }
  private assertIdentity(row: ResourceRecord, spec: PublishResource): void {
    if (row.pathScope !== 'C' || row.kind !== spec.kind || row.contentHash !== spec.contentHash || row.relativePath !== spec.relativePath) throw new ApplicationError('OWNERSHIP_CONFLICT', '资源标识与发布身份不一致');
  }
  private lease(resourceId: string, operationId: string, kind = 'install',identity?:{pid:number;startedAt:string},leaseId:string=randomUUID()): string {
    this.sqlite.prepare(`INSERT INTO capability_resource_leases
      (lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at)
      VALUES(?,?,?,?,?,?,?, 'active',?)`).run(leaseId, resourceId, kind, operationId, this.instanceId, process.pid, identity?.startedAt??this.host?.startedAt??new Date(Date.now() - process.uptime() * 1000).toISOString(), new Date().toISOString());
    return leaseId;
  }
  private publicationPlan(spec:PublishResource,leaseId:string):string{
    if(this.options.processes&&!this.host)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验发布宿主的内核身份，保留原资源');
    return canonicalJson({resourceId:spec.resourceId,hash:spec.contentHash,relativePath:spec.relativePath,dependencies:[...spec.dependencies].sort(),instanceId:this.instanceId,pid:process.pid,host:this.host,leaseId});
  }
  private assertOwnPublisher(resourceId:string,operationId:string,leaseId:string):void{
    const row=this.sqlite.prepare('SELECT resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE lease_id=?').get(leaseId) as {resource_id:string;owner_kind:string;owner_id:string;host_instance_id:string;pid:number|null;process_started_at:string|null;state:string}|undefined;
    if(!row||row.resource_id!==resourceId||row.owner_kind!=='install'||row.owner_id!==operationId||row.host_instance_id!==this.instanceId||row.pid!==process.pid||this.host&&row.process_started_at!==this.host.startedAt||row.state!=='active')throw new ApplicationError('RESOURCE_BUSY','当前资源发布占用已经变化，保留原记录');
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
  /** Only exact activation-owned leases with a stopped kernel identity can end. */
  async recoverActivationLeases(operationId:string,maintenance:DatabaseAccessLease):Promise<void>{
    const assertMaintenance=()=>{maintenance.assertHeld();if(maintenance.mode!=='maintenance'||maintenance.root!==realpathSync(dirname(this.root))||maintenance.root!==realpathSync(dirname(this.sqlite.name)))throw new ApplicationError('RESOURCE_BUSY','恢复激活占用需要本库独占维护权');};
    assertMaintenance();
    type ActivationLease={lease_id:string;resource_id:string;pid:number;process_started_at:string;state:string};
    const readLeases=()=>this.sqlite.prepare("SELECT lease_id,resource_id,pid,process_started_at,state FROM capability_resource_leases WHERE owner_kind='application-activation' AND owner_id=? AND state<>'released' ORDER BY lease_id").all(operationId) as ActivationLease[];
    const readOperation=()=>this.sqlite.prepare("SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=? AND kind='application-activation'").get(operationId,this.storeId) as {state:string;plan_json:string}|undefined;
    await withResourceLock(this.root,()=>{
      assertMaintenance();
      if(this.sqlite.inTransaction)throw new ApplicationError('RESOURCE_BUSY','激活占用恢复须在业务事务结束后重试');
      const expectedLeases=readLeases(),expectedOperation=readOperation(),stoppedOwners=new Map<string,boolean>();
      // Keep C and exclusive maintenance ownership across the native reads,
      // but enter the business transaction only after they finish. Exact
      // stopped identities cannot revive; mutable records are compared below.
      for(const row of expectedLeases){
        if(!Number.isSafeInteger(row.pid)||row.pid<1||typeof row.process_started_at!=='string'||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(row.process_started_at)||!this.options.processes)continue;
        const identity={pid:row.pid,startedAt:row.process_started_at},key=canonicalJson(identity);
        if(!stoppedOwners.has(key))stoppedOwners.set(key,this.options.processes.state(identity)==='stopped');
      }
      return this.sqlite.transaction(()=>{
      assertMaintenance();
      const rows=readLeases(),operation=readOperation();
      if(canonicalJson(rows)!==canonicalJson(expectedLeases)||canonicalJson(operation??null)!==canonicalJson(expectedOperation??null))throw new ApplicationError('RESOURCE_STATE_CHANGED','身份核验期间原激活计划或占用已变化，保留原记录');
      if(!rows.length)return;
      if(!operation||!['verified','committed'].includes(operation.state))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','激活占用缺少原操作依据');
      const plan=JSON.parse(operation.plan_json);
      if(plan.operationId!==operationId||plan.storeId!==this.storeId||!Array.isArray(plan.requests)||!plan.requests.every((r:{hash?:unknown})=>typeof r.hash==='string'&&/^[a-f0-9]{64}$/.test(r.hash)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','激活占用计划不能核验');
      const ids=new Set(plan.requests.map((r:{hash:string})=>'app:'+r.hash));
      for(const row of rows){
        if(!ids.has(row.resource_id)||this.get(row.resource_id).kind!=='application-package')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','激活占用资源与计划不符');
        if(stoppedOwners.get(canonicalJson({pid:row.pid,startedAt:row.process_started_at}))!==true)throw new ApplicationError('RESOURCE_BUSY','原激活进程仍存活或身份未知，保留占用');
      }
      for(const row of rows)this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND owner_kind='application-activation' AND owner_id=?").run(new Date().toISOString(),row.lease_id,operationId);
      }).immediate();
    });
  }
  /** Absence is repairable; an occupied or linked path is never an empty target. */
  private missingTarget(spec: PublishResource): boolean {
    try {
      const root = lstatSync(this.root), owner = join(this.root, '.store-id.json'), marker = lstatSync(owner);
      if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(this.root)!==this.root || !marker.isFile() || marker.nlink !== 1 || marker.size>4096) throw new Error();
      const identity = JSON.parse(readFileSync(owner, 'utf8'));
      if (identity.schema !== 1 || identity.storeId !== this.storeId) throw new Error();
    } catch { throw new ApplicationError('OWNERSHIP_CONFLICT', '原资源库身份已变化，保留原目录'); }
    let directory = this.root;
    for (const part of spec.relativePath.split('/')) {
      directory = join(directory, part);
      let stat;
      try { stat = lstatSync(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError('OWNERSHIP_CONFLICT', '原资源路径被文件或链接占用，不能修复覆盖');
    }
    return false;
  }
  /** Republish missing immutable bytes under the same identity. Historical refs stay intact. */
  private async restoreMissing(spec: PublishResource, signal?: AbortSignal): Promise<ResourceRecord> {
    const operationId = randomUUID(); let leaseId = '', present = false;
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      assertClaudePublication(this,spec.relativePath,spec.contentHash);const row = this.get(spec.resourceId); this.assertIdentity(row, spec); spec.assertPublish?.(operationId); this.assertDependencies(spec.dependencies);
      if (row.state !== 'ready' || row.integrity !== 'valid') throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原资源已有发布或清理操作，先恢复原操作');
      const state = this.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
      if (state && (state.store_id !== this.storeId || state.maintenance_state !== 'ready')) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原资源库正在维护或待恢复');
      const dependencies = (this.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(spec.resourceId) as {dependency_id:string}[]).map(r => r.dependency_id);
      if (canonicalJson(dependencies) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError('RESOURCE_STATE_CHANGED', '原资源依赖已变化，不能修复');
      // A concurrent successful repair may have restored the path. Verify it outside the transaction.
      if (!this.missingTarget(spec)) { present = true; leaseId = this.lease(spec.resourceId, operationId); return; }
      const consumers = this.sqlite.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT id FROM consumers`).all(spec.resourceId) as {id:string}[];
      if (consumers.length > 10000) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原资源依赖占用超过核查预算');
      const ids = consumers.map(r => r.id), marks = ids.map(() => '?').join(',');
      const busy = this.sqlite.prepare(`SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND (l.resource_id IN (${marks}) OR EXISTS(SELECT 1 FROM capability_lease_resources p WHERE p.lease_id=l.lease_id AND p.resource_id IN (${marks}))) LIMIT 1`).get(...ids, ...ids);
      if (busy) throw new ApplicationError('RESOURCE_BUSY', '原资源或依赖仍有占用，暂不修复缺失目录');
      const now = new Date().toISOString();
      this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, 'restore-' + spec.kind, this.storeId, this.publicationPlan(spec,leaseId=randomUUID()), now, now);
      this.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',generation=generation+1,operation_id=? WHERE resource_id=? AND state='ready'").run(operationId, spec.resourceId);
      leaseId = this.lease(spec.resourceId, operationId,'install',undefined,leaseId);
    }).immediate(), {signal});
    if (present) {
      try { spec.verify(join(this.root, spec.relativePath)); return this.get(spec.resourceId); }
      finally { await withResourceLock(this.root, () => this.endLease(leaseId)); }
    }
    this.activeOperations.add(operationId);
    try { this.checkpoint?.('registered'); await this.finish(spec, operationId, leaseId, signal); return this.get(spec.resourceId); }
    catch (error) { await this.recordFailure(spec.resourceId, operationId, leaseId, error); throw error; }
    finally { this.activeOperations.delete(operationId); }
  }
  async publish(spec: PublishResource, signal?: AbortSignal): Promise<ResourceRecord> {
    this.checkSpec(spec);
    const operationId = randomUUID();
    let reuse = false, leaseId = '';
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      this.assertDependencies(spec.dependencies); spec.assertPublish?.(operationId);
      const old = this.sqlite.prepare(SELECT + ' WHERE resource_id=?').get(spec.resourceId) as ResourceRecord | undefined;
      assertClaudePublication(this,spec.relativePath,spec.contentHash,old?.state==='ready'&&old.integrity==='valid');
      if (old) {
        this.assertIdentity(this.get(spec.resourceId), spec);
        if (old.state !== 'removed' && (old.state !== 'ready' || old.integrity !== 'valid')) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '资源有未完成的发布或清理，先恢复原操作');
        const actual = (this.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(spec.resourceId) as { dependency_id: string }[]).map(d => d.dependency_id);
        if (canonicalJson(actual) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError('RESOURCE_STATE_CHANGED', '资源依赖与原发布不一致');
        if (old.state === 'removed') {
          const now = new Date().toISOString();
          this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, 'restore-' + spec.kind, this.storeId, this.publicationPlan(spec,leaseId=randomUUID()), now, now);
          this.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',generation=generation+1,operation_id=? WHERE resource_id=? AND state='removed'").run(operationId,spec.resourceId);
          leaseId = this.lease(spec.resourceId, operationId,'install',undefined,leaseId); return;
        }
        reuse = true; leaseId = this.lease(spec.resourceId, operationId); return;
      }
      const now = new Date().toISOString();
      this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at)
        VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, 'install-' + spec.kind, this.storeId, this.publicationPlan(spec,leaseId=randomUUID()), now, now);
      this.sqlite.prepare(`INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity,operation_id)
        VALUES(?,?,?,?,'C',?,'staged',1,'unknown',?)`).run(spec.resourceId, spec.kind, spec.contentHash, this.storeId, spec.relativePath, operationId);
      for (const id of spec.dependencies) this.sqlite.prepare('INSERT INTO capability_resource_dependencies(resource_id,dependency_id) VALUES(?,?)').run(spec.resourceId, id);
      spec.register?.(operationId);
      leaseId = this.lease(spec.resourceId, operationId,'install',undefined,leaseId);
    }).immediate(), { signal });
    if (reuse) {
      let failure: unknown, missing = false;
      try { spec.verify(join(this.root, spec.relativePath)); return this.get(spec.resourceId); }
      catch (error) { failure = error; missing = this.missingTarget(spec); }
      finally { await withResourceLock(this.root, () => this.endLease(leaseId)); }
      if (!missing) throw failure;
      return this.restoreMissing(spec, signal);
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
    this.assertOwnPublisher(spec.resourceId,operationId,leaseId);spec.assertPublish?.(operationId);
    ensureStoreDirectory(this.root, 'staging');
    const stage = join(this.root, 'staging', operationId), target = join(this.root, spec.relativePath);
    if (this.missingTarget(spec)) {
      if (!existsSync(stage)) spec.materialize(stage);
      spec.verify(stage);
    } else spec.verify(target);
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      assertClaudePublication(this,spec.relativePath,spec.contentHash);
      this.assertOwnPublisher(spec.resourceId,operationId,leaseId);spec.assertPublish?.(operationId);
      const row = this.get(spec.resourceId); this.assertIdentity(row, spec);
      if (row.operationId !== operationId || row.state === 'deleting' || row.state === 'removed') throw new ApplicationError('RESOURCE_STATE_CHANGED', '发布资源状态已变化');
      this.assertRecordedDependencies(spec);
      this.sqlite.prepare("UPDATE capability_resources SET state='verified',integrity='valid' WHERE resource_id=?").run(spec.resourceId);
      this.phase(operationId, 'verified');
    }).immediate(), { signal });
    this.checkpoint?.('materialized');
    await withResourceLock(this.root, () => {
      assertClaudePublication(this,spec.relativePath,spec.contentHash);
      this.assertOwnPublisher(spec.resourceId,operationId,leaseId);spec.assertPublish?.(operationId);
      this.assertRecordedDependencies(spec);
      const row = this.get(spec.resourceId);
      if (row.operationId !== operationId || row.state !== 'verified') throw new ApplicationError('RESOURCE_STATE_CHANGED', '发布资源状态已变化');
      if (dirname(spec.relativePath) !== '.') ensureStoreDirectory(this.root, dirname(spec.relativePath));
      if (!this.missingTarget(spec)) spec.verify(target);
      else renameSync(stage, target);
      this.phase(operationId, 'published');
      this.checkpoint?.('renamed');
      assertClaudePublication(this,spec.relativePath,spec.contentHash);
      this.assertOwnPublisher(spec.resourceId,operationId,leaseId);spec.assertPublish?.(operationId);spec.verify(target);
      this.sqlite.transaction(() => {
        this.assertOwnPublisher(spec.resourceId,operationId,leaseId);this.assertRecordedDependencies(spec);
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
    type Operation={kind:string;state:string;plan:string};
    type Install={lease_id:string;resource_id:string;host_instance_id:string;pid:number|null;process_started_at:string|null;state:string};
    const validIdentity=(v:ProcessIdentity|null|undefined):v is ProcessIdentity=>!!v&&Number.isSafeInteger(v.pid)&&v.pid>0&&typeof v.startedAt==='string'&&/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(v.startedAt);
    const readOperation=()=>this.sqlite.prepare('SELECT kind,state,plan_json AS plan FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(operationId,this.storeId) as Operation|undefined;
    const readInstalls=()=>this.sqlite.prepare("SELECT lease_id,resource_id,host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE owner_id=? AND owner_kind='install' ORDER BY lease_id").all(operationId) as Install[];
    await withResourceLock(this.root, () => {
      if(this.sqlite.inTransaction)throw new ApplicationError('RESOURCE_BUSY','资源恢复须在业务事务结束后重试');
      const expectedOperation=readOperation(),expectedInstalls=readInstalls(),stoppedOwners=new Map<string,boolean>();
      const observe=(identity:ProcessIdentity|null|undefined)=>{
        if(!validIdentity(identity)||!this.options.processes)return;
        const key=canonicalJson(identity);
        if(!stoppedOwners.has(key))stoppedOwners.set(key,this.options.processes.state(identity)==='stopped');
      };
      // Keep C ownership, but never hold a business write transaction across
      // native process queries. Exact stopped identities cannot revive. All
      // mutable operation/lease fields are compared again inside the transaction.
      if(expectedOperation&&!['failed','committed'].includes(expectedOperation.state)){
        let host:ProcessIdentity|null|undefined;
        try{const plan=JSON.parse(expectedOperation.plan);if(plan?.host?.pid===plan?.pid)host=plan.host;}catch{/* The transactional validator reports the original malformed plan. */}
        observe(host);
      }
      for(const lease of expectedInstalls)if(lease.state!=='released')observe({pid:lease.pid!,startedAt:lease.process_started_at!});
      return this.sqlite.transaction(() => {
      const slotOld=this.get(spec.resourceId);assertClaudePublication(this,spec.relativePath,spec.contentHash,slotOld.state==='ready'&&slotOld.integrity==='valid');
      const row = this.get(spec.resourceId); this.assertIdentity(row, spec);
      if (row.operationId !== operationId || this.activeOperations.has(operationId)) throw new ApplicationError('RESOURCE_BUSY', '原发布操作仍在执行或归属不同');
      const operation = readOperation();
      if(canonicalJson(operation??null)!==canonicalJson(expectedOperation??null))throw new ApplicationError('RESOURCE_STATE_CHANGED','身份核验期间原发布操作已变化，保留原记录');
      if(operation&&!['install-'+spec.kind,'restore-'+spec.kind].includes(operation.kind))throw new ApplicationError('RESOURCE_STATE_CHANGED','原发布操作类型不同');
      if (!operation) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '缺少原发布日志');
      let plan:{pid:number;instanceId:string;resourceId:string;hash:string;relativePath:string;dependencies:string[];host?:ProcessIdentity|null;leaseId?:string};
      try{plan=JSON.parse(operation.plan);if(!plan||!Number.isSafeInteger(plan.pid)||plan.pid<1||typeof plan.instanceId!=='string'||!Array.isArray(plan.dependencies))throw Error();}catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发布身份记录不完整');}
      if (plan.resourceId !== spec.resourceId || plan.hash !== spec.contentHash || plan.relativePath !== spec.relativePath || canonicalJson(plan.dependencies) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError('RESOURCE_STATE_CHANGED', '恢复输入与原发布不一致');
      if(operation.state!=='failed'&&operation.state!=='committed'){
        if(!validIdentity(plan.host)||plan.host.pid!==plan.pid||!this.options.processes)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发布者缺少可核验的内核启动身份');
        if(stoppedOwners.get(canonicalJson(plan.host))!==true)throw new ApplicationError('RESOURCE_BUSY','原发布者仍存活或身份未知，保留原占用');
      }
      const installs=readInstalls();
      if(canonicalJson(installs)!==canonicalJson(expectedInstalls))throw new ApplicationError('RESOURCE_STATE_CHANGED','身份核验期间原发布占用已变化，保留原记录');
      if(!installs.length)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发布占用凭据缺失');
      if(plan.leaseId){const original=installs.find(l=>l.lease_id===plan.leaseId);if(!original)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发布占用凭据缺失');if(original.resource_id!==spec.resourceId||original.host_instance_id!==plan.instanceId||original.pid!==plan.pid||plan.host&&original.process_started_at!==plan.host.startedAt)throw new ApplicationError('RESOURCE_BUSY','原发布占用已有不同恢复者，保留原记录');}
      const ended:string[]=[];
      for(const lease of installs){
        if(lease.resource_id!==spec.resourceId||!['active','released','recovery-required'].includes(lease.state))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发布占用的资源或状态不同');
        if(lease.state==='released')continue;
        const identity={pid:lease.pid!,startedAt:lease.process_started_at!};
        if(!validIdentity(identity)||!this.options.processes||stoppedOwners.get(canonicalJson(identity))!==true)throw new ApplicationError('RESOURCE_BUSY','原发布或恢复者仍存活或身份未知，保留占用');
        ended.push(lease.lease_id);
      }
      const held=this.sqlite.prepare("SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND NOT(l.owner_kind='install' AND l.owner_id=?) AND (l.resource_id=? OR EXISTS(SELECT 1 FROM capability_lease_resources r WHERE r.lease_id=l.lease_id AND r.resource_id=?)) LIMIT 1").get(operationId,spec.resourceId,spec.resourceId);
      if(held)throw new ApplicationError('RESOURCE_BUSY','原资源仍有其他运行或待核查占用');
      if (row.state === 'deleting' || row.state === 'removed') throw new ApplicationError('RESOURCE_STATE_CHANGED', '不能从清理状态恢复发布');
      this.assertRecordedDependencies(spec);
      for(const id of ended)this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND owner_id=? AND owner_kind='install' AND state<>'released'").run(new Date().toISOString(),id,operationId);
      spec.assertPublish?.(operationId);
      alreadyReady = row.state === 'ready' && operation.state === 'committed';
      leaseId = this.lease(spec.resourceId, operationId);
      if (!alreadyReady) this.phase(operationId, 'recovering');
      }).immediate();
    }, { signal });
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
