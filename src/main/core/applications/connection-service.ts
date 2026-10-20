import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { SecretsStore } from '../../secrets';
import { ApplicationError } from '@shared/applications';
import { connectionConfigSchema, providerApplication, saveConnectionSchema, verifiedConnectionIdentitySchema,
  type ApplicationConnection, type ConnectionChangePlan, type ConnectionCompatibilityImpact, type ConnectionConfig,
  type SaveApplicationConnection, type VerifiedConnectionCandidate, type VerifiedConnectionIdentity } from '@shared/application-connections';
import { canonicalJson, digest, parseManifest } from './manifest';
import { withResourceLock } from './resource-lock';
import type { ResourceStore } from './resource-store';

export interface ConnectionVerifier {
  verify(config: ConnectionConfig, secret: string | null, signal: AbortSignal): Promise<VerifiedConnectionIdentity>;
}
interface ConnectionRow {
  id: string; app_id: 'zentao' | 'mail'; provider_id: ConnectionConfig['kind']; name: string; config_json: string; config_schema_version: number;
  revision: number; config_revision: number; identity_revision: number; verified_identity_json: string; identity_hash: string;
  secret_ref: string | null; secret_revision: number; policy_revision: number; enabled: number; auth_state: 'connected' | 'disconnected';
  health: ApplicationConnection['health']; health_code: string | null; health_message: string | null; tested_at: string | null;
  cleanup_pending: number; created_at: string; updated_at: string;
}
interface CandidateRow {
  operation_id: string; connection_id: string; expected_revision: number; old_secret_ref: string | null; new_secret_ref: string | null;
  candidate_hash: string; candidate_json: string; verified_identity_json: string | null; compatibility_plan_json: string | null;
  expires_at: string; state: string;
}
type CandidateConfig = { id: string; name: string; config: ConnectionConfig; expectedRevision: number };
const safeVerificationError = (error: unknown): ApplicationError => {
  const code = error instanceof ApplicationError ? error.code : 'CONNECTION_UNAVAILABLE';
  const messages: Record<string, string> = { AUTH_REQUIRED: '请核对认证凭据和当前服务身份', AUTH_FAILED: '账号认证失败，请核对当前凭据', IDENTITY_CHANGE_REQUIRES_SELECTION: '测试识别到其他身份，请新建连接并显式选用', REVISION_CONFLICT: '连接已变更，请重新载入再测试', TIMEOUT: '连接测试超时', CANCELED: '连接测试已取消', CONFIG_PLAN_STALE: '测试结果已失效，请重新测试' };
  // A server, transport or verifier error can echo authentication bytes. Return controlled text only.
  return new ApplicationError(code, messages[code] ?? '连接测试失败，请核对服务、账号和权限');
};

/** One current connection per identity, revisioned encrypted secrets, no credential cache. */
export class ApplicationConnectionService {
  private readonly tests = new Map<string, AbortController>();
  constructor(readonly store: ResourceStore, private readonly secrets: SecretsStore, private readonly verifier: ConnectionVerifier, private readonly timeoutMs = 10000) {}
  private row(id: string): ConnectionRow {
    const row = this.store.sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(id) as ConnectionRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND', '连接不存在'); return row;
  }
  get(id: string): ApplicationConnection {
    const r = this.row(id);
    return { id: r.id, appId: r.app_id, providerId: r.provider_id, name: r.name, config: connectionConfigSchema.parse(JSON.parse(r.config_json)),
      revision: r.revision, configRevision: r.config_revision, identityRevision: r.identity_revision, secretRevision: r.secret_revision, policyRevision: r.policy_revision,
      identity: verifiedConnectionIdentitySchema.parse(JSON.parse(r.verified_identity_json)), enabled: r.enabled === 1, authorization: r.auth_state,
      health: r.health, healthCode: r.health_code, healthMessage: r.health_message, testedAt: r.tested_at,
      hasSecret: !!r.secret_ref && this.secrets.has(r.secret_ref), cleanupPending: r.cleanup_pending === 1, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  list(): ApplicationConnection[] {
    return (this.store.sqlite.prepare('SELECT id FROM application_connections ORDER BY created_at,id').all() as { id: string }[]).map(r => this.get(r.id));
  }
  private candidate(id: string): CandidateRow {
    const row = this.store.sqlite.prepare('SELECT * FROM application_secret_changes WHERE operation_id=?').get(id) as CandidateRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND', '测试结果不存在'); return row;
  }
  private checkRevision(id: string | undefined, expected: number): ConnectionRow | null {
    const old = id ? this.row(id) : null;
    if ((old?.revision ?? 0) !== expected || (!old && expected !== 0)) throw new ApplicationError('REVISION_CONFLICT', '连接已变更，请重新载入再测试');
    return old;
  }
  planConfigChange(id: string | undefined, expectedRevision: number, input: unknown): ConnectionChangePlan {
    const config = connectionConfigSchema.parse(input); this.checkRevision(id, expectedRevision);
    const appId = providerApplication(config.kind), records: { taskId: string | null; hash: string; version: string; manifest: string; snapshotHash?: string }[] = [];
    const active = this.store.sqlite.prepare(`SELECT p.package_hash AS hash,p.version,p.manifest_json AS manifest FROM capability_active_packages a JOIN capability_packages p ON p.package_hash=a.package_hash WHERE a.app_id=?`).get(appId) as { hash: string; version: string; manifest: string } | undefined;
    if (active) records.push({ ...active, taskId: null });
    if (id) {
      const refs = this.store.sqlite.prepare(`SELECT r.task_id AS taskId,p.package_hash AS hash,p.version,p.manifest_json AS manifest,s.snapshot_hash AS snapshotHash,s.snapshot_json AS snapshot FROM capability_session_refs r JOIN capability_packages p ON p.resource_id=r.ref_id JOIN capability_session_snapshots s ON s.task_id=r.task_id WHERE p.app_id=? ORDER BY r.task_id,p.package_hash`).all(appId) as { taskId: string; hash: string; version: string; manifest: string; snapshotHash: string; snapshot: string }[];
      for (const ref of refs) {
        let related = false;
        try {
          const snapshot = JSON.parse(ref.snapshot) as { projectId?: string; packages?: { bindings?: { connectionId: string }[] }[] };
          related = !!snapshot.packages?.some(p => p.bindings?.some(b => b.connectionId === id));
          if (snapshot.projectId) related ||= !!this.store.sqlite.prepare('SELECT 1 FROM application_project_bindings WHERE project_id=? AND connection_id=?').get(snapshot.projectId, id);
          if (!snapshot.projectId && !snapshot.packages) related = true; // Unknown historical scope is conservative.
        } catch { related = true; }
        if (related) records.push(ref);
      }
    }
    const impacts: ConnectionCompatibilityImpact[] = [];
    for (const record of records) {
      let status: 'incompatible' | 'unverified' | null = null, reason = '';
      try {
        const manifest = parseManifest(JSON.parse(record.manifest)), contract = manifest.connectionContracts.find(c => c.providerId === config.kind);
        const authMode = config.kind === 'foxmail' ? 'local-readonly' : config.authMode;
        if (!contract || contract.configApiMajor !== 1 || contract.identityContractMajor !== 1) { status = 'unverified'; reason = '缺少已支持的连接配置转换契约'; }
        else if (!contract.authModes.includes(authMode)) { status = 'incompatible'; reason = '此版本不支持候选认证方式'; }
      } catch { status = 'unverified'; reason = '历史包契约无法核验'; }
      if (status) impacts.push({ packageHash: record.hash, version: record.version, taskId: record.taskId, status, reason });
    }
    const plan = { connectionId: id ?? null, expectedRevision, configHash: digest(canonicalJson(config)), referenceHash: digest(canonicalJson(records.map(r => ({ taskId: r.taskId, hash: r.hash, snapshotHash: r.snapshotHash ?? null })))), impacts };
    return { ...plan, planHash: digest(canonicalJson(plan)) };
  }
  private async verify(config: ConnectionConfig, secret: string | null, controller: AbortController): Promise<VerifiedConnectionIdentity> {
    if(controller.signal.aborted)throw safeVerificationError(controller.signal.reason instanceof ApplicationError?controller.signal.reason:new ApplicationError('CANCELED','连接测试已取消'));
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason instanceof ApplicationError ? controller.signal.reason : new ApplicationError('CANCELED', '连接测试已取消'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(new ApplicationError('TIMEOUT', '连接测试超时')), this.timeoutMs);
        if (controller.signal.aborted) onAbort();
      });
      const result = await Promise.race([this.verifier.verify(config, secret, controller.signal), aborted]);
      const identity = verifiedConnectionIdentitySchema.safeParse(result);
      if (!identity.success || identity.data.providerId !== config.kind) throw new ApplicationError('AUTH_REQUIRED', '无法核实当前服务和账号身份');
      return identity.data;
    } catch (error) { throw safeVerificationError(error); }
    finally { if (timer) clearTimeout(timer); if (onAbort) controller.signal.removeEventListener('abort', onAbort); }
  }
  async testCandidate(input: SaveApplicationConnection, signal?: AbortSignal): Promise<VerifiedConnectionCandidate> {
    if(signal?.aborted)throw new ApplicationError('CANCELED','连接测试已取消');
    const parsed = saveConnectionSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError('INVALID_INPUT', '连接字段无效，请核对表单');
    const request = parsed.data, old = this.checkRevision(request.id, request.expectedRevision);
    if (request.config.kind === 'foxmail' && !isAbsolute(request.config.sourcePath)) throw new ApplicationError('INVALID_INPUT', '请选择本机Foxmail的完整来源路径');
    if (old && old.provider_id !== request.config.kind) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '已有连接不能替换应用类型，请新建连接');
    if (old && request.config.kind === 'foxmail' && (JSON.parse(old.config_json) as ConnectionConfig & { sourcePath?: string }).sourcePath !== request.config.sourcePath) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '已有来源路径不能覆盖，请新建来源并显式选用');
    if (request.config.kind === 'foxmail' && request.secret) throw new ApplicationError('INVALID_INPUT', '本地只读来源不保存发件凭据');
    const id = old?.id ?? randomUUID(), operationId = randomUUID(), secretRef = request.secret ? 'application:' + id + ':secret:' + operationId : old?.secret_ref ?? null;
    const candidate: CandidateConfig = { id, name: request.name, config: request.config, expectedRevision: request.expectedRevision };
    const candidateHash = digest(canonicalJson({ ...candidate, secretRef, operationId })), expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      if(signal?.aborted)throw new ApplicationError('CANCELED','连接测试已取消');
      this.checkRevision(request.id, request.expectedRevision);
      if (request.secret) this.secrets.set(secretRef!, request.secret);
      this.store.sqlite.prepare(`INSERT INTO application_secret_changes(operation_id,connection_id,expected_revision,old_secret_ref,new_secret_ref,candidate_hash,candidate_json,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'preparing',?,?)`).run(operationId, id, request.expectedRevision, old?.secret_ref ?? null, secretRef, candidateHash, canonicalJson(candidate), expiresAt, new Date().toISOString(), new Date().toISOString());
    }).immediate());
    const controller = new AbortController(),cancel=()=>controller.abort(new ApplicationError('CANCELED','连接测试已取消'));this.tests.set(operationId,controller);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    try {
      const secret = secretRef ? this.secrets.get(secretRef) : null;
      if (request.config.kind !== 'foxmail' && !secret) throw new ApplicationError('AUTH_REQUIRED', '请配置本连接的认证凭据');
      const identity = await this.verify(request.config, secret, controller);
      if (old && digest(canonicalJson(identity)) !== old.identity_hash) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '测试识别到其他服务或账号，请新建连接并显式选用');
      let compatibility!: ConnectionChangePlan;
      await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        if(controller.signal.aborted)throw controller.signal.reason instanceof ApplicationError?controller.signal.reason:new ApplicationError('CANCELED','连接测试已取消');
        this.checkRevision(request.id, request.expectedRevision);
        if (this.candidate(operationId).state !== 'preparing') throw new ApplicationError('CANCELED', '该次连接测试已失效');
        compatibility = this.planConfigChange(request.id, request.expectedRevision, request.config);
        this.store.sqlite.prepare("UPDATE application_secret_changes SET state='validated',verified_identity_json=?,compatibility_plan_json=?,updated_at=? WHERE operation_id=?").run(canonicalJson(identity), canonicalJson(compatibility), new Date().toISOString(), operationId);
      }).immediate());
      return { operationId, connectionId: id, candidateHash, expectedRevision: request.expectedRevision, identity, compatibility, expiresAt };
    } catch (error) { await this.discardCandidate(operationId, error instanceof ApplicationError ? error.code : 'CONNECTION_UNAVAILABLE'); throw safeVerificationError(error); }
    finally { signal?.removeEventListener('abort',cancel);this.tests.delete(operationId); }
  }
  async commitCandidate(operationId: string, candidateHash: string, acceptedImpactHash?: string): Promise<ApplicationConnection> {
    let committed!: CandidateRow;
    try {
      await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        const change = this.candidate(operationId);
        if (change.candidate_hash !== candidateHash || change.state !== 'validated' || change.expires_at <= new Date().toISOString()) throw new ApplicationError('CONFIG_PLAN_STALE', '测试结果已过期或表单已变化，请重新测试');
        const value = JSON.parse(change.candidate_json) as CandidateConfig;
        const old = this.checkRevision(value.expectedRevision ? value.id : undefined, value.expectedRevision);
        const originalPlan = JSON.parse(change.compatibility_plan_json!) as ConnectionChangePlan;
        const currentPlan = this.planConfigChange(old?.id, value.expectedRevision, value.config);
        if (currentPlan.planHash !== originalPlan.planHash) throw new ApplicationError('CONFIG_PLAN_STALE', '连接或历史引用已变化，请重新检查影响');
        if (currentPlan.impacts.length && acceptedImpactHash !== currentPlan.planHash) throw new ApplicationError(currentPlan.impacts.some(i => i.status === 'unverified') ? 'CONFIG_COMPATIBILITY_UNVERIFIED' : 'CONFIG_INCOMPATIBLE', '此配置影响历史会话，请查看具体版本影响后明确保存');
        const identity = verifiedConnectionIdentitySchema.parse(JSON.parse(change.verified_identity_json!));
        if (old && digest(canonicalJson(identity)) !== old.identity_hash) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '连接身份已变化，请显式选择新连接');
        const now = new Date().toISOString(), changedSecret = change.new_secret_ref !== change.old_secret_ref;
        const args = { id: value.id, appId: providerApplication(value.config.kind), provider: value.config.kind, name: value.name, config: canonicalJson(value.config), revision: (old?.revision ?? 0) + 1,
          configRevision: old ? old.config_revision + (old.config_json !== canonicalJson(value.config) ? 1 : 0) : 1, identityRevision: old?.identity_revision ?? 1, identity: canonicalJson(identity), identityHash: digest(canonicalJson(identity)), secretRef: change.new_secret_ref,
          secretRevision: (old?.secret_revision ?? 0) + (changedSecret ? 1 : 0), policyRevision: (old?.policy_revision ?? 0) + (!old || old.auth_state === 'disconnected' ? 1 : 0), enabled: old?.enabled ?? 1, createdAt: old?.created_at ?? now, now };
        if (old) this.store.sqlite.prepare(`UPDATE application_connections SET name=@name,config_json=@config,revision=@revision,config_revision=@configRevision,verified_identity_json=@identity,identity_hash=@identityHash,secret_ref=@secretRef,secret_revision=@secretRevision,policy_revision=@policyRevision,auth_state='connected',health='healthy',health_code='OK',health_message='连接已核验',tested_at=@now,updated_at=@now WHERE id=@id`).run(args);
        else this.store.sqlite.prepare(`INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,health_code,health_message,tested_at,created_at,updated_at) VALUES(@id,@appId,@provider,@name,@config,@revision,@configRevision,@identityRevision,@identity,@identityHash,@secretRef,@secretRevision,@policyRevision,@enabled,'connected','healthy','OK','连接已核验',@now,@createdAt,@now)`).run(args);
        this.store.sqlite.prepare("UPDATE application_secret_changes SET state='committed',updated_at=? WHERE operation_id=?").run(now, operationId);
        committed = change;
      }).immediate());
    } catch (error) {
      if (!(error instanceof ApplicationError) || !['CONFIG_INCOMPATIBLE', 'CONFIG_COMPATIBILITY_UNVERIFIED'].includes(error.code)) await this.discardCandidate(operationId, error instanceof ApplicationError ? error.code : 'CONNECTION_UNAVAILABLE');
      throw error;
    }
    this.cleanupObsoleteSecret(committed);
    return this.get(committed.connection_id);
  }
  async save(input: SaveApplicationConnection): Promise<ApplicationConnection> {
    const candidate = await this.testCandidate(input);
    return this.commitCandidate(candidate.operationId, candidate.candidateHash, input.acceptedImpactHash);
  }
  private cleanupObsoleteSecret(change: CandidateRow): void {
    const old = change.old_secret_ref;
    try {
      if (old && old !== change.new_secret_ref && !this.store.sqlite.prepare('SELECT 1 FROM application_connections WHERE secret_ref=?').get(old)) this.secrets.delete(old);
      this.store.sqlite.prepare("UPDATE application_secret_changes SET state='cleaned',updated_at=? WHERE operation_id=? AND state IN ('committed','cleanup-pending')").run(new Date().toISOString(), change.operation_id);
      const pending = this.store.sqlite.prepare("SELECT 1 FROM application_secret_changes WHERE connection_id=? AND state='cleanup-pending'").get(change.connection_id);
      this.store.sqlite.prepare('UPDATE application_connections SET cleanup_pending=? WHERE id=?').run(pending ? 1 : 0, change.connection_id);
    } catch {
      this.store.sqlite.prepare("UPDATE application_secret_changes SET state='cleanup-pending',updated_at=? WHERE operation_id=?").run(new Date().toISOString(), change.operation_id);
      this.store.sqlite.prepare('UPDATE application_connections SET cleanup_pending=1 WHERE id=?').run(change.connection_id);
    }
  }
  async discardCandidate(operationId: string, code = 'CANCELED'): Promise<void> {
    this.tests.get(operationId)?.abort(new ApplicationError('CANCELED', '连接测试已取消'));
    let discarded: CandidateRow | null = null;
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const change = this.candidate(operationId);
      if (['committed', 'cleanup-pending', 'cleaned'].includes(change.state)) return;
      this.store.sqlite.prepare("UPDATE application_secret_changes SET state='failed',error_code=?,updated_at=? WHERE operation_id=?").run(code, new Date().toISOString(), operationId);
      discarded = change;
    }).immediate());
    if (discarded) {
      const change = discarded as CandidateRow;
      try {
        if (change.new_secret_ref && change.new_secret_ref !== change.old_secret_ref && !this.store.sqlite.prepare('SELECT 1 FROM application_connections WHERE secret_ref=?').get(change.new_secret_ref)) this.secrets.delete(change.new_secret_ref);
      } catch { this.store.sqlite.prepare("UPDATE application_secret_changes SET error_code='SECRET_CLEANUP_PENDING' WHERE operation_id=?").run(operationId); }
    }
  }
  async setEnabled(id: string, enabled: boolean, expectedRevision: number): Promise<ApplicationConnection> {
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      this.checkRevision(id, expectedRevision);
      this.store.sqlite.prepare("UPDATE application_connections SET enabled=?,revision=revision+1,policy_revision=policy_revision+1,health='unverified',health_code=NULL,health_message=NULL,updated_at=? WHERE id=?").run(enabled ? 1 : 0, new Date().toISOString(), id);
    }).immediate()); return this.get(id);
  }
  async disconnect(id: string, expectedRevision: number): Promise<ApplicationConnection> {
    const operationId = randomUUID();
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const old = this.checkRevision(id, expectedRevision)!, now = new Date().toISOString();
      this.store.sqlite.prepare("UPDATE application_connections SET auth_state='disconnected',revision=revision+1,policy_revision=policy_revision+1,secret_ref=NULL,secret_revision=secret_revision+?,health='unverified',health_code='AUTH_REQUIRED',health_message='连接已断开',cleanup_pending=?,updated_at=? WHERE id=?").run(old.secret_ref ? 1 : 0, old.secret_ref ? 1 : 0, now, id);
      this.store.sqlite.prepare(`INSERT INTO application_secret_changes(operation_id,connection_id,expected_revision,old_secret_ref,new_secret_ref,candidate_hash,candidate_json,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?,?,'committed',?,?)`).run(operationId, id, expectedRevision, old.secret_ref, digest(canonicalJson({ action: 'disconnect', id, expectedRevision })), canonicalJson({ action: 'disconnect', id }), now, now, now);
    }).immediate());
    // The old secret reference remains in a persistent cleanup journal after revocation commits.
    this.cleanupObsoleteSecret(this.candidate(operationId));
    return this.get(id);
  }
  async recoverSecretChanges(): Promise<void> {
    const rows = this.store.sqlite.prepare("SELECT * FROM application_secret_changes WHERE state IN ('committed','cleanup-pending') OR (state='failed' AND error_code='SECRET_CLEANUP_PENDING') OR (state IN ('preparing','validated') AND expires_at<=?)").all(new Date().toISOString()) as CandidateRow[];
    for (const row of rows) {
      if (row.state === 'committed' || row.state === 'cleanup-pending') this.cleanupObsoleteSecret(row);
      else await this.discardCandidate(row.operation_id, 'CANCELED');
    }
  }
  /** Internal authentication boundary. Never exported by the renderer controller or MCP. */
  async reportHealth(id:string,expected:Pick<ApplicationConnection,'identityRevision'|'configRevision'|'secretRevision'|'policyRevision'>,code:ApplicationError['code']|null):Promise<boolean>{
    return withResourceLock(this.store.root,()=>{
      const current=this.row(id);if(current.identity_revision!==expected.identityRevision||current.config_revision!==expected.configRevision||current.secret_revision!==expected.secretRevision||current.policy_revision!==expected.policyRevision||!current.enabled||current.auth_state!=='connected')return false;
      const message=code?safeVerificationError(new ApplicationError(code,'')).message:null;
      if(current.health===(code?'unavailable':'healthy')&&current.health_code===code&&current.health_message===message)return false;
      this.store.sqlite.prepare('UPDATE application_connections SET health=?,health_code=?,health_message=?,updated_at=? WHERE id=?').run(code?'unavailable':'healthy',code,message,new Date().toISOString(),id);return true;
    });
  }
  authentication(id: string, expected: { identityRevision: number; configRevision: number; secretRevision: number; policyRevision: number }): { config: ConnectionConfig; secret: string | null } {
    const row = this.row(id);
    if (!row.enabled || row.auth_state !== 'connected') throw new ApplicationError('AUTH_REQUIRED', '此连接当前未获授权');
    if (row.identity_revision !== expected.identityRevision || row.config_revision !== expected.configRevision || row.secret_revision !== expected.secretRevision || row.policy_revision !== expected.policyRevision) throw new ApplicationError('REVISION_CONFLICT', '连接修订已变化，请重新核验本次操作');
    const config = connectionConfigSchema.parse(JSON.parse(row.config_json)), secret = row.secret_ref ? this.secrets.get(row.secret_ref) : null;
    if (config.kind !== 'foxmail' && !secret) throw new ApplicationError('AUTH_REQUIRED', '此连接缺少当前认证凭据');
    return { config, secret };
  }
}
