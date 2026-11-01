import {SelectionPreconditionError} from './selection-precondition-error';
import { createHash, randomUUID } from 'node:crypto';
import { ApplicationError } from '@shared/applications';
import type { ApplicationId,ConnectionConfig } from '@shared/application-connections';
import type {HostedConfiguration,HostedSelection,HostedSelectionInput} from './host-application-registry';
import { canonicalJson } from './manifest';
import { withResourceLock } from './resource-lock';
import type { ApplicationConnectionService } from './connection-service';
import type { ResourceStore } from './resource-store';

export interface ApplicationSelectionDeps {
  requireProject(projectId: string): unknown;
  stopProjectRuns(projectId: string, appId: string): Promise<boolean>;
  runningInProject(projectId: string, appId: string): number;
  validateSelection?(projectId:string,appId:string,slots:Readonly<Record<string,string|null|undefined>>):void;
  afterSelection?(projectId:string,appId:string):void;
}
export interface ApplicationCatalogState<A extends string=ApplicationId> { appId: A; added: boolean; enabled: boolean; revision: number }

/** Explicit per-project slots; no first-healthy connection fallback or automatic selection. */
export class ApplicationSelectionService<C extends HostedConfiguration=ConnectionConfig,A extends string=ApplicationId> {
  constructor(readonly store: ResourceStore, private readonly connections: ApplicationConnectionService<C,A>, private readonly deps: ApplicationSelectionDeps) {}
  get registry(){return this.connections.registry;}
  catalogState(appId: A): ApplicationCatalogState<A> {
    this.registry.appId(appId);
    const row = this.store.sqlite.prepare('SELECT added,enabled,revision FROM application_catalog_state WHERE app_id=?').get(appId) as { added: number; enabled: number; revision: number } | undefined;
    return { appId, added: row?.added === 1, enabled: row?.enabled === 1, revision: row?.revision ?? 0 };
  }
  async setAdded(appId: A, added: boolean, expectedRevision: number): Promise<ApplicationCatalogState<A>> {
    this.registry.appId(appId);
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const state = this.catalogState(appId);
      if (state.revision !== expectedRevision) throw new ApplicationError('REVISION_CONFLICT', '应用状态已变化，请重新载入');
      const now = new Date().toISOString();
      this.store.sqlite.prepare(`INSERT INTO application_catalog_state(app_id,added,enabled,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET added=excluded.added,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at`).run(appId, added ? 1 : 0, added ? 1 : 0, state.revision + 1, now);
      if (state.added !== added || state.enabled !== added) this.store.sqlite.prepare('UPDATE application_binding_slot_revisions SET revision=revision+1 WHERE app_id=?').run(appId);
      if (!added) {
        this.store.sqlite.prepare("UPDATE application_binding_changes SET state='cancelled',error_code='SCOPE_DENIED',updated_at=? WHERE app_id=? AND state='stopping'").run(now, appId);
        this.store.sqlite.prepare('UPDATE application_project_settings SET policy_revision=policy_revision+CASE WHEN enabled<>0 THEN 1 ELSE 0 END,enabled=0,binding_revision=binding_revision+1,pending_operation_id=NULL,updated_at=? WHERE app_id=?').run(now, appId);
      }
    }).immediate()); return this.catalogState(appId);
  }
  async setGlobalEnabled(appId: A, enabled: boolean, expectedRevision: number): Promise<ApplicationCatalogState<A>> {
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const state = this.catalogState(appId);
      if (!state.added) throw new ApplicationError('SCOPE_DENIED', '请先添加此应用');
      if (state.revision !== expectedRevision) throw new ApplicationError('REVISION_CONFLICT', '应用状态已变化，请重新载入');
      if (state.enabled !== enabled) this.store.sqlite.prepare('UPDATE application_binding_slot_revisions SET revision=revision+1 WHERE app_id=?').run(appId);
      this.store.sqlite.prepare('UPDATE application_catalog_state SET enabled=?,revision=revision+1,updated_at=? WHERE app_id=?').run(enabled ? 1 : 0, new Date().toISOString(), appId);
    }).immediate()); return this.catalogState(appId);
  }
  private rawBindings(projectId:string,appId:A){
    return this.store.sqlite.prepare('SELECT slot,connection_id AS connectionId,identity_revision AS identityRevision FROM application_project_bindings WHERE project_id=? AND app_id=? ORDER BY slot,connection_id,identity_revision').all(projectId,appId) as {slot:C['kind'];connectionId:string;identityRevision:number}[];
  }
  /** UI diagnosis is read-only; an unconfirmed slot is never business authority. */
  projectView(projectId:string,appId:A):HostedSelection<C,A>{
    this.deps.requireProject(projectId);const application=this.registry.application(appId);
    const row=this.store.sqlite.prepare('SELECT enabled,binding_revision AS revision,policy_revision AS policyRevision,pending_operation_id AS pendingOperationId FROM application_project_settings WHERE project_id=? AND app_id=?').get(projectId,appId) as {enabled:number;revision:number;policyRevision:number;pendingOperationId:string|null}|undefined;
    const rows=this.rawBindings(projectId,appId),versions=this.store.sqlite.prepare('SELECT slot,revision FROM application_binding_slot_revisions WHERE project_id=? AND app_id=? ORDER BY slot').all(projectId,appId) as {slot:C['kind'];revision:number}[];
    const invalid=()=>new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','项目连接槽修订缺失或类别异常，不能沿用旧授权');
    if(row? !Number.isSafeInteger(row.revision)||row.revision<0||!Number.isSafeInteger(row.policyRevision)||row.policyRevision<0||![0,1].includes(row.enabled)||versions.length!==application.slots.length||new Set(versions.map(v=>v.slot)).size!==versions.length||versions.some(v=>!application.slots.includes(v.slot)||!Number.isSafeInteger(v.revision)||v.revision<0):rows.length>0||versions.length>0)throw invalid();
    if(rows.some(v=>!application.slots.includes(v.slot)))throw invalid();
    const selected:Partial<Record<C['kind'],string|null>>={},slotRevisions:Partial<Record<C['kind'],number>>={},issues:C['kind'][]=[];
    const identities=rows.map(binding=>{const c=this.connections.get(binding.connectionId);if(c.providerId!==binding.slot||c.appId!==appId)throw invalid();return {id:c.id,revision:c.revision,identityRevision:c.identityRevision};});
    for(const slot of application.slots){const bindings=rows.filter(v=>v.slot===slot);selected[slot]=null;slotRevisions[slot]=versions.find(v=>v.slot===slot)?.revision??0;
      if(bindings.length>1||bindings.some(v=>v.identityRevision!==identities.find(c=>c.id===v.connectionId)!.identityRevision)){issues.push(slot);continue;}
      selected[slot]=bindings[0]?.connectionId??null;
    }
    const view:HostedSelection<C,A>={projectId,appId,enabled:row?.enabled===1,revision:row?.revision??0,pendingOperationId:row?.pendingOperationId??null,connections:selected,slotRevisions};
    if(issues.length)view.repair={slots:issues,fingerprint:createHash('sha256').update(canonicalJson({projectId,appId,enabled:row!.enabled,revision:row!.revision,policyRevision:row!.policyRevision,catalog:this.catalogState(appId),rows,versions,identities})).digest('hex')};
    return view;
  }
  projectSettings(projectId:string,appId:A):HostedSelection<C,A>{
    const view=this.projectView(projectId,appId);if(view.repair)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','存在异常多选或来源身份不一致，请明确重新选择');return view;
  }
  private selectionForInput(value:HostedSelectionInput<C,A>,initial=false):HostedSelection<C,A>{
    if(!value.repair)return this.projectSettings(value.projectId,value.appId);
    const view=this.projectView(value.projectId,value.appId);
    // The fingerprint is a CAS receipt, not permission supplied by the renderer.
    if(!view.repair||view.repair.fingerprint!==value.repair.fingerprint){if(initial)throw new SelectionPreconditionError('REVISION_CONFLICT','异常选择已变化，请重新载入后明确选择');throw new ApplicationError('REVISION_CONFLICT','异常选择已变化，请重新载入后明确选择');}
    if(value.enabled!==view.enabled||this.registry.application(value.appId).slots.some(slot=>slot!==value.repair!.slot&&value.connections[slot]!==view.connections[slot]))throw new ApplicationError('INVALID_INPUT','每次恢复只允许明确修改一个连接槽，其他选择和启用状态必须保留');
    return view;
  }
  private validateSelection(value: HostedSelectionInput<C,A>): void {
    if (!this.catalogState(value.appId).added) throw new ApplicationError('SCOPE_DENIED', '请先在应用目录添加此应用');
    for (const slot of this.registry.application(value.appId).slots) {const id=value.connections[slot];
      if (!id) continue;
      const connection = this.connections.get(id);
      if (connection.providerId !== slot || this.registry.providerApplication(connection.providerId) !== value.appId) throw new ApplicationError('SCOPE_DENIED', '所选连接不属于此应用或来源类别');
    }
    if(value.enabled)this.deps.validateSelection?.(value.projectId,value.appId,value.connections);
  }
  async select(input: HostedSelectionInput<C,A>): Promise<HostedSelection<C,A>> {
    const value = this.registry.parseSelection(input); this.deps.requireProject(value.projectId);
    const operationId = randomUUID(); let needsStop = false;
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      this.validateSelection(value);
      const previous = this.selectionForInput(value,true);
      if (previous.revision !== value.expectedRevision) throw new SelectionPreconditionError('REVISION_CONFLICT', '项目选用已变化，请重新载入');
      if (previous.pendingOperationId) throw new SelectionPreconditionError('RESOURCE_BUSY', '此项目的应用选择正在变更');
      const application=this.registry.application(value.appId);needsStop=application.stopBeforeSwitch&&(!!value.repair||application.slots.some(slot=>!!previous.connections[slot]&&previous.connections[slot]!==value.connections[slot]));
      const now = new Date().toISOString();
      this.store.sqlite.prepare(`INSERT INTO application_binding_changes(operation_id,project_id,app_id,from_revision,previous_json,next_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)`).run(operationId, value.projectId, value.appId, previous.revision, canonicalJson(value.repair?{...previous,rawBindings:this.rawBindings(value.projectId,value.appId)}:previous), canonicalJson(value), needsStop ? 'stopping' : 'prepared', now, now);
      if (needsStop) this.store.sqlite.prepare('UPDATE application_project_settings SET pending_operation_id=?,updated_at=? WHERE project_id=? AND app_id=?').run(operationId, now, value.projectId, value.appId);
      else this.commitSelection(value, operationId);
    }).immediate());
    if (!needsStop) return value.repair?this.projectView(value.projectId,value.appId):this.projectSettings(value.projectId,value.appId);
    let stopConfirmed = false;
    try {
      const stopped = await this.deps.stopProjectRuns(value.projectId, value.appId);
      if (!stopped || this.deps.runningInProject(value.projectId, value.appId) !== 0) throw new ApplicationError('RUN_STOP_FAILED', '相关终端尚未确认结束，已保留原连接选择');
      stopConfirmed = true;
      await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        this.validateSelection(value);
        const current = this.selectionForInput(value);
        if (current.revision !== value.expectedRevision || current.pendingOperationId !== operationId) throw new ApplicationError('REVISION_CONFLICT', '等待停止期间项目选择已变化');
        if (this.deps.runningInProject(value.projectId, value.appId) !== 0) throw new ApplicationError('RUN_STOP_FAILED', '项目又有终端运行，已保留原选择');
        this.commitSelection(value, operationId);
      }).immediate());
      return value.repair?this.projectView(value.projectId,value.appId):this.projectSettings(value.projectId,value.appId);
    } catch (error) {
      await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        this.store.sqlite.prepare('UPDATE application_project_settings SET pending_operation_id=NULL WHERE project_id=? AND app_id=? AND pending_operation_id=?').run(value.projectId, value.appId, operationId);
        this.store.sqlite.prepare("UPDATE application_binding_changes SET state='failed',error_code=?,updated_at=? WHERE operation_id=? AND state='stopping'").run(error instanceof ApplicationError ? error.code : stopConfirmed ? 'CAPABILITY_UNAVAILABLE' : 'RUN_STOP_FAILED', new Date().toISOString(), operationId);
      }).immediate()); throw error;
    }
  }
  private commitSelection(value: HostedSelectionInput<C,A>, operationId: string): void {
    const now = new Date().toISOString(), revision = value.expectedRevision + 1, previous = this.selectionForInput(value);
    const policy = this.store.sqlite.prepare('SELECT policy_revision AS revision FROM application_project_settings WHERE project_id=? AND app_id=?').get(value.projectId,value.appId) as {revision:number}|undefined;
    const policyRevision=(policy?.revision??0)+(previous.enabled!==value.enabled?1:0);
    this.store.sqlite.prepare(`INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,policy_revision,pending_operation_id,updated_at) VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(project_id,app_id) DO UPDATE SET enabled=excluded.enabled,binding_revision=excluded.binding_revision,policy_revision=excluded.policy_revision,pending_operation_id=NULL,updated_at=excluded.updated_at`).run(value.projectId, value.appId, value.enabled ? 1 : 0, revision, policyRevision, now);
    for (const slot of this.registry.application(value.appId).slots) {const id=value.connections[slot];
      if(value.repair&&slot!==value.repair.slot)continue;
      const changed = !!value.repair || previous.enabled !== value.enabled || previous.connections[slot] !== id;
      const next = (previous.slotRevisions[slot] ?? 0) + (changed ? 1 : 0);
      this.store.sqlite.prepare('INSERT INTO application_binding_slot_revisions(project_id,app_id,slot,revision) VALUES(?,?,?,?) ON CONFLICT(project_id,app_id,slot) DO UPDATE SET revision=excluded.revision').run(value.projectId,value.appId,slot,next);
    }
    if(value.repair)this.store.sqlite.prepare('DELETE FROM application_project_bindings WHERE project_id=? AND app_id=? AND slot=?').run(value.projectId,value.appId,value.repair.slot);else this.store.sqlite.prepare('DELETE FROM application_project_bindings WHERE project_id=? AND app_id=?').run(value.projectId, value.appId);
    for (const slot of this.registry.application(value.appId).slots) {const id=value.connections[slot];
      if(value.repair&&slot!==value.repair.slot)continue;
      if (!id) continue;
      const connection = this.connections.get(id);
      this.store.sqlite.prepare('INSERT INTO application_project_bindings(project_id,app_id,slot,connection_id,identity_revision) VALUES(?,?,?,?,?)').run(value.projectId, value.appId, slot, id, connection.identityRevision);
    }
    this.store.sqlite.prepare("UPDATE application_binding_changes SET state='committed',to_revision=?,updated_at=? WHERE operation_id=?").run(revision, now, operationId);
    if(value.enabled)this.deps.afterSelection?.(value.projectId,value.appId);
  }
  /** Local draft operations depend only on application policy, not unrelated external slots. */
  requireApplicationEnabled(projectId: string,appId: A): void {
    this.deps.requireProject(projectId); const catalog = this.catalogState(appId);
    const row = this.store.sqlite.prepare('SELECT enabled,pending_operation_id FROM application_project_settings WHERE project_id=? AND app_id=?').get(projectId,appId) as { enabled: number;pending_operation_id: string | null } | undefined;
    if (!catalog.added || !catalog.enabled || row?.enabled !== 1) throw new ApplicationError('SCOPE_DENIED','当前项目未启用此应用');
    if (this.registry.application(appId).stopBeforeSwitch && row.pending_operation_id) throw new ApplicationError('RESOURCE_BUSY','应用选择变更中，请稍后重试');
  }
  /** Local business operations depend on enablement, not unrelated source/SMTP slot edits. */
  policyStamp(projectId: string,appId: A): {globalRevision:number;projectPolicyRevision:number} {
    this.requireApplicationEnabled(projectId,appId);
    const row=this.store.sqlite.prepare('SELECT policy_revision FROM application_project_settings WHERE project_id=? AND app_id=?').get(projectId,appId) as {policy_revision:number};
    return {globalRevision:this.catalogState(appId).revision,projectPolicyRevision:row.policy_revision};
  }
  connectionSlot(projectId: string,appId: A,slot: C['kind']): { connectionId: string | null;identityRevision: number | null;revision: number } {
    this.requireApplicationEnabled(projectId,appId);
    if (this.registry.providerApplication(slot) !== appId) throw new ApplicationError('SCOPE_DENIED','连接槽不属于本应用');
    const version = this.store.sqlite.prepare('SELECT revision FROM application_binding_slot_revisions WHERE project_id=? AND app_id=? AND slot=?').get(projectId,appId,slot) as { revision: number } | undefined;
    if (!version) throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','此连接槽的修订缺失，不能沿用旧授权');
    const row = this.store.sqlite.prepare('SELECT connection_id,identity_revision FROM application_project_bindings WHERE project_id=? AND app_id=? AND slot=?').get(projectId,appId,slot) as { connection_id: string;identity_revision: number } | undefined;
    if (!row) return { connectionId: null,identityRevision: null,revision: version.revision };
    const c = this.connections.get(row.connection_id);
    if (c.appId !== appId || c.providerId !== slot || c.identityRevision !== row.identity_revision) throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','此连接槽的来源身份不一致，请明确重新选择');
    return { connectionId: c.id,identityRevision: c.identityRevision,revision: version.revision };
  }
  /** Main-process caller checks this before creating or delivering a business operation. */
  requireEnabled(projectId: string, appId: A): HostedSelection<C,A> {
    const catalog = this.catalogState(appId), selection = this.projectSettings(projectId, appId);
    if (!catalog.added || !catalog.enabled || !selection.enabled) throw new ApplicationError('SCOPE_DENIED', '当前项目未启用此应用');
    if (selection.pendingOperationId) throw new ApplicationError('RESOURCE_BUSY', '应用选择变更中，请稍后重试此能力');
    return selection;
  }
}
