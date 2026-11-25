// Isolated scheduler persistence candidate. It never submits to an actual Agent.
// Uses the same installed SQLite binding as WillYou, under Electron's bundled Node.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {nextOccurrence,lastOccurrence,effectiveZone,resolveOnce,occurrenceIdentity,assessDeadline,validateSchedule} from './schedule-engine.mjs';

const require = createRequire(process.env.F16_REPO_ROOT
  ? new URL('file://' + process.env.F16_REPO_ROOT + '/package.json')
  : new URL('../../../../../../package.json',import.meta.url));
const Database = require('better-sqlite3');
const ACTIVE = ['claimed','dispatching','running','waiting','unknown'];
const TERMINAL = ['completed','failed','skipped','stopped'];
const activeSql = ACTIVE.map(x=>`'${x}'`).join(',');
const json = JSON.stringify;
const parse = JSON.parse;
const isOnce = s => s.type==='once';

function normalize(schedule, now, old){
  const s={...schedule};
  if(s.type==='interval')s.anchor=old?.type==='interval'&&Number(old.minutes)===Number(s.minutes)?old.anchor:now;
  if(s.type==='once')s.onceAt=resolveOnce(s);
  const result=validateSchedule(s,now);
  if(!result.ok)throw Error(result.error);
  return s;
}
const decodePlan = row => !row?null:{...row,schedule:parse(row.schedule),config:parse(row.config)};
const decodeRun = row => !row?null:{...row,snapshot:parse(row.snapshot)};

export class LedgerCandidate{
  constructor(path){
    this.db=new Database(path);
    this.db.pragma('busy_timeout=6000');
    this.db.pragma('journal_mode=WAL');
    this.db.pragma('foreign_keys=ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans(
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, schedule TEXT NOT NULL,
        config TEXT NOT NULL, grace INTEGER NOT NULL, enabled INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0,
        next_due INTEGER, zone TEXT NOT NULL, destination TEXT NOT NULL, bound_task TEXT
      );
      CREATE INDEX IF NOT EXISTS due_plan ON plans(next_due)
        WHERE enabled=1 AND archived=0 AND ended=0;
      CREATE INDEX IF NOT EXISTS zone_plan ON plans(zone)
        WHERE enabled=1 AND archived=0 AND ended=0;
      CREATE TABLE IF NOT EXISTS runs(
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id),
        revision INTEGER NOT NULL, occurrence_key TEXT NOT NULL, trigger TEXT NOT NULL,
        due INTEGER NOT NULL, claimed_at INTEGER NOT NULL, missed_from INTEGER,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        task_id TEXT, input_id TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL,
        reason TEXT, receipt TEXT, started_at INTEGER, finished_at INTEGER,
        UNIQUE(plan_id, occurrence_key)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS active_plan ON runs(plan_id) WHERE status IN (${activeSql});
      CREATE UNIQUE INDEX IF NOT EXISTS active_target ON runs(task_id) WHERE task_id IS NOT NULL AND status IN (${activeSql});
    `);
  }
  tx(fn){return this.db.transaction(fn).immediate();}
  close(){this.db.close();}
  plan(id){return decodePlan(this.db.prepare('SELECT * FROM plans WHERE id=?').get(id));}
  run(id){return decodeRun(this.db.prepare('SELECT * FROM runs WHERE id=?').get(id));}
  history(id){return this.db.prepare('SELECT * FROM runs WHERE plan_id=? ORDER BY claimed_at,rowid').all(id).map(decodeRun);}
  duePlans(now){return this.db.prepare('SELECT id,revision FROM plans WHERE enabled=1 AND archived=0 AND ended=0 AND next_due<=?').all(now);}
  nextDue(){return this.db.prepare('SELECT MIN(next_due) AS due FROM plans WHERE enabled=1 AND archived=0 AND ended=0').get().due;}
  nextUnclaimed(plan,now){
    let due=nextOccurrence(plan.schedule,now);
    const used=this.db.prepare('SELECT 1 FROM runs WHERE plan_id=? AND occurrence_key=?');
    while(due!==null&&used.get(plan.id,occurrenceIdentity(plan.schedule,due)))due=nextOccurrence(plan.schedule,due);
    return due;
  }
  create({id=randomUUID(),schedule,config={},grace=60,enabled=true,destination='new',boundTask=null},now){
    if(!['new','reuse','existing'].includes(destination)||destination==='existing'&&!boundTask)throw Error('Invalid destination');
    if(![0,10,60,720].includes(grace))throw Error('Invalid grace');
    const s=normalize(schedule,now);
    this.db.prepare(`INSERT INTO plans(id,revision,schedule,config,grace,enabled,next_due,zone,destination,bound_task)
      VALUES(?,1,?,?,?,?,?,?,?,?)`).run(id,json(s),json(config),grace,enabled?1:0,enabled?nextOccurrence(s,now):null,effectiveZone(s.zone),destination,boundTask);
    return this.plan(id);
  }
  edit(id,expected,{schedule,config,grace},now){
    return this.tx(()=>{
      const p=this.plan(id);
      if(!p||p.archived||p.revision!==expected)throw Error('Stale plan');
      if(grace!==undefined&&![0,10,60,720].includes(grace))throw Error('Invalid grace');
      const s=schedule?normalize(schedule,now,p.schedule):p.schedule;
      const next=schedule?(p.enabled?this.nextUnclaimed({...p,schedule:s},now):null):p.next_due;
      this.db.prepare('UPDATE plans SET revision=revision+1,schedule=?,config=?,grace=?,ended=?,next_due=?,zone=? WHERE id=?')
        .run(json(s),json(config??p.config),grace??p.grace,schedule?0:p.ended,next,effectiveZone(s.zone),id);
      return this.plan(id);
    });
  }
  setEnabled(id,expected,enabled,now){
    return this.tx(()=>{
      const p=this.plan(id);
      if(!p||p.archived||p.revision!==expected)throw Error('Stale plan');
      if(enabled&&p.ended)throw Error('Ended plan needs a future date');
      const next=enabled?this.nextUnclaimed(p,now):null;
      if(enabled&&next===null)throw Error('No future occurrence');
      this.db.prepare('UPDATE plans SET enabled=?,revision=revision+1,next_due=?,zone=? WHERE id=?')
        .run(enabled?1:0,next,effectiveZone(p.schedule.zone),id);
      return this.plan(id);
    });
  }
  remove(id,expected){
    return this.tx(()=>{
      const p=this.plan(id);
      if(!p||p.archived||p.revision!==expected)throw Error('Stale plan');
      this.db.prepare('UPDATE plans SET enabled=0,archived=1,next_due=NULL,revision=revision+1 WHERE id=?').run(id);
      return this.plan(id);
    });
  }
  // Rebase follow-local schedules at zone changes. Do not replay a wall slot already claimed.
  reconcileZones(now){
    return this.tx(()=>{
      const z=effectiveZone('');
      const rows=this.db.prepare(`SELECT * FROM plans WHERE enabled=1 AND archived=0 AND ended=0 AND zone<>?
        AND json_extract(schedule,'$.type') NOT IN ('interval','once') AND COALESCE(json_extract(schedule,'$.zone'),'')=''`).all(z).map(decodePlan);
      let changes=0;
      for(const p of rows){
        if(p.schedule.type==='interval'||p.schedule.type==='once'||p.schedule.zone)continue;
        if(z===p.zone)continue;
        this.db.prepare('UPDATE plans SET next_due=?,zone=?,revision=revision+1 WHERE id=?')
          .run(this.nextUnclaimed(p,now),z,p.id);changes++;
      }
      return changes;
    });
  }
  // claim() is one DB write transaction; actual target admission also needs the
  // existing task service's atomic busy check. hostBusy is a fixture observation.
  claim(id,{now,trigger='scheduled',expected,requestId,reason='tick',hostBusy=false}){
    return this.tx(()=>{
      const p=this.plan(id);
      if(trigger==='manual'&&requestId){const old=this.db.prepare('SELECT id FROM runs WHERE plan_id=? AND occurrence_key=?').get(id,`manual:${requestId}`);if(old)return{kind:'duplicate',run:this.run(old.id)};}
      if(!p||p.archived)return{kind:'unavailable'};
      if(expected!==undefined&&expected!==p.revision)return{kind:'stale'};
      if(!['manual','scheduled'].includes(trigger))throw Error('Invalid trigger');
      if(trigger==='manual'&&!requestId)throw Error('Manual request identity required');
      if(trigger==='scheduled'&&(!p.enabled||p.ended||p.next_due===null||p.next_due>now))return{kind:'not_due'};
      const latest=trigger==='manual'?now:lastOccurrence(p.schedule,now);
      const due=trigger==='manual'?now:(latest!==null&&latest>=p.next_due?latest:p.next_due);
      const key=trigger==='manual'?`manual:${requestId}`:occurrenceIdentity(p.schedule,due);
      const previous=this.db.prepare('SELECT id FROM runs WHERE plan_id=? AND occurrence_key=?').get(id,key);
      const active=this.db.prepare(`SELECT 1 FROM runs WHERE plan_id=? AND status IN (${activeSql})`).get(id);
      const targetBusy=p.bound_task&&this.db.prepare(`SELECT 1 FROM runs WHERE task_id=? AND status IN (${activeSql})`).get(p.bound_task);
      if(trigger==='manual'&&previous)return{kind:'duplicate',run:this.run(previous.id)};
      if(trigger==='manual'&&(active||targetBusy||hostBusy))return{kind:'busy'};
      const next=trigger==='scheduled'?this.nextUnclaimed(p,now):p.next_due;
      if(trigger==='scheduled')this.db.prepare('UPDATE plans SET next_due=? WHERE id=?').run(next,id);
      if(previous)return{kind:'duplicate',run:this.run(previous.id)};
      const deadline=trigger==='scheduled'?assessDeadline(due,now,p.grace,reason):'on_time';
      const why=deadline==='missed'?'missed_grace':active?'plan_busy':targetBusy||hostBusy?'task_busy':null;
      const status=why?'skipped':'claimed';
      const runId=randomUUID(), inputId=randomUUID();
      const taskId=why?null:p.destination==='new'?randomUUID():p.bound_task??randomUUID();
      this.db.prepare(`INSERT INTO runs
        (id,plan_id,revision,occurrence_key,trigger,due,claimed_at,missed_from,status,task_id,input_id,snapshot,reason,finished_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,id,p.revision,key,trigger,due,now,
          trigger==='scheduled'&&p.next_due<due?p.next_due:null,status,taskId,inputId,
          json({schedule:p.schedule,config:p.config,grace:p.grace,destination:p.destination}),why,why?now:null);
      if(taskId&&p.destination==='reuse'&&!p.bound_task)this.db.prepare('UPDATE plans SET bound_task=? WHERE id=?').run(taskId,id);
      if(why)this.finishOnce(this.run(runId));
      return{kind:status,run:this.run(runId)};
    });
  }
  begin(id,now){
    return this.tx(()=>{
      const r=this.run(id);
      if(!r||r.status!=='claimed')throw Error('Run not eligible to dispatch');
      this.db.prepare("UPDATE runs SET status='dispatching',attempts=attempts+1,started_at=COALESCE(started_at,?) WHERE id=?").run(now,id);
      return this.run(id);
    });
  }
  // Candidate for the last plan-revision gate. The real acceptance must include
  // the task service's busy/selection gate and actual receipt write in one store transaction.
  checkBeforeAccept(id,now){
    return this.tx(()=>{
      const r=this.run(id),p=r&&this.plan(r.plan_id);
      if(!r||!p||r.status!=='dispatching')throw Error('Run not eligible for acceptance');
      if(p.archived||p.revision!==r.revision||r.trigger==='scheduled'&&(!p.enabled||p.ended)){
        this.db.prepare("UPDATE runs SET status='skipped',reason='plan_changed_before_accept',finished_at=? WHERE id=?").run(now,id);
        return{ok:false,run:this.run(id)};
      }
      return{ok:true,run:r};
    });
  }
  accepted(id,receipt){
    return this.tx(()=>{
      const r=this.run(id);
      if(!r||!['dispatching','unknown','running'].includes(r.status)||receipt.inputId!==r.input_id||receipt.taskId!==r.task_id)throw Error('Receipt identity mismatch');
      if(r.receipt&&r.receipt!==json(receipt))throw Error('Receipt changed');
      this.db.prepare("UPDATE runs SET status='running',receipt=?,reason=NULL WHERE id=?").run(json(receipt),id);
      return this.run(id);
    });
  }
  wait(id){
    const changed=this.db.prepare("UPDATE runs SET status='waiting' WHERE id=? AND status='running'").run(id);
    if(changed.changes!==1)throw Error('Run not active');
    return this.run(id);
  }
  recover(id,proof,now,{reason='resume'}={}){
    if(proof?.receipt)return this.accepted(id,proof.receipt);
    return this.tx(()=>{
      const r=this.run(id);
      if(!r||!['dispatching','unknown','claimed'].includes(r.status))throw Error('Cannot recover this run');
      if(r.status==='claimed'){
        if(r.trigger==='scheduled'&&assessDeadline(r.due,now,r.snapshot.grace,reason)==='missed'){
          this.db.prepare("UPDATE runs SET status='skipped',reason='missed_before_dispatch',finished_at=? WHERE id=?").run(now,id);
          this.finishOnce(this.run(id));return this.run(id);
        }
        return r;
      }
      // Absence of a receipt is not a proof of no effect.
      if(proof?.unsubmitted!==true){
        this.db.prepare("UPDATE runs SET status='unknown',reason='uncertain_acceptance' WHERE id=?").run(id);
      }else if(r.attempts===1&&(r.trigger==='manual'||assessDeadline(r.due,now,r.snapshot.grace,reason)!=='missed')){
        this.db.prepare("UPDATE runs SET status='claimed',reason='retry_before_submit' WHERE id=?").run(id);
      }else{
        this.db.prepare("UPDATE runs SET status='failed',reason='startup_failed',finished_at=? WHERE id=?").run(now,id);
        this.finishOnce(this.run(id));
      }
      return this.run(id);
    });
  }
  finish(id,status,now,reason=null){
    if(!TERMINAL.includes(status)||status==='skipped')throw Error('Invalid terminal result');
    return this.tx(()=>{
      const r=this.run(id);
      if(!r)throw Error('Unknown run');
      if(TERMINAL.includes(r.status)){
        if(r.status!==status)throw Error('Terminal result already frozen');
        return r;
      }
      this.db.prepare('UPDATE runs SET status=?,finished_at=?,reason=? WHERE id=?').run(status,now,reason,id);
      const finished=this.run(id);this.finishOnce(finished);return finished;
    });
  }
  finishOnce(run){
    const p=this.plan(run.plan_id);
    if(run.trigger==='scheduled'&&p&&isOnce(p.schedule)&&resolveOnce(p.schedule)===run.due&&TERMINAL.includes(run.status)){
      this.db.prepare('UPDATE plans SET ended=1,enabled=0,next_due=NULL WHERE id=?').run(p.id);
    }
  }
}

// An experimental dynamic wake-up loop. UI/application integration is deliberately absent.
export class CandidateScheduler{
  constructor(ledger,dispatch,{now=Date.now,recheckMs=5000,onError=()=>{}}={}){
    Object.assign(this,{ledger,dispatch,now,recheckMs,onError});
    this.active=false;this.inflight=new Set();this.timer=null;this.scans=0;this.queryMs=[];
  }
  start(){this.active=true;this.tick('resume');}
  stop(){this.active=false;clearTimeout(this.timer);this.timer=null;}
  tick(reason='tick'){
    if(!this.active)return;
    clearTimeout(this.timer);this.timer=null;
    const start=performance.now(), now=this.now();
    try{
      const zone=effectiveZone('');
      if(zone!==this.lastZone){this.ledger.reconcileZones(now);this.lastZone=zone;}
      this.scans++;
      for(const p of this.ledger.duePlans(now)){
        const c=this.ledger.claim(p.id,{now,expected:p.revision,reason});
        if(c.kind==='claimed'){
          // Do not await a slow execution in the scan loop.
          let pending;
          pending=Promise.resolve().then(()=>{
            // Persisted claim remains recoverable if the app stops before submission.
            if(this.active)return this.dispatch(c.run);
          }).catch(this.onError).finally(()=>this.inflight.delete(pending));
          this.inflight.add(pending);
        }
      }
    }catch(error){this.onError(error);}
    this.queryMs.push(performance.now()-start);
    if(this.queryMs.length>1000)this.queryMs.shift();
    const next=this.ledger.nextDue();
    // Recheck wall clock when active plans exist; with no enabled plans caller
    // must notify start/change/resume. Never poll an empty schedule continuously.
    if(this.active&&next!==null)this.timer=setTimeout(()=>this.tick(),Math.max(1,Math.min(this.recheckMs,next-this.now())));
  }
}
