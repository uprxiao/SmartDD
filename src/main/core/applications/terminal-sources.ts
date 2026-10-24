import {ApplicationError} from '@shared/applications';
import {applicationReferenceText,terminalSourceApp,type ApplicationTerminalBind} from '@shared/application-terminal';
import type {ApplicationUiSender} from './execution-context';
import type {ApplicationService} from './application-service';
import type {CapabilityRunRegistry} from './run-registry';
import {canonicalJson} from './manifest';
import type {ApplicationTerminalProof} from './terminal-insertion';
/** Source identities come from the host's local data, never arbitrary renderer text. */
export async function resolveApplicationTerminalSource(service:ApplicationService,runs:CapabilityRunRegistry|undefined,sender:ApplicationUiSender,input:ApplicationTerminalBind):Promise<ApplicationTerminalProof>{
 const {target,projectId,source}=input,appId=terminalSourceApp(source),store=service.store;
 const current=()=>{const task=store.sqlite.prepare('SELECT project_id,archived_at FROM tasks WHERE id=?').get(target.taskId) as {project_id:string|null;archived_at:number|null}|undefined,context=runs?.inputContext(target.taskId,target.ptyId);if(!task||task.archived_at!==null||task.project_id!==projectId||context?.run.projectId!==projectId)throw new ApplicationError('SCOPE_DENIED','引用与当前运行任务不属于同一项目');service.selections.requireEnabled(projectId,appId);return context;};
 const initial=current(),pack=initial.snapshot.packages.find(p=>p.appId===appId);if(!pack)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原会话没有选用此应用；可使用当前版本新建会话');
 const runId=initial.run.runId,policy=canonicalJson(service.selections.policyStamp(projectId,appId));let assertSource=()=>{};
 const assert=()=>{const run=current();if(run.run.runId!==runId||run.snapshot.packages.find(p=>p.appId===appId)?.packageHash!==pack.packageHash||canonicalJson(service.selections.policyStamp(projectId,appId))!==policy)throw new ApplicationError('RESOURCE_STATE_CHANGED','原任务运行或应用选用已变化');assertSource();};
 const inspect=async()=>{assert();const value=await service.sessionDiagnostics.inspect(target.taskId);assert();const app=value.applications.find(a=>a.appId===appId);if(value.currentRun?.id!==runId||value.currentRun.preparation?.state!=='prepared'||app?.resourceState!=='verified')throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前会话应用尚未核实可用，引用未插入');};
 if(source.kind==='skill'){if(!pack.skills.some(s=>s.skillId===source.skillId))throw new ApplicationError('SCOPE_DENIED','该Skill不属于原固定应用包');}
 else if(source.kind==='draft'){
  if(!pack.allowedOperations.includes('mail.draft'))throw new ApplicationError('SCOPE_DENIED','原应用未选用草稿能力');const {draft}=await service.viewDraft(sender,projectId,source.draftId,source.revision);if(draft.contentHash!==source.contentHash)throw new ApplicationError('REVISION_CONFLICT','草稿内容与当前查看修订不符');
  assertSource=()=>{const row=store.sqlite.prepare('SELECT d.current_revision,r.content_hash FROM mail_drafts d JOIN mail_draft_revisions r ON r.draft_id=d.id AND r.revision=? WHERE d.id=? AND d.project_id=?').get(source.revision,source.draftId,projectId) as {current_revision:number;content_hash:string}|undefined;if(row?.current_revision!==source.revision||row.content_hash!==source.contentHash)throw new ApplicationError('REVISION_CONFLICT','草稿已变化，请重新查看后插入');};
 }else{
  const slot=source.kind==='zentao'?'zentao':'foxmail',permission=source.kind==='zentao'?'zentao.read':'mail.read';if(!pack.allowedOperations.includes(permission))throw new ApplicationError('SCOPE_DENIED','原应用未选用该读取能力');
  assertSource=()=>{const selected=service.selections.connectionSlot(projectId,appId,slot),connection=service.connections.get(source.reference.connectionId);if(selected.connectionId!==connection.id||selected.identityRevision!==source.reference.identityRevision||connection.identityRevision!==source.reference.identityRevision||!connection.enabled||connection.authorization!=='connected')throw new ApplicationError('SCOPE_DENIED','原引用来源不是本项目当前选用的可用身份');service.connections.resolvePackageView(pack.packageHash,connection);if(source.kind==='zentao')service.data.zentao.assertStoredReference(projectId,source.objectKind,source.reference);};assertSource();
  if(source.kind==='mail')await service.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.reference.prepare',operations:['mail.read'],semantics:'read'},context=>service.mailReads.source(context,source.reference));
 }
 assert();await inspect();return{text:applicationReferenceText(source),runId,assert,inspect};
}
