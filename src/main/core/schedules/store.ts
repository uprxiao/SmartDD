import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {scheduleConfigSchema,scheduleSchema,scheduleSaveSchema,type Schedule,type SchedulePlan,type ScheduleRun,type ScheduleClaim,type ScheduleSave,type ScheduleRunState,type ScheduleActualConfig} from '@shared/schedule';
import {effectiveZone,nextOccurrence,lastOccurrence,occurrenceIdentity,resolveOnce,assessDeadline,validateSchedule} from '@shared/schedule-engine.mjs';
const ACTIVE="'claimed','preparing','dispatching','running','waiting','unknown'";
const terminal=new Set<ScheduleRunState>(['completed','failed','skipped','stopped']);
const planColumns='id,revision,schedule,config,grace,enabled,archived,ended,next_due AS nextDue,zone,bound_task AS boundTask,repair,created_at AS createdAt,updated_at AS updatedAt';
const runColumns='id,plan_id AS planId,revision,occurrence_key AS occurrenceKey,trigger,due,claimed_at AS claimedAt,missed_from AS missedFrom,status,attempts,task_id AS taskId,input_id AS inputId,snapshot,turn_id AS turnId,reason,started_at AS startedAt,finished_at AS finishedAt,workspace_id AS workspaceId,actual_config AS actualConfig';
type PlanRow=Omit<SchedulePlan,'schedule'|'config'|'enabled'|'archived'|'ended'>&{schedule:string;config:string;enabled:number;archived:number;ended:number};
type RunRow=Omit<ScheduleRun,'snapshot'|'actualConfig'>&{snapshot:string;actualConfig:string|null};
const decodePlan=(r:PlanRow):SchedulePlan=>({...r,schedule:scheduleSchema.parse(JSON.parse(r.schedule)),config:scheduleConfigSchema.parse(JSON.parse(r.config)),enabled:!!r.enabled,archived:!!r.archived,ended:!!r.ended});
const decodeRun=(r:RunRow):ScheduleRun=>({...r,snapshot:JSON.parse(r.snapshot),actualConfig:r.actualConfig?JSON.parse(r.actualConfig):null});
export function normalizeSchedule(input:Schedule,now:number,old?:Schedule):Schedule{
  const s={...input};
  if(s.type==='interval')s.anchor=old?.type==='interval'&&old.minutes===s.minutes?old.anchor:now;
  if(s.type==='once'){delete s.onceAt;s.onceAt=resolveOnce(s);}
  const valid=validateSchedule(s,now);if(!valid.ok)throw new Error(valid.error);return s;
}
/** This store uses the same SQLite connection as AgentStore, not a second copy of task state. */
export class ScheduleStore{
  constructor(readonly db:Database.Database){}
  // Agent events can trigger reconciliation hundreds of times even with no plans.
  // Reuse the compiled statement, not its results; every call still reads the live ledger.
  private activeQuery?:Database.Statement<[],RunRow>;
  private tx<T>(fn:()=>T):T{return this.db.transaction(fn).immediate();}
  plan(id:string):SchedulePlan|undefined{const row=this.db.prepare(`SELECT ${planColumns} FROM schedule_plans WHERE id=?`).get(id) as PlanRow|undefined;return row&&decodePlan(row);}
  run(id:string):ScheduleRun|undefined{const row=this.db.prepare(`SELECT ${runColumns} FROM schedule_occurrences WHERE id=?`).get(id) as RunRow|undefined;return row&&decodeRun(row);}
  list(includeArchived=false):SchedulePlan[]{return(this.db.prepare(`SELECT ${planColumns} FROM schedule_plans ${includeArchived?'':'WHERE archived=0'} ORDER BY updated_at DESC`).all() as PlanRow[]).map(decodePlan);}
  history(planId:string):ScheduleRun[]{return(this.db.prepare(`SELECT ${runColumns} FROM schedule_occurrences WHERE plan_id=? ORDER BY claimed_at DESC,rowid DESC`).all(planId) as RunRow[]).map(decodeRun);}
  active():ScheduleRun[]{return(this.activeQuery??=this.db.prepare<[],RunRow>(`SELECT ${runColumns} FROM schedule_occurrences WHERE status IN (${ACTIVE})`)).all().map(decodeRun);}
  due(now:number){return this.db.prepare('SELECT id,revision FROM schedule_plans WHERE enabled=1 AND archived=0 AND ended=0 AND repair IS NULL AND next_due<=? ORDER BY next_due,id').all(now) as {id:string;revision:number}[];}
  nextDue():number|null{return(this.db.prepare('SELECT MIN(next_due) AS due FROM schedule_plans WHERE enabled=1 AND archived=0 AND ended=0 AND repair IS NULL').get() as {due:number|null}).due;}
  private assertCurrent(id:string,expected:number):SchedulePlan{const p=this.plan(id);if(!p||p.archived||p.revision!==expected)throw new Error('计划已变化，请重新读取');return p;}
  nextUnclaimed(schedule:Schedule,epoch:number,planId?:string):number|null{
    const used=this.db.prepare('SELECT 1 FROM schedule_occurrences WHERE plan_id=? AND occurrence_key=?');
    let due=nextOccurrence(schedule,epoch);while(due!==null&&planId&&used.get(planId,occurrenceIdentity(schedule,due)))due=nextOccurrence(schedule,due);return due;
  }
  preview(input:Schedule,now:number,planId?:string,revision?:number):number[]{
    const prior=planId?this.assertCurrent(planId,revision??-1):undefined,parsed=scheduleSchema.parse(input);const same=prior&&JSON.stringify({...prior.schedule,anchor:undefined,onceAt:undefined})===JSON.stringify({...parsed,anchor:undefined,onceAt:undefined});const s=same?prior.schedule:normalizeSchedule(parsed,now,prior?.schedule),out:number[]=[];
    for(let i=0;i<3;i++){const next=this.nextUnclaimed(s,out.at(-1)??now,planId);if(next===null)break;out.push(next);}return out;
  }
  save(raw:ScheduleSave,now=Date.now()):SchedulePlan{
    const input=scheduleSaveSchema.parse(raw);
    return this.tx(()=>{
      const prior=input.id?this.assertCurrent(input.id,input.revision??-1):undefined,id=prior?.id??randomUUID();
      // A configuration-only edit must not reset an interval or a one-shot instant.
      const same=prior&&JSON.stringify({...prior.schedule,anchor:undefined,onceAt:undefined})===JSON.stringify({...input.schedule,anchor:undefined,onceAt:undefined});
      const schedule=same?prior.schedule:normalizeSchedule(input.schedule,now,prior?.schedule);
      const ended=same?prior.ended:false;
      const bound=input.config.destination==='existing'?input.config.boundTask:input.config.destination==='reuse'&&prior?.config.destination==='reuse'?prior.boundTask:null;
      const due=input.enabled&&!ended?(same&&prior.enabled&&!prior.repair?prior.nextDue:this.nextUnclaimed(schedule,now,id)):null;
      if(input.enabled&&!ended&&due===null)throw new Error('没有未来执行时间');
      if(prior)this.db.prepare('UPDATE schedule_plans SET revision=revision+1,schedule=?,config=?,grace=?,enabled=?,ended=?,next_due=?,zone=?,bound_task=?,repair=NULL,updated_at=? WHERE id=?').run(JSON.stringify(schedule),JSON.stringify(input.config),input.grace,input.enabled&&!ended?1:0,ended?1:0,due,effectiveZone(schedule.zone),bound,now,id);
      else this.db.prepare('INSERT INTO schedule_plans(id,revision,schedule,config,grace,enabled,next_due,zone,bound_task,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,?,?)').run(id,JSON.stringify(schedule),JSON.stringify(input.config),input.grace,input.enabled?1:0,due,effectiveZone(schedule.zone),bound,now,now);
      return this.plan(id)!;
    });
  }
  setEnabled(id:string,revision:number,enabled:boolean,now=Date.now()):SchedulePlan{return this.tx(()=>{
    const p=this.assertCurrent(id,revision);if(enabled&&(p.ended||p.repair))throw new Error('请先修正计划或选择未来时间');
    const next=enabled?this.nextUnclaimed(p.schedule,now,id):null;if(enabled&&next===null)throw new Error('没有未来执行时间');
    this.db.prepare('UPDATE schedule_plans SET revision=revision+1,enabled=?,next_due=?,zone=?,updated_at=? WHERE id=?').run(enabled?1:0,next,effectiveZone(p.schedule.zone),now,id);return this.plan(id)!;
  });}
  archive(id:string,revision:number,now=Date.now()):SchedulePlan{return this.tx(()=>{this.assertCurrent(id,revision);this.db.prepare('UPDATE schedule_plans SET revision=revision+1,enabled=0,archived=1,next_due=NULL,updated_at=? WHERE id=?').run(now,id);return this.plan(id)!;});}
  reconcileZones(now:number):void{this.tx(()=>{const zone=effectiveZone();for(const p of this.list())if(p.enabled&&!p.ended&&!p.repair&&p.schedule.type!=='once'&&p.schedule.type!=='interval'&&!p.schedule.zone&&p.zone!==zone)this.db.prepare('UPDATE schedule_plans SET zone=?,next_due=?,revision=revision+1,updated_at=? WHERE id=?').run(zone,this.nextUnclaimed(p.schedule,now,p.id),now,p.id);});}
  markRepair(id:string,reason:string):boolean{return !!this.db.prepare('UPDATE schedule_plans SET repair=?,next_due=NULL,revision=revision+1,updated_at=? WHERE id=? AND archived=0 AND (repair IS NULL OR repair<>?)').run(reason,Date.now(),id,reason).changes;}
  claim(id:string,o:{now:number;trigger?:'manual'|'scheduled';expected:number;requestId?:string;reason?:string;hostBusy?:boolean}):ScheduleClaim{return this.tx(()=>{
    const trigger=o.trigger??'scheduled',manual=trigger==='manual',p=this.plan(id);if(!p)return{kind:'unavailable'};
    if(manual&&!o.requestId)throw new Error('缺少请求标识');
    const semantic=JSON.stringify({revision:o.expected,trigger});
    if(manual){const prior=this.db.prepare('SELECT semantic,receipt FROM schedule_manual_requests WHERE plan_id=? AND request_id=?').get(id,o.requestId) as {semantic:string;receipt:string}|undefined;if(prior){if(prior.semantic!==semantic)throw new Error('请求标识已用于其他配置');return JSON.parse(prior.receipt) as ScheduleClaim;}}
    const decision=(c:ScheduleClaim):ScheduleClaim=>{if(manual)this.db.prepare('INSERT INTO schedule_manual_requests(plan_id,request_id,semantic,receipt,run_id,created_at) VALUES(?,?,?,?,?,?)').run(id,o.requestId,semantic,JSON.stringify(c),'run'in c?c.run.id:null,o.now);return c;};
    if(p.archived)return decision({kind:'unavailable'});if(p.revision!==o.expected)return decision({kind:'stale'});if(p.repair)return decision({kind:'repair',reason:p.repair});
    if(!manual&&(!p.enabled||p.ended||p.nextDue===null||p.nextDue>o.now))return{kind:'not_due'};
    const planBusy=this.db.prepare(`SELECT 1 FROM schedule_occurrences WHERE plan_id=? AND status IN (${ACTIVE})`).get(id);
    const targetBusy=p.boundTask&&this.db.prepare(`SELECT 1 FROM schedule_occurrences WHERE task_id=? AND status IN (${ACTIVE})`).get(p.boundTask);
    const whyBusy=planBusy?'plan_busy':targetBusy||o.hostBusy?'task_busy':null;
    if(manual&&whyBusy)return decision({kind:'busy',reason:whyBusy});
    const latest=manual?o.now:lastOccurrence(p.schedule,o.now),due=manual?o.now:Math.max(p.nextDue!,latest??p.nextDue!);
    const key=manual?`manual:${o.requestId}`:occurrenceIdentity(p.schedule,due);
    const prev=this.db.prepare('SELECT id FROM schedule_occurrences WHERE plan_id=? AND occurrence_key=?').get(id,key) as {id:string}|undefined;
    if(!manual)this.db.prepare('UPDATE schedule_plans SET next_due=? WHERE id=?').run(this.nextUnclaimed(p.schedule,o.now,id),id);
    if(prev)return decision({kind:'duplicate',run:this.run(prev.id)!});
    const why=!manual&&assessDeadline(due,o.now,p.grace,o.reason)==='missed'?'missed_grace':whyBusy;
    const status=why?'skipped':'claimed',runId=randomUUID(),inputId=randomUUID(),taskId=why?null:p.config.destination==='new'?randomUUID():p.boundTask??randomUUID();
    this.db.prepare('INSERT INTO schedule_occurrences(id,plan_id,revision,occurrence_key,trigger,due,claimed_at,missed_from,status,task_id,input_id,snapshot,reason,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId,id,p.revision,key,trigger,due,o.now,!manual&&p.nextDue!<due?p.nextDue:null,status,taskId,inputId,JSON.stringify({schedule:p.schedule,config:p.config,grace:p.grace}),why,why?o.now:null);
    if(taskId&&p.config.destination==='reuse'&&!p.boundTask)this.db.prepare('UPDATE schedule_plans SET bound_task=? WHERE id=?').run(taskId,id);
    const run=this.run(runId)!;if(why)this.finishOnce(run);return decision({kind:status,run});
  });}
  begin(id:string,now:number):ScheduleRun{const row=this.db.prepare("UPDATE schedule_occurrences SET status='dispatching',attempts=attempts+1,started_at=COALESCE(started_at,?) WHERE id=? AND status='claimed'").run(now,id);if(!row.changes)throw new Error('运行已变化');return this.run(id)!;}
  beforeAccept(id:string,now:number):ScheduleRun|undefined{
    const r=this.run(id),p=r&&this.plan(r.planId);if(!r||!p||r.status!=='dispatching')return;
    if(p.archived||p.revision!==r.revision||p.repair||r.trigger==='scheduled'&&(!p.enabled||p.ended)){this.finish(id,'skipped',now,'plan_changed_before_accept');return;}
    return r;
  }
  accept(id:string,taskId:string,inputId:string,turnId:string,actualConfig?:ScheduleActualConfig):void{
    const r=this.run(id);if(!r||r.status!=='dispatching'||r.taskId!==taskId||r.inputId!==inputId)throw new Error('运行收据不匹配');
    this.db.prepare("UPDATE schedule_occurrences SET status='running',turn_id=?,actual_config=?,reason=NULL WHERE id=?").run(turnId,actualConfig?JSON.stringify(actualConfig):null,id);
    if(actualConfig){const plan=this.plan(r.planId);if(plan?.config.destination==='reuse'&&plan.boundTask===taskId&&!plan.config.cwd)this.db.prepare('UPDATE schedule_plans SET config=? WHERE id=?').run(JSON.stringify({...plan.config,cwd:actualConfig.cwd}),plan.id);}
    this.db.prepare('INSERT INTO scheduled_turn_origins(turn_id,occurrence_id,task_id,input_id,root_turn_id) VALUES(?,?,?,?,?)').run(turnId,id,taskId,inputId,turnId);
  }
  requestStop(id:string):boolean{return !!this.db.prepare("UPDATE schedule_occurrences SET reason='user_stop_requested' WHERE id=? AND status IN ('running','waiting')").run(id).changes;}
  setRunningState(id:string,status:'running'|'waiting'|'unknown',reason:string|null=null):void{this.db.prepare(`UPDATE schedule_occurrences SET status=?,reason=CASE WHEN reason='user_stop_requested' THEN reason ELSE ? END WHERE id=? AND status IN (${ACTIVE})`).run(status,reason,id);}
  retryUnaccepted(id:string):boolean{return !!this.db.prepare("UPDATE schedule_occurrences SET status='claimed',reason='retry_before_submit' WHERE id=? AND turn_id IS NULL AND status='dispatching' AND attempts=1").run(id).changes;}
  finish(id:string,status:'completed'|'failed'|'skipped'|'stopped',now:number,reason:string|null=null):ScheduleRun{return this.tx(()=>{const r=this.run(id);if(!r)throw new Error('运行不存在');if(terminal.has(r.status))return r;this.db.prepare('UPDATE schedule_occurrences SET status=?,finished_at=?,reason=? WHERE id=?').run(status,now,reason,id);const result=this.run(id)!;this.finishOnce(result);return result;});}
  private finishOnce(run:ScheduleRun){const p=this.plan(run.planId);if(p&&run.trigger==='scheduled'&&p.schedule.type==='once'&&resolveOnce(p.schedule)===run.due&&terminal.has(run.status))this.db.prepare('UPDATE schedule_plans SET ended=1,enabled=0,next_due=NULL WHERE id=?').run(p.id);}
}
