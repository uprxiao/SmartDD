import type {AgentWorkspace} from '../agent/wiring';
import type {AgentSelection} from '../agent/agent-store';
import type {AgentModelOption} from '@shared/agent-model-choice';
import type {ScheduleConfig,SchedulePlan,ScheduleRun,ScheduleSave} from '@shared/schedule';
import {scheduleSaveSchema} from '@shared/schedule';
import {ScheduleStore} from './store';
import {ScheduleWorkspaces} from './workspace';
import {effectiveZone,assessDeadline} from '@shared/schedule-engine.mjs';
import {realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {occurrenceStopReason} from './stop-reason';
export type ScheduleNotice={key:string;planId:string;runId:string|null;taskId:string|null;turnId:string|null;requestId:string|null;status:string;title:string;createdAt:number;deliveredAt:number|null};
export class ScheduleService{
  readonly store:ScheduleStore;readonly workspaces:ScheduleWorkspaces;
  private active=false;private frozen=false;private timer?:ReturnType<typeof setTimeout>;private zone='';private pending=new Map<string,Promise<void>>();private unobserve?:()=>void;private reconcileQueued=false;private readonly cleaningPlans=new Set<string>();
  constructor(private readonly options:{agent:AgentWorkspace;home:string;userData:string;profile:(id:string)=>{available:boolean;compatibility:string;kind?:string;providerBacked?:boolean;models?:string[];modelOptions?:AgentModelOption[]};changed:()=>void;notify?:(notice:ScheduleNotice,shown:()=>void)=>void}){
    this.store=new ScheduleStore(options.agent.store.sqlite);this.workspaces=new ScheduleWorkspaces(this.store.db,options.home,options.userData);
  }
  private get agent(){return this.options.agent;}
  private changed(){this.options.changed();}
  listNotices():ScheduleNotice[]{return this.store.db.prepare("SELECT n.key,n.plan_id AS planId,n.run_id AS runId,n.task_id AS taskId,n.turn_id AS turnId,n.request_id AS requestId,n.status,n.created_at AS createdAt,n.delivered_at AS deliveredAt,COALESCE(json_extract(o.snapshot,'$.config.title'),json_extract(p.config,'$.title')) AS title FROM schedule_notification_events n JOIN schedule_plans p ON p.id=n.plan_id LEFT JOIN schedule_occurrences o ON o.id=n.run_id ORDER BY n.created_at DESC LIMIT 200").all() as ScheduleNotice[];}
  setNotifyEnabled(enabled:boolean){this.store.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('schedule-system-notify',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(String(enabled),Date.now());}
  private notice(input:Omit<ScheduleNotice,'createdAt'|'deliveredAt'|'title'>){
    const now=Date.now();const r=this.store.db.prepare('INSERT OR IGNORE INTO schedule_notification_events(key,plan_id,run_id,task_id,turn_id,request_id,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(input.key,input.planId,input.runId,input.taskId,input.turnId,input.requestId,input.status,now);
    if(!r.changes)return;
    const pref=this.store.db.prepare("SELECT value FROM app_settings WHERE key='schedule-system-notify'").get() as {value:string}|undefined;
    const plan=this.store.plan(input.planId), run=input.runId?this.store.run(input.runId):undefined;
    if(pref?.value!=='false'&&this.options.notify&&plan){
      try{this.options.notify({...input,title:run?.snapshot.config.title??plan.config.title,createdAt:now,deliveredAt:null},()=>{try{this.store.db.prepare('UPDATE schedule_notification_events SET delivered_at=COALESCE(delivered_at,?) WHERE key=?').run(Date.now(),input.key);}catch{/* Shutdown may have already closed storage. */}});}catch{/* History/requests remain authoritative. */}
    }
    this.changed();
  }
  private repair(planId:string,reason:string){
    if(this.store.markRepair(planId,reason)){const p=this.store.plan(planId)!;this.notice({key:planId+':repair:'+p.revision,planId,runId:null,taskId:null,turnId:null,requestId:null,status:'repair'});}
  }
  /** Inspect configured identities only on actual configuration changes/startup,
   * not an idle timer or repeated renderer polling. No task or model is launched. */
  auditConfigurations(taskId?:string){
    for(const p of this.store.list()){
      if(p.repair||taskId&&p.boundTask!==taskId)continue;
      const cfg=p.config;
      try{
        const profile=this.options.profile(cfg.profileId);
        if(!profile.available||profile.compatibility!==cfg.compatibility)throw new Error('智能体或供应商配置变化，需要重新确认');
        if(p.boundTask){
          const stored=this.agent.store.task(p.boundTask);
          if(stored||cfg.destination==='existing'||this.store.history(p.id).some(r=>r.taskId===p.boundTask&&r.turnId))this.assertBinding(cfg,p.boundTask);
        }else if(cfg.projectId){
          const source=this.store.db.prepare('SELECT d.path FROM project_dirs d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.id=? AND p.archived_at IS NULL').get(cfg.dirId,cfg.projectId) as {path:string}|undefined;
          if(!source||!statSync(realpathSync(source.path)).isDirectory())throw new Error('原项目工作目录已失效');
        }else if(cfg.cwd&&!statSync(realpathSync(cfg.cwd)).isDirectory())throw new Error('原工作目录已失效');
        if(!p.boundTask&&cfg.model&&profile.providerBacked&&profile.models&&!profile.models.includes(cfg.model)&&!profile.modelOptions?.some(m=>m.id===cfg.model))throw new Error('所选模型已不可用');
      }catch(error){this.repair(p.id,error instanceof Error?error.message:'计划配置不可用');}
    }
  }

  async save(raw:ScheduleSave,confirmedTier=false){
    const input=scheduleSaveSchema.parse(raw),old=input.id?this.store.plan(input.id):undefined;
    if(input.id&&this.cleaningPlans.has(input.id))throw new Error('正在清理工作区');
    if((input.config.tier==='full'&&!old||old&&old.config.tier!==input.config.tier)&&!confirmedTier)throw new Error('请确认本次权限配置');
    const retained=old?.boundTask&&((input.config.destination==='existing'&&input.config.boundTask===old.boundTask)||(input.config.destination==='reuse'&&old.config.destination==='reuse'))?old.boundTask:null;
    if(retained&&old){
      try{this.assertBinding(old.config,retained);}catch(error){this.repair(old.id,error instanceof Error?error.message:'绑定已变化');throw new Error('请先查看差异并重新确认原绑定');}
      const bound=this.assertBinding({...input.config,compatibility:old.config.compatibility},retained);
      if(input.config.workspace!==old.config.workspace||input.config.baseRef!==old.config.baseRef||input.config.dirId!==old.config.dirId||input.config.cwd!==old.config.cwd)throw new Error('已绑定任务应沿用原工作区');
      input.config.model=bound.selection.model;input.config.effort=bound.selection.effort;
    }
    if(input.config.destination!=='existing'&&!retained)await this.workspaces.validate(input.config);
    const profile=this.options.profile(input.config.profileId);if(!profile.available)throw new Error('智能体不可用');
    const chosen=input.config;
    if(chosen.tier==='auto'&&profile.kind&&profile.kind!=='codex')throw new Error('当前执行器不支持帮我批准');
    input.config.compatibility=profile.compatibility;
    if(input.config.destination==='existing'){
      const bound=this.assertBinding(input.config,input.config.boundTask!);
      input.config.cwd=bound.task.cwd;input.config.dirId=bound.task.dir_id;
      input.config.model=bound.selection.model;input.config.effort=bound.selection.effort;
    }
    if(chosen.model&&profile.models){
      let option=profile.modelOptions?.find(m=>m.id===chosen.model);let available=profile.models.includes(chosen.model)||!!option;
      const scope=chosen.boundTask?{kind:'task' as const,taskId:chosen.boundTask}:chosen.projectId&&chosen.dirId?{kind:'project' as const,projectId:chosen.projectId,dirId:chosen.dirId}:{kind:'standalone' as const};
      if(!profile.providerBacked){const catalog=await this.agent.modelCatalog(scope,chosen.profileId,'wait');const resolved=catalog.models.find(m=>m.id===chosen.model);if(resolved){available=true;option=resolved;}}
      if(!available)throw new Error('所选模型不在智能体当前可用目录');
      if(chosen.effort&&option&&!option.efforts.includes(chosen.effort))throw new Error('所选推理档位不受当前模型支持');
    }
    const result=this.store.save(input);this.changed();this.tick();return result;
  }
  async cleanupWorkspace(planId:string,revision:number,workspaceId:string){
    const p=this.store.plan(planId);if(!p||p.revision!==revision||p.enabled&&!p.archived||this.cleaningPlans.has(planId)||this.store.active().some(r=>r.planId===planId))throw new Error('请先暂停计划并等待原运行完成，再清理工作树');
    this.cleaningPlans.add(planId);try{await this.workspaces.cleanup(planId,workspaceId);this.changed();}finally{this.cleaningPlans.delete(planId);}
  }
  setEnabled(id:string,revision:number,enabled:boolean){if(this.cleaningPlans.has(id))throw new Error('正在清理工作区');const result=this.store.setEnabled(id,revision,enabled);this.changed();this.tick();return result;}
  archive(id:string,revision:number){const result=this.store.archive(id,revision);this.changed();this.tick();return result;}
  runNow(id:string,revision:number,requestId:string){if(this.cleaningPlans.has(id))throw new Error('正在清理工作区');if(!this.active||this.frozen)throw new Error('调度器暂不可用');const p=this.store.plan(id),c=this.store.claim(id,{now:Date.now(),trigger:'manual',expected:revision,requestId,hostBusy:!!p?.boundTask&&this.agent.tasks.taskBlockers(p.boundTask).length>0});if(c.kind==='claimed'){const actual=this.store.run(c.run.id);if(actual?.status==='claimed')this.dispatch(actual);}this.changed();return c;}
  start(){if(this.active)return;this.active=true;this.unobserve=this.agent.store.subscribe(event=>{this.queueReconcile();if(['selection.changed','task.archived','task.removed','delegation.enabled','delegation.disabled'].includes(event.type))queueMicrotask(()=>{if(this.active)this.auditConfigurations(event.taskId);});});for(const run of this.store.active()){
    if(run.status==='claimed'){
      if(run.trigger==='scheduled'&&assessDeadline(run.due,Date.now(),run.snapshot.grace,'resume')==='missed')this.store.finish(run.id,'skipped',Date.now(),'missed_before_dispatch');else this.dispatch(run);
    }else if(run.status==='dispatching'&&!run.turnId&&run.attempts===1){
      if(run.trigger==='scheduled'&&assessDeadline(run.due,Date.now(),run.snapshot.grace,'resume')==='missed')this.store.finish(run.id,'skipped',Date.now(),'missed_before_dispatch');else{this.store.retryUnaccepted(run.id);this.dispatch(this.store.run(run.id)!);}
    }else if(!run.turnId){this.store.setRunningState(run.id,'unknown','无法核对原受理记录');this.notify(this.store.run(run.id)!);}
  }this.reconcile();this.auditConfigurations();this.tick('resume');}
  pauseClaims(){this.frozen=true;clearTimeout(this.timer);this.timer=undefined;}
  resumeClaims(){if(!this.active)return;this.frozen=false;for(const run of this.store.active())if(run.status==='claimed')this.dispatch(run);this.tick('resume');}
  async stop(){this.active=false;this.pauseClaims();this.unobserve?.();await Promise.allSettled(this.pending.values());}
  tick(reason='tick'){
    clearTimeout(this.timer);this.timer=undefined;if(!this.active||this.frozen)return;
    try{const now=Date.now(),zone=effectiveZone();if(zone!==this.zone){this.store.reconcileZones(now);this.zone=zone;}
      for(const p of this.store.due(now)){const plan=this.store.plan(p.id)!;const c=this.store.claim(p.id,{now,expected:p.revision,reason,hostBusy:!!plan.boundTask&&this.agent.tasks.taskBlockers(plan.boundTask).length>0});if(c.kind==='claimed')this.dispatch(c.run);this.changed();}
    }catch(error){console.warn('[schedule] tick failed',error instanceof Error?error.name:'Error');}
    const next=this.store.nextDue();if(next!==null&&this.active&&!this.frozen)this.timer=setTimeout(()=>this.tick(),Math.max(1,Math.min(5000,next-Date.now())));
  }
  private dispatch(run:ScheduleRun){if(!this.active||this.frozen||run.status!=='claimed'||this.pending.has(run.id))return;
    const work=Promise.resolve().then(()=>this.prepareAndAccept(run)).catch(error=>{
      const current=this.store.run(run.id),plan=this.store.plan(run.planId);if(!current||current.turnId||!['dispatching','claimed'].includes(current.status))return;
      const text=error instanceof Error?error.message.slice(0,500):'准备失败';
      const linked=this.store.db.prepare("SELECT 1 FROM schedule_workspace_links WHERE (owner_id=? OR owner_id=?) AND status='needs_review'").get(run.id,run.planId);
      const stillValid=plan&&!plan.archived&&plan.revision===current.revision&&!plan.repair&&(current.trigger==='manual'||plan.enabled&&!plan.ended&&assessDeadline(current.due,Date.now(),current.snapshot.grace,'resume')!=='missed');
      if(!linked&&stillValid&&this.store.retryUnaccepted(run.id))return;
      if(linked)this.repair(run.planId,'工作区准备结果待核对');
      this.notify(this.store.finish(run.id,'failed',Date.now(),text));
    }).finally(()=>{this.pending.delete(run.id);this.changed();this.queueReconcile();const next=this.store.run(run.id);if(next?.status==='claimed'&&this.active&&!this.frozen)this.dispatch(next);});this.pending.set(run.id,work);
  }
  private binding(taskId:string){
    const task=this.agent.store.task(taskId);if(!task||task.archived_at||task.parent_task_id)throw new Error('绑定任务已失效');
    const selection=JSON.parse(task.selection_json) as AgentSelection;
    const profile=this.options.profile(selection.profileId);
    if(!profile.available||selection.pendingSwitch||!statSync(realpathSync(task.cwd)).isDirectory())throw new Error('绑定目录或智能体不可用');
    if(task.project_id&&!this.store.db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(task.project_id))throw new Error('原项目已失效');
    const event=this.store.db.prepare("SELECT event_type FROM agent_events WHERE task_id=? AND event_type IN ('delegation.enabled','delegation.disabled') ORDER BY seq DESC LIMIT 1").get(taskId) as {event_type:string}|undefined;
    return {task,selection,profile,delegation:event?.event_type==='delegation.enabled'};
  }
  bindingPreview(id:string,revision:number){
    const plan=this.store.plan(id);if(!plan||plan.archived||plan.revision!==revision||!plan.boundTask)throw new Error('绑定计划已变化');
    const {task,selection,profile,delegation}=this.binding(plan.boundTask);
    if(task.project_id!==plan.config.projectId||!['ask','auto','full'].includes(selection.tier))throw new Error('绑定项目或权限失效，请重新选择任务');
    const before=plan.config;
    const after:ScheduleConfig={...before,dirId:task.dir_id,cwd:task.cwd,profileId:selection.profileId,model:selection.model,effort:selection.effort,tier:selection.tier as ScheduleConfig['tier'],compatibility:profile.compatibility,delegation};
    const token=createHash('sha256').update(JSON.stringify([plan.id,plan.revision,plan.boundTask,task.selection_revision,after])).digest('hex');
    return {before,after,token};
  }
  reconfirm(id:string,revision:number,token:string){
    const {after,token:latest}=this.bindingPreview(id,revision);if(latest!==token)throw new Error('绑定配置已变化，请重新核对');
    const p=this.store.plan(id)!;if(!p.repair)throw new Error('计划没有需要确认的变化');
    const result=this.store.save({id,revision,config:after,schedule:p.schedule,grace:p.grace as 0|10|60|720,enabled:p.enabled});
    this.changed();this.tick();return result;
  }
  private assertBinding(config:ScheduleConfig,taskId:string){
    const t=this.agent.store.task(taskId);if(!t||t.archived_at||t.parent_task_id)throw new Error('绑定任务已失效');
    const selection=JSON.parse(t.selection_json) as AgentSelection;
    const current=this.options.profile(selection.profileId);
    if(!current.available||t.project_id!==config.projectId||(!config.projectId&&t.dir_id!==null))throw new Error('绑定任务或智能体已失效');
    if(t.project_id&&!this.store.db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(t.project_id))throw new Error('原绑定项目已失效或归档');
    if(selection.model&&current.providerBacked&&current.models&&!current.models.includes(selection.model)&&!current.modelOptions?.some(m=>m.id===selection.model))throw new Error('绑定任务的当前模型已失效');
    const mode=this.store.db.prepare("SELECT event_type FROM agent_events WHERE task_id=? AND event_type IN ('delegation.enabled','delegation.disabled') ORDER BY seq DESC LIMIT 1").get(taskId) as {event_type:string}|undefined;
    if(selection.profileId!==config.profileId||selection.tier!==config.tier||config.compatibility!==current.compatibility||config.delegation!==(mode?.event_type==='delegation.enabled')||config.cwd&&realpathSync(config.cwd)!==realpathSync(t.cwd)||config.destination==='existing'&&config.dirId!==t.dir_id)throw new Error('绑定配置发生变化，需要重新确认');
    if(!statSync(t.cwd).isDirectory())throw new Error('绑定目录失效');
    return{task:t,selection};
  }
  private async prepareAndAccept(claimed:ScheduleRun){
    if(!this.active||this.frozen)return;const run=this.store.begin(claimed.id,Date.now()),c=run.snapshot.config;if(!run.taskId)throw new Error('未预留任务身份');
    const p=this.store.plan(run.planId);if(!p||p.archived||p.revision!==run.revision){this.store.finish(run.id,'skipped',Date.now(),'plan_changed_before_prepare');return;}
    let profile:ReturnType<ScheduleService['options']['profile']>;
    try{profile=this.options.profile(c.profileId);}catch{this.repair(p.id,'智能体或供应商已不可用');this.notify(this.store.finish(run.id,'failed',Date.now(),'profile_unavailable'));return;}
    if(!profile.available||profile.compatibility!==c.compatibility){this.repair(p.id,'智能体配置变化，需要重新确认');this.notify(this.store.finish(run.id,'failed',Date.now(),'profile_changed'));return;}
    if(c.model&&profile.providerBacked&&profile.models&&!profile.models.includes(c.model)&&!profile.modelOptions?.some(m=>m.id===c.model)&&!p.boundTask){this.repair(p.id,'所选模型已不可用');this.notify(this.store.finish(run.id,'failed',Date.now(),'model_unavailable'));return;}
    const prior=this.agent.store.task(run.taskId);
    if(!prior&&(c.destination==='existing'||c.destination==='reuse'&&this.store.history(p.id).some(old=>old.taskId===run.taskId&&old.turnId))){this.repair(p.id,'原绑定任务已不存在');this.notify(this.store.finish(run.id,'failed',Date.now(),'bound_task_missing'));return;}
    if(prior){try{this.assertBinding(c,run.taskId);}catch(error){this.repair(p.id,error instanceof Error?error.message:'绑定任务已失效');throw error;}}
    let cwd:string;try{cwd=prior?c.workspace==='plan-worktree'?await this.workspaces.reuseBoundPlan(run,prior.cwd):prior.cwd:await this.workspaces.prepare(run);}catch(error){if(prior||c.workspace==='directory'&&(c.projectId||c.cwd))this.repair(p.id,'工作目录或原绑定工作树已失效，请修正');throw error;}
    if(!this.active||this.frozen){if(!this.store.retryUnaccepted(run.id))this.store.setRunningState(run.id,'unknown','第二次准备已中断，请核对原受理记录');return;}
    // User pause/edit/archive can race the asynchronous Git/directory work.
    // Reject that old occurrence before creating even an empty task; the
    // existing atomic accepted-input check still guards the final boundary.
    if(!this.store.beforeAccept(run.id,Date.now()))return;
    if(c.projectId&&!this.store.db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(c.projectId)){
      this.repair(p.id,'原项目已失效或归档');this.notify(this.store.finish(run.id,'failed',Date.now(),'project_unavailable'));return;
    }
    if(!prior){this.agent.tasks.create({clientTaskId:run.taskId,projectId:c.projectId,dirId:c.dirId,cwd,title:c.title,profileId:c.profileId,tier:c.tier,model:c.model,effort:c.effort});this.agent.delegations.setMode(run.taskId,c.delegation);}
    const t=this.agent.store.task(run.taskId)!;
    if((JSON.parse(t.selection_json) as AgentSelection).tier!==c.tier){this.repair(p.id,'当前执行器不支持已选择的权限档位');this.notify(this.store.finish(run.id,'failed',Date.now(),'tier_changed'));return;}
    let confirmed:ReturnType<ScheduleService['options']['profile']>;try{confirmed=this.options.profile(c.profileId);}catch{this.repair(p.id,'智能体或供应商已不可用');this.notify(this.store.finish(run.id,'failed',Date.now(),'profile_unavailable'));return;}if(!confirmed.available||confirmed.compatibility!==c.compatibility){this.repair(p.id,'智能体配置变化，需要重新确认');this.notify(this.store.finish(run.id,'failed',Date.now(),'profile_changed'));return;}
    this.agent.tasks.acceptScheduledOccurrence(this.store,run.id,t.selection_revision);
  }
  private queueReconcile(){if(!this.active||this.reconcileQueued)return;this.reconcileQueued=true;queueMicrotask(()=>{this.reconcileQueued=false;if(this.active)this.reconcile();});}
  private ownedTurns(runId:string){return this.store.db.prepare(`SELECT t.turn_id,t.task_id,t.status,t.run_id,t.accepted_at FROM scheduled_turn_origins o JOIN agent_turns t ON t.turn_id=o.turn_id WHERE o.occurrence_id=? ORDER BY t.accepted_at,t.rowid`).all(runId) as {turn_id:string;task_id:string;status:string;run_id:string|null;accepted_at:string}[];}
  /** A history/list summary must be taken from the same final parent turn as
   * the result screen. Never use the latest message from a reused task. Keep
   * the query projection small; list refreshes do not load full timelines. */
  private summary(runId:string,status:string,reason:string|null){
    if(status!=='completed')return reason;
    const row=this.store.db.prepare(`SELECT substr(json_extract(i.payload_ref,'$.text'),1,240) AS text
      FROM schedule_occurrences r JOIN agent_items i ON i.task_id=r.task_id
      WHERE r.id=? AND i.type='assistant_message' AND i.terminal_state='completed' AND i.turn_id=(
        SELECT t.turn_id FROM scheduled_turn_origins o JOIN agent_turns t ON t.turn_id=o.turn_id
        WHERE o.occurrence_id=r.id AND t.task_id=r.task_id ORDER BY t.accepted_at DESC,t.rowid DESC LIMIT 1)
      ORDER BY i.ordinal DESC LIMIT 1`).get(runId) as {text:string|null}|undefined;
    return row?.text?.replace(/\s+/g,' ').trim()||'暂无最终回复';
  }
  list(includeArchived=false){
    const latest=this.store.db.prepare(`SELECT p.id AS planId,r.id,r.status,r.reason,r.claimed_at AS claimedAt
      FROM schedule_plans p JOIN schedule_occurrences r ON r.id=(SELECT id FROM schedule_occurrences WHERE plan_id=p.id ORDER BY claimed_at DESC,rowid DESC LIMIT 1)
      ${includeArchived?'':'WHERE p.archived=0'}`).all() as {planId:string;id:string;status:string;reason:string|null;claimedAt:number}[];
    const byPlan=new Map(latest.map(r=>[r.planId,{id:r.id,status:r.status,claimedAt:r.claimedAt,summary:this.summary(r.id,r.status,r.reason)}]));
    return this.store.list(includeArchived).map(p=>({...p,recent:byPlan.get(p.id)??null}));
  }
  history(planId:string){return this.store.history(planId).map(run=>({...run,summary:this.summary(run.id,run.status,run.reason)}));}
  reconcile(){for(const run of this.store.active()){
    if(!run.turnId||!run.taskId)continue;const root=this.agent.store.turn(run.turnId);
    if(!root||root.task_id!==run.taskId||root.client_input_id!==run.inputId){if(run.status!=='unknown'){this.store.setRunningState(run.id,'unknown','原任务回合无法核对');this.notify(this.store.run(run.id)!);}continue;}
    const owned=this.ownedTurns(run.id),turnIds=new Set(owned.map(t=>t.turn_id));
    const taskIds=new Set(owned.map(t=>t.task_id));
    const pending=[...taskIds].flatMap(id=>this.agent.store.pendingRequests(id)).filter(r=>{try{return ['pending','approved_pending_bind'].includes(r.status)&&turnIds.has(r.origin?.turnId);}catch{return false;}});
    const treeOpen=!!this.store.db.prepare(`SELECT 1 FROM agent_delegations d JOIN scheduled_turn_origins o ON o.task_id=d.child_task_id WHERE o.occurrence_id=? AND d.delivery_state IN ('queued','running','queued_for_parent') LIMIT 1`).get(run.id);
    if(pending.length){
      if(run.status!=='waiting')this.store.setRunningState(run.id,'waiting');
      for(const r of pending)this.notice({key:run.id+':request:'+r.requestId,planId:run.planId,runId:run.id,taskId:owned.find(t=>t.turn_id===r.origin.turnId)?.task_id??run.taskId,turnId:r.origin.turnId??run.turnId,requestId:r.requestId,status:'waiting'});
      continue;
    }
    if(treeOpen||owned.some(t=>['accepted','dispatching','started'].includes(t.status)||this.agent.tasks.isSettlingTurn(t.task_id,t.turn_id))){if(run.status!=='running')this.store.setRunningState(run.id,'running');continue;}
    if(owned.some(t=>t.status==='unknown')){if(run.status!=='unknown'){this.store.setRunningState(run.id,'unknown','所属原回合结果未知');this.notify(this.store.run(run.id)!);}continue;}
    const finalParent=owned.filter(t=>t.task_id===run.taskId).at(-1)??root;
    const retiredOwnedRequest=run.reason==='user_stop_requested'&&!!this.store.db.prepare(`SELECT 1 FROM scheduled_turn_origins o
      JOIN agent_requests r ON r.task_id=o.task_id AND json_extract(r.origin_json,'$.turnId')=o.turn_id
      JOIN agent_events e ON e.task_id=r.task_id AND e.event_type='request.retired' AND json_extract(e.payload,'$.requestId')=r.request_id
      WHERE o.occurrence_id=? AND r.status='retired' AND json_extract(e.payload,'$.reason')=? LIMIT 1`).get(run.id,occurrenceStopReason(run.id));
    const stopped=run.reason==='user_stop_requested'&&(retiredOwnedRequest||owned.some(t=>t.status==='interrupted'||t.status==='canceled'));
    const state=stopped?'stopped':finalParent.status==='completed'?'completed':finalParent.status==='canceled'||finalParent.status==='interrupted'?'stopped':'failed';this.store.finish(run.id,state,Date.now(),state==='failed'?'原回合失败':state==='stopped'?'本次运行已停止':null);this.notify(this.store.run(run.id)!);
  }this.changed();}
  private notify(run:ScheduleRun){
    if(run.status==='completed'&&!run.snapshot.config.notifyCompleted||!['completed','failed','unknown'].includes(run.status))return;
    this.notice({key:run.id+':'+run.status,planId:run.planId,runId:run.id,taskId:run.taskId,turnId:run.turnId,requestId:null,status:run.status});
  }
  async stopRun(id:string){
    const r=this.store.run(id);if(!r||!r.taskId||!r.turnId||!['running','waiting'].includes(r.status))throw new Error('运行已结束或未受理');
    const owned=this.ownedTurns(id),turnIds=new Set(owned.map(t=>t.turn_id));
    const active=owned.filter(t=>['accepted','dispatching','started'].includes(t.status));
    const unexecuted=[...new Set(owned.map(t=>t.task_id))].flatMap(taskId=>this.agent.store.pendingRequests(taskId))
      .filter(req=>req.class==='host_business'&&turnIds.has(req.origin?.turnId)&&['waiting_user','approved_pending_bind','queued_for_slot'].includes(req.payload?.phase));
    if(!active.length&&(!unexecuted.length||!this.agent.requests))throw new Error('原运行身份已变化，请查看任务');
    if(!this.store.requestStop(id))throw new Error('运行已结束或未受理');
    for(const req of unexecuted)this.agent.requests?.retire(req.requestId,occurrenceStopReason(id),false);
    for(const t of active){
      const current=this.agent.store.turn(t.turn_id);if(!current||current.task_id!==t.task_id||!['accepted','dispatching','started'].includes(current.status))continue;
      if(current.status==='accepted'){this.agent.tasks.cancelQueued(t.task_id,t.turn_id);continue;}
      const live=this.agent.runs.runForTask(t.task_id);if(current.run_id&&live?.runId===current.run_id&&(current.status==='dispatching'||this.agent.runs.active(live.runId)?.turnId===t.turn_id))await this.agent.tasks.stop(t.task_id,false,live.runId);
      else throw new Error('原运行身份已变化，请核对任务');
    }
    this.reconcile();
  }
  detail(id:string){
    const run=this.store.run(id);if(!run)throw new Error('运行不存在');
    const turns=this.ownedTurns(id),{items,hasMore}=this.agent.store.scheduledItems(id);
    const finalParent=turns.filter(t=>t.task_id===run.taskId).at(-1);
    const result=run.status==='completed'&&finalParent?this.agent.store.scheduledFinalReply(finalParent.task_id,finalParent.turn_id):null;
    const task=run.taskId?this.agent.store.task(run.taskId):undefined;
    const target=task&&run.turnId&&this.agent.store.turn(run.turnId)?{taskId:task.id,turnId:run.turnId,archived:!!task.archived_at}:null;
    const requests=turns.flatMap(t=>this.agent.store.pendingRequests(t.task_id).filter(r=>['pending','approved_pending_bind'].includes(r.status)&&r.origin?.turnId===t.turn_id).map(r=>({taskId:t.task_id,turnId:t.turn_id,requestId:r.requestId,kind:r.kind})));
    const workspace=run.workspaceId?this.store.db.prepare('SELECT path,base_ref AS baseRef,base_commit AS baseCommit,branch,status FROM schedule_workspace_links WHERE id=?').get(run.workspaceId) as {path:string;baseRef:string|null;baseCommit:string|null;branch:string|null;status:string}|undefined:undefined;
    const changes=(this.store.db.prepare(`SELECT c.task_id AS taskId,c.turn_id AS turnId,c.status,c.incomplete_reason AS reason,c.changed_files_json AS files,a.archived_at AS archived
      FROM scheduled_turn_origins o JOIN agent_turn_changes c ON c.turn_id=o.turn_id AND c.task_id=o.task_id JOIN agent_tasks a ON a.task_id=c.task_id
      WHERE o.occurrence_id=? ORDER BY c.rowid`).all(id) as {taskId:string;turnId:string;status:string;reason:string|null;files:string;archived:string|null}[]).map(row=>{
      const files=JSON.parse(row.files) as {path:string}[];return {taskId:row.taskId,turnId:row.turnId,status:row.status,reason:row.reason,archived:!!row.archived,total:files.length,files:files.slice(0,8).map(f=>f.path)};
    });
    return{run,items,hasMore,result,requests,target,workspace,changes,missingTarget:!!run.turnId&&!target};
  }
}
