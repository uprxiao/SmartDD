import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {runBundledMigrations} from '@main/db/migrations';
import {ScheduleStore} from './store';
import {newScheduleConfig,newSchedule,defaultScheduleGrace,scheduleSaveSchema,type ScheduleConfig,type ScheduleSave} from '@shared/schedule';
const opened:Database.Database[]=[];
const now=Date.parse('2026-11-25T09:00:00Z');
const config:ScheduleConfig={title:'每日摘要',prompt:'生成摘要',projectId:null,dirId:null,cwd:null,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'codex',tier:'ask',delegation:false,notifyCompleted:false};
function fixture(){const db=new Database(':memory:');opened.push(db);db.pragma('foreign_keys=ON');runBundledMigrations(db);return new ScheduleStore(db);}
afterEach(()=>{for(const db of opened.splice(0))db.close();});
const input=(patch:Partial<ScheduleSave>={}):ScheduleSave=>({schedule:{type:'interval',zone:'UTC',minutes:10},config,grace:60,enabled:true,...patch});
describe('M16 production ledger',()=>{
  it('reuses the active-occurrence SQLite statement but reads current committed states on every reconcile',()=>{
    const s=fixture(),prepare=vi.spyOn(s.db,'prepare');
    try{
      for(let i=0;i<200;i++)expect(s.active()).toEqual([]);
      const p=s.save(input(),now),claim=s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:'active-read'});
      if(claim.kind!=='claimed')throw Error('expected a claimed occurrence');
      expect(s.active()).toMatchObject([{id:claim.run.id,status:'claimed'}]);
      s.begin(claim.run.id,now+1);
      expect(s.active()).toMatchObject([{id:claim.run.id,status:'dispatching'}]);
      for(const status of ['running','waiting','unknown'] as const){
        s.setRunningState(claim.run.id,status);
        expect(s.active()).toMatchObject([{id:claim.run.id,status}]);
      }
      s.finish(claim.run.id,'completed',now+2);
      for(let i=0;i<200;i++)expect(s.active()).toEqual([]);
      expect(prepare.mock.calls.filter(([sql])=>sql.startsWith('SELECT id,plan_id AS planId,')&&sql.includes('FROM schedule_occurrences WHERE status IN ('))).toHaveLength(1);
    }finally{prepare.mockRestore();}
  });
  it('A01 shared new-plan defaults produce an enabled saved plan without creating any run or task',()=>{
    const s=fixture(),base=newScheduleConfig();
    expect(base).toMatchObject({projectId:null,dirId:null,cwd:null,workspace:'directory',destination:'new',boundTask:null,tier:'ask',delegation:false,notifyCompleted:false});
    expect(defaultScheduleGrace).toBe(60);
    const p=s.save({config:{...base,title:'default plan',prompt:'fixture',profileId:'codex'},schedule:newSchedule(),grace:defaultScheduleGrace,enabled:true},now);
    const reopened=new ScheduleStore(s.db);
    expect(reopened.plan(p.id)).toEqual(p);
    expect(p.grace).toBe(60);expect(p.nextDue).toBeGreaterThan(now);expect(reopened.history(p.id)).toEqual([]);
    expect(s.db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({count:0});
  });
  it('A02 rejects bad fields atomically before creation, preserves no tasks or runs',()=>{
    const s=fixture();for(const patch of [{title:''},{title:'  '},{prompt:' '},{profileId:''},{projectId:'p',dirId:null},{projectId:null,dirId:'d'},{workspace:'run-worktree',destination:'reuse'}]){
      const bad={...input(),config:{...config,...patch}};expect(()=>scheduleSaveSchema.parse(bad)).toThrow();expect(()=>s.save(bad as ScheduleSave,now)).toThrow();
    }
    expect(s.list()).toEqual([]);expect(s.active()).toEqual([]);expect(s.db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({count:0});
  });
  it('repairs only the affected revision, is idempotent for unchanged invalidity and resumes future slots without altering prior receipt',()=>{
    const s=fixture(),p=s.save(input(),now),first=s.claim(p.id,{now:p.nextDue!,expected:p.revision});
    if(!('run'in first))throw Error();s.finish(first.run.id,'failed',p.nextDue!+1,'fixture');
    expect(s.markRepair(p.id,'invalid')).toBe(true);const invalid=s.plan(p.id)!;
    expect(s.markRepair(p.id,'invalid')).toBe(false);expect(s.plan(p.id)?.revision).toBe(invalid.revision);expect(invalid.nextDue).toBeNull();
    expect(()=>s.save(input({id:p.id,revision:p.revision}),now+1800000)).toThrow();
    const repaired=s.save(input({id:p.id,revision:invalid.revision}),now+1800000);
    expect(repaired.repair).toBeNull();expect(repaired.nextDue).toBe(now+2400000);expect(s.run(first.run.id)?.status).toBe('failed');
  });
  it('applies new migration over the real prior schema, preserves existing data and runs only once',()=>{const s=fixture();s.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)').run('m16-fixture','old',now);expect(runBundledMigrations(s.db)).toEqual([]);expect(s.db.prepare('SELECT value FROM app_settings WHERE key=?').get('m16-fixture')).toEqual({value:'old'});expect(s.db.pragma('foreign_key_check')).toEqual([]);});
  it('uses anchored intervals, same preview calculation and stale edit protection',()=>{const s=fixture(),p=s.save(input(),now);expect(p.nextDue).toBe(now+600000);expect(s.preview(p.schedule,now,p.id,p.revision)).toEqual([now+600000,now+1200000,now+1800000]);const edited=s.save(input({id:p.id,revision:p.revision,config:{...config,title:'新名字'}}),now+12345);expect(edited.nextDue).toBe(p.nextDue);expect(()=>s.setEnabled(p.id,p.revision,false)).toThrow(/变化/);const paused=s.setEnabled(p.id,edited.revision,false,now+120000);expect(paused.nextDue).toBeNull();const resumed=s.setEnabled(p.id,paused.revision,true,now+720000);expect(resumed.nextDue).toBe(now+1200000);});
  it('A04 fixed host daily, workday and weekly preview and claims share exact calendar values',()=>{
    const s=fixture(),at=Date.parse('2026-11-27T03:00:00Z'),zone='Asia/Shanghai',time='09:00';
    const calendars=[
      [{type:'daily',zone,time},['2026-11-28T01:00:00Z','2026-11-29T01:00:00Z','2026-11-30T01:00:00Z']],
      [{type:'workdays',zone,time},['2026-11-30T01:00:00Z','2026-12-01T01:00:00Z','2026-12-02T01:00:00Z']],
      [{type:'weekly',zone,time,days:[1,3]},['2026-11-30T01:00:00Z','2026-12-02T01:00:00Z','2026-12-07T01:00:00Z']],
    ] as const;
    for(const [raw,expected] of calendars){
      const calendar=structuredClone(raw) as ScheduleSave['schedule'],times=expected.map(Date.parse);
      const p=s.save(input({schedule:calendar}),at);expect(p.nextDue).toBe(times[0]);
      expect(s.preview(p.schedule,at,p.id,p.revision)).toEqual(times);
      expect(s.claim(p.id,{now:times[0]-1,expected:p.revision}).kind).toBe('not_due');
      const result=s.claim(p.id,{now:times[0],expected:p.revision});expect(result).toMatchObject({kind:'claimed',run:{due:times[0]}});
      expect(s.plan(p.id)?.nextDue).toBe(times[1]);
    }
    expect(()=>s.save(input({schedule:{type:'weekly',zone,time,days:[]}}),at)).toThrow();
  });
  it('A05 fixed host monthly 31, 29 and last preserve gaps and leap day',()=>{
    const s=fixture(),zone='UTC',time='09:00';
    const scenarios=[
      ['2027-01-31T10:00:00Z',31,'2027-03-31T09:00:00Z'],
      ['2027-01-31T10:00:00Z',29,'2027-03-29T09:00:00Z'],
      ['2027-01-31T10:00:00Z','last','2027-02-28T09:00:00Z'],
      ['2028-01-31T10:00:00Z',29,'2028-02-29T09:00:00Z'],
      ['2028-01-31T10:00:00Z','last','2028-02-29T09:00:00Z']
    ] as const;
    for(const [at,monthDay,expected] of scenarios){
      const p=s.save(input({schedule:{type:'monthly',zone,time,monthDay}}),Date.parse(at));
      expect(p.nextDue).toBe(Date.parse(expected));
      expect(s.preview(p.schedule,Date.parse(at),p.id,p.revision)[0]).toBe(Date.parse(expected));
      expect(s.claim(p.id,{now:Date.parse(expected),expected:p.revision})).toMatchObject({kind:'claimed',run:{due:Date.parse(expected)}});
    }
  });
  it('A06 once stores an absolute UTC instant, rejects invalid dates, and remains ended after an occurrence finishes',()=>{
    const s=fixture(),at=Date.parse('2026-11-25T10:00:00Z');
    for(const schedule of [{type:'once',zone:'UTC',date:'2026-11-24',time:'09:00'},{type:'once',zone:'UTC',date:'2027-02-30',time:'09:00'},{type:'once',zone:'America/New_York',date:'2027-03-14',time:'02:30'}] as const)expect(()=>s.save(input({schedule}),at)).toThrow();
    const p=s.save(input({schedule:{type:'once',zone:'America/New_York',date:'2027-11-07',time:'01:30'}}),at);
    const due=Date.parse('2027-11-07T05:30:00Z');expect(p.nextDue).toBe(due);
    const result=s.claim(p.id,{now:due,expected:p.revision});
    if(!('run'in result))throw Error();s.finish(result.run.id,'completed',due+1234);
    expect(new ScheduleStore(s.db).plan(p.id)).toMatchObject({ended:true,enabled:false,nextDue:null,schedule:{onceAt:due}});
    expect(s.history(p.id)).toHaveLength(1);expect(s.claim(p.id,{now:due+3600000,expected:p.revision}).kind).toBe('not_due');
  });
  it('A07 cron persisted previews and actual due sequence match independent fixed UTC minute enumeration',()=>{
    const s=fixture(),at=Date.parse('2026-11-27T11:00:00Z'),schedule={type:'cron' as const,zone:'UTC',cron:'0 9 1,3 * MON'};
    const oracle=[];for(let t=at+60000;t<=at+10*86400000&&oracle.length<3;t+=60000){const d=new Date(t);if(d.getUTCHours()===9&&d.getUTCMinutes()===0&&(d.getUTCDay()===1||d.getUTCDate()===1||d.getUTCDate()===3))oracle.push(t);}
    const p=s.save(input({schedule}),at);expect(s.preview(p.schedule,at,p.id,p.revision)).toEqual(oracle);
    for(const due of oracle){const result=s.claim(p.id,{now:due,expected:p.revision});expect(result).toMatchObject({kind:'claimed',run:{due}});if(!('run'in result))throw Error();s.finish(result.run.id,'completed',due+12);}
    for(const cron of ['*/0 * * * *','@daily','0 9 L * *','0 9 31 2 *','0 0 0 0 0 0'])expect(()=>s.save(input({schedule:{...schedule,cron}}),at)).toThrow();
  });
  it('A07 host cron verifies list/steps/names, Sunday equivalence and cross-century leap occurrence independently',()=>{
    const s=fixture(),at=Date.parse('2026-11-27T11:00:00Z'),zone='UTC';
    const cases=[['0 9 * * MON-FRI',(d:Date)=>d.getUTCHours()===9&&d.getUTCMinutes()===0&&d.getUTCDay()>0&&d.getUTCDay()<6],['*/15 * * * *',(d:Date)=>d.getUTCMinutes()%15===0],['0 9 * * 7',(d:Date)=>d.getUTCHours()===9&&d.getUTCMinutes()===0&&d.getUTCDay()===0]] as const;
    for(const [cron,match] of cases){
      const oracle=[];for(let t=at+60000;t<at+30*86400000&&oracle.length<3;t+=60000)if(match(new Date(t)))oracle.push(t);
      const p=s.save(input({schedule:{type:'cron',zone,cron}}),at);
      expect(s.preview(p.schedule,at,p.id,p.revision)).toEqual(oracle);
      for(const due of oracle){const c=s.claim(p.id,{now:due,expected:p.revision});expect(c).toMatchObject({kind:'claimed',run:{due}});if(!('run'in c))throw Error();s.finish(c.run.id,'completed',due+1);}
    }
    const leapFrom=Date.parse('2096-03-01T00:00:00Z'),leaps=[];
    for(let d=leapFrom+86400000;d<Date.parse('2117-01-01T00:00:00Z')&&leaps.length<3;d+=86400000){const x=new Date(d);if(x.getUTCMonth()===1&&x.getUTCDate()===29)leaps.push(d);}
    const leap=s.save(input({schedule:{type:'cron',zone,cron:'0 0 29 2 *'}}),leapFrom);
    expect(s.preview(leap.schedule,leapFrom,leap.id,leap.revision)).toEqual(leaps);
    const sunday=s.save(input({schedule:{type:'cron',zone,cron:'0 9 * * 0'}}),at);
    expect(s.preview(sunday.schedule,at,sunday.id,sunday.revision)).toEqual(s.preview({type:'cron',zone,cron:'0 9 * * 7'},at));
  });
  it('A08 same schedule independently filters consumed wall keys after a clock rollback',()=>{
    const s=fixture(),at=Date.parse('2027-11-06T05:30:00Z'),schedule={type:'daily' as const,zone:'America/New_York',time:'01:30'};
    const first=s.save(input({schedule}),at),second=s.save(input({schedule}),at),due=Date.parse('2027-11-07T05:30:00Z');
    const consumed=s.claim(first.id,{now:due,expected:first.revision});if(!('run'in consumed))throw Error();s.finish(consumed.run.id,'completed',due+100);
    const rollback=due-60000,firstPreview=s.preview(first.schedule,rollback,first.id,first.revision),secondPreview=s.preview(second.schedule,rollback,second.id,second.revision);
    expect(firstPreview[0]).toBe(Date.parse('2027-11-08T06:30:00Z'));expect(secondPreview[0]).toBe(due);
    expect(s.claim(first.id,{now:due+3600000,expected:first.revision}).kind).toBe('not_due');
    expect(s.claim(second.id,{now:due,expected:second.revision})).toMatchObject({kind:'claimed',run:{due}});
  });
  it('deduplicates scheduled slots, merges missed slots and records busy without new input',()=>{const s=fixture(),p=s.save(input(),now);const first=s.claim(p.id,{now:now+1800000,expected:p.revision,reason:'resume'});expect(first.kind).toBe('claimed');if(!('run'in first))throw Error();expect(first.run.missedFrom).toBe(now+600000);expect(first.run.due).toBe(now+1800000);expect(s.claim(p.id,{now:now+1800000,expected:p.revision}).kind).toBe('not_due');const busy=s.claim(p.id,{now:now+1800000,expected:p.revision,trigger:'manual',requestId:'same'});expect(busy.kind).toBe('busy');s.finish(first.run.id,'completed',now+1810000);expect(s.claim(p.id,{now:now+1810000,expected:p.revision,trigger:'manual',requestId:'same'})).toEqual(busy);expect(s.history(p.id)).toHaveLength(1);expect(()=>s.claim(p.id,{now:now+1810000,expected:p.revision+1,trigger:'manual',requestId:'same'})).toThrow(/请求标识/);});
  it('preserves a manual request after archive and never spends the once schedule on a manual run',()=>{const s=fixture(),p=s.save(input({schedule:{type:'once',zone:'UTC',date:'2026-11-25',time:'10:00'}}),now);const c=s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:'first'});expect(c.kind).toBe('claimed');if(!('run'in c))throw Error();s.finish(c.run.id,'completed',now+10);expect(s.plan(p.id)?.ended).toBe(false);s.archive(p.id,p.revision);expect(s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:'first'})).toEqual(c);expect(s.history(p.id)).toHaveLength(1);});
  it('keeps original occurrence snapshot and stops an edited plan before acceptance',()=>{const s=fixture(),p=s.save(input(),now),claimed=s.claim(p.id,{now:p.nextDue!,expected:p.revision});if(!('run'in claimed))throw Error();const r=s.begin(claimed.run.id,now+600000);s.save(input({id:p.id,revision:p.revision,config:{...config,prompt:'修改后的提示词'}}),now+600001);expect(s.beforeAccept(r.id,now+600002)).toBeUndefined();expect(s.run(r.id)).toMatchObject({status:'skipped',snapshot:{config:{prompt:'生成摘要'}}});});
  it('A28 host ledger classifies grace boundary and +1ms for all supported grace values and merges only latest occurrence',()=>{
    const s=fixture(),start=Date.parse('2026-11-25T00:00:00Z'),schedule={type:'once' as const,zone:'UTC',date:'2026-11-26',time:'00:00'},due=Date.parse('2026-11-26T00:00:00Z');
    for(const grace of [0,10,60,720] as const){
      for(const extra of [0,1]){
        const p=s.save(input({schedule,grace}),start),now=due+grace*60000+extra;
        const c=s.claim(p.id,{now,expected:p.revision,reason:'resume'});expect(c.kind).toBe(extra?'skipped':'claimed');
        if(!('run'in c))throw Error();expect(c.run.due).toBe(due);
        if(extra){expect(c.run.reason).toBe('missed_grace');expect(c.run.taskId).toBeNull();expect(s.plan(p.id)?.ended).toBe(true);}
        expect(s.history(p.id)).toHaveLength(1);expect(s.claim(p.id,{now:now+1,expected:p.revision,reason:'resume'}).kind).toBe('not_due');
      }
    }
    const p=s.save(input({schedule:{type:'interval',zone:'UTC',minutes:10},grace:10}),start);
    const c=s.claim(p.id,{now:start+1850000,expected:p.revision,reason:'resume'});expect(c).toMatchObject({kind:'claimed',run:{due:start+1800000,missedFrom:start+600000}});
    expect(s.plan(p.id)?.nextDue).toBe(start+2400000);
  });
  it('A31 waiting/unknown outcomes retain occupancy and repeated rejected request ID after resolution remains busy receipt',()=>{
    const s=fixture(),p=s.save(input({config:{...config,destination:'reuse'}}),now);
    const c=s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:'start'});if(!('run'in c))throw Error();
    for(const state of ['waiting','unknown'] as const){
      s.setRunningState(c.run.id,state);
      expect(s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:state})).toEqual({kind:'busy',reason:'plan_busy'});
    }
    const due=s.plan(p.id)!.nextDue!,skip=s.claim(p.id,{now:due,expected:p.revision});expect(skip).toMatchObject({kind:'skipped',run:{reason:'plan_busy',taskId:null}});
    s.finish(c.run.id,'failed',due+1);const reopened=new ScheduleStore(s.db);
    expect(reopened.claim(p.id,{now:due+1,expected:p.revision,trigger:'manual',requestId:'unknown'})).toEqual({kind:'busy',reason:'plan_busy'});
    expect(reopened.claim(p.id,{now:due+1,expected:p.revision,trigger:'manual',requestId:'new'}).kind).toBe('claimed');
  });
  it('A40 terminal once scheduled occurrence ends its own date, manual runs do not end the date, a later reschedule survives prior terminal',()=>{
    const s=fixture(),schedule={type:'once' as const,zone:'UTC',date:'2026-11-26',time:'09:00'},due=Date.parse('2026-11-26T09:00:00Z');
    for(const outcome of ['completed','failed','skipped','stopped'] as const){
      const p=s.save(input({schedule}),now),manual=s.claim(p.id,{now,expected:p.revision,trigger:'manual',requestId:'manual'});if(!('run'in manual))throw Error();
      s.finish(manual.run.id,'completed',now+1);expect(s.plan(p.id)?.ended).toBe(false);
      const c=s.claim(p.id,{now:due,expected:p.revision});if(!('run'in c))throw Error();
      s.finish(c.run.id,outcome,due+1);expect(s.plan(p.id)).toMatchObject({ended:true,enabled:false,nextDue:null});
      expect(s.claim(p.id,{now:due+2,expected:p.revision,trigger:'manual',requestId:'ended-manual'}).kind).toBe('claimed');
    }
    const p=s.save(input({schedule}),now),c=s.claim(p.id,{now:due,expected:p.revision});if(!('run'in c))throw Error();
    const newDate={...schedule,date:'2026-11-27'},changed=s.save(input({id:p.id,revision:p.revision,schedule:newDate,enabled:false}),due+1);
    s.finish(c.run.id,'completed',due+2);expect(s.plan(p.id)).toMatchObject({ended:false,enabled:false,revision:changed.revision});
    const resumed=s.setEnabled(p.id,changed.revision,true,due+3);expect(resumed.nextDue).toBe(Date.parse('2026-11-27T09:00:00Z'));
  });
  it('retains end-state and stable task binding; active target is exclusive across plans',()=>{const s=fixture(),created=s.save(input({config:{...config,destination:'reuse'}}),now);const first=s.claim(created.id,{now,trigger:'manual',expected:created.revision,requestId:'a'});if(!('run'in first))throw Error();expect(s.plan(created.id)?.boundTask).toBe(first.run.taskId);const second=s.save(input({config:{...config,destination:'existing',boundTask:first.run.taskId}}),now);expect(s.claim(second.id,{now,trigger:'manual',expected:second.revision,requestId:'b'}).kind).toBe('busy');s.finish(first.run.id,'failed',now+1,'test');s.finish(first.run.id,'completed',now+2);expect(s.run(first.run.id)?.status).toBe('failed');});
});
