import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {
  MINUTE, nextOccurrence, lastOccurrence, previewOccurrences, resolveOnce,
  validateSchedule, occurrenceIdentity, assessDeadline, parseCron,
} from './schedule-engine.mjs';
const t = s => Date.parse(s);
const iso = ms => ms===null?null:new Date(ms).toISOString();
const next = (s, from) => iso(nextOccurrence(s,t(from)));
const assertNext = (s,from,expected) => assert.equal(next(s,from),expected);

test('E01-01 fixed interval anchored and no drift from delayed completion',()=>{
  const schedule={type:'interval',minutes:5,anchor:t('2026-11-25T01:00:00Z')};
  assertNext(schedule,'2026-11-25T01:07:30Z','2026-11-25T01:10:00.000Z');
  assert.equal(iso(lastOccurrence(schedule,t('2026-11-25T01:07:30Z'))),'2026-11-25T01:05:00.000Z');
  assert.equal(lastOccurrence(schedule,t('2026-11-25T01:04:59Z')),null);
  assertNext(schedule,'2026-11-25T01:00:00Z','2026-11-25T01:05:00.000Z');
});
test('E01-02 daily, weekday, several weekdays, explicit timezone and quarter-hour offset',()=>{
  assertNext({type:'daily',time:'09:00',zone:'Asia/Shanghai'},'2026-11-25T00:59:59Z','2026-11-25T01:00:00.000Z');
  assertNext({type:'workdays',time:'09:00',zone:'UTC'},'2026-11-27T09:00:00Z','2026-11-30T09:00:00.000Z');
  assertNext({type:'weekly',time:'09:00',days:[1,3,5],zone:'UTC'},'2026-11-25T09:00:00Z','2026-11-27T09:00:00.000Z');
  assertNext({type:'daily',time:'09:00',zone:'Asia/Kathmandu'},'2026-11-25T03:14:00Z','2026-11-25T03:15:00.000Z');
});
test('E01-03 monthly exact day skips absent day; last calendar day',()=>{
  assertNext({type:'monthly',time:'08:00',monthDay:31,zone:'UTC'},'2027-01-31T08:00:00Z','2027-03-31T08:00:00.000Z');
  assertNext({type:'monthly',time:'08:00',monthDay:'last',zone:'UTC'},'2028-01-31T08:00:00Z','2028-02-29T08:00:00.000Z');
  assertNext({type:'monthly',time:'08:00',monthDay:'last',zone:'UTC'},'2027-12-31T08:00:00Z','2028-01-31T08:00:00.000Z');
});
test('E01-04 once, invalid calendar date, and frozen instant after timezone change',()=>{
  const s={type:'once',date:'2026-11-27',time:'09:00',zone:'Asia/Shanghai'};
  const at=resolveOnce(s);
  assert.equal(iso(at),'2026-11-27T01:00:00.000Z');
  assert.equal(nextOccurrence({...s,onceAt:at,zone:'America/New_York'},t('2026-11-26T00:00Z')),at);
  assert.equal(nextOccurrence({...s,onceAt:at},at),null);
  assert.equal(validateSchedule({...s,date:'2027-02-29'},t('2026-11-25T01:00Z')).ok,false);
  assert.equal(validateSchedule({...s,date:'2026-11-24'},t('2026-11-25T01:00Z')).ok,false);
});
test('E01-05 spring gap skipped, fall fold only first, reverse after repeated hour',()=>{
  const s={type:'daily',time:'02:30',zone:'America/New_York'};
  // 2027-03-14 02:30 does not exist in New York.
  assertNext(s,'2027-03-13T07:30:00Z','2027-03-15T06:30:00.000Z');
  assert.equal(validateSchedule({type:'once',date:'2027-03-14',time:'02:30',zone:s.zone},t('2027-03-13T00:00Z')).ok,false);
  const f={type:'daily',time:'01:30',zone:s.zone};
  assertNext(f,'2027-11-07T04:00:00Z','2027-11-07T05:30:00.000Z');
  assertNext(f,'2027-11-07T05:30:00Z','2027-11-08T06:30:00.000Z');
  const every={type:'cron',cron:'* 1 * * *',zone:s.zone};
  assert.equal(iso(lastOccurrence(every,t('2027-11-07T06:10:00Z'))),'2027-11-07T05:59:00.000Z');
});
test('E01-06 non-hour DST and skipped date',()=>{
  // Lord Howe repeats 01:30..01:59 (30-minute offset change).
  const s={type:'daily',time:'01:45',zone:'Australia/Lord_Howe'};
  assertNext(s,'2027-04-03T12:00:00Z','2027-04-03T14:45:00.000Z');
  assertNext(s,'2027-04-03T14:45:00Z','2027-04-04T15:15:00.000Z');
  // Samoa skipped the local 2011-12-30 when changing date line side.
  assertNext({type:'daily',time:'09:00',zone:'Pacific/Apia'},'2011-12-29T19:00:00Z','2011-12-30T19:00:00.000Z');
});
test('E01-07 cron list/range/step, aliases, sunday=7, DOM/DOW semantics',()=>{
  const s={type:'cron',cron:'0,30 9-10/1 * NOV MON-FRI',zone:'UTC'};
  assert.deepEqual(previewOccurrences(s,t('2026-11-25T08:59:59Z'),4).map(iso),[
    '2026-11-25T09:00:00.000Z','2026-11-25T09:30:00.000Z','2026-11-25T10:00:00.000Z','2026-11-25T10:30:00.000Z'
  ]);
  assertNext({type:'cron',cron:'5/15 9 * * 7',zone:'UTC'},'2026-11-29T09:05:00Z','2026-11-29T09:20:00.000Z');
  assertNext({type:'cron',cron:'0 9 13 * MON',zone:'UTC'},'2026-11-12T00:00:00Z','2026-11-13T09:00:00.000Z');
  assertNext({type:'cron',cron:'0 9 */2 * MON-FRI',zone:'UTC'},'2026-11-25T09:00:00Z','2026-11-27T09:00:00.000Z');
  // Leap gap crossing century: next after 2096 leap day is 2104, not 2100.
  assertNext({type:'cron',cron:'0 0 29 FEB *',zone:'UTC'},'2096-02-29T00:00:00Z','2104-02-29T00:00:00.000Z');
});
test('E01-08 invalid schedules fail clearly',()=>{
  for(const cron of ['* * * *','0 * * * * *','0 9 30 FEB *','*/0 * * * *','*/61 * * * *',
    '0 24 * * *','0 3 * JUN-APR *','0 9 * * FRI-MON','0 9 * * 9','@daily','0 9 L * *',
    '0 9 * * MON#2','1,,2 * * * *','1e1 * * * *']){
    assert.equal(validateSchedule({type:'cron',cron,zone:'UTC'},t('2026-11-25T00:00Z')).ok,false,cron);
  }
  assert.equal(validateSchedule({type:'daily',time:'09:00',zone:'Invalid/Timezone'},t('2026-11-25T00:00Z')).ok,false);
  assert.equal(validateSchedule({type:'weekly',time:'09:00',days:[],zone:'UTC'},t('2026-11-25T00:00Z')).ok,false);
  assert.equal(validateSchedule({type:'interval',minutes:0,zone:'UTC'},t('2026-11-25T00:00Z')).ok,false);
});
test('E01-09 host timezone change follows local, stable wall slot identity',()=>{
  const keep = process.env.TZ;
  try{
    const s={type:'daily',time:'09:00',zone:''};
    process.env.TZ='Asia/Shanghai';
    const a=nextOccurrence(s,t('2026-11-25T00:00Z')), key=occurrenceIdentity(s,a);
    process.env.TZ='America/New_York';
    const b=nextOccurrence(s,t('2026-11-25T00:00Z'));
    // Local date on the same reference UTC instant is 11/24 in NY; 09:00 already passed.
    assert.equal(iso(a),'2026-11-25T01:00:00.000Z');
    assert.equal(iso(b),'2026-11-25T14:00:00.000Z');
    assert.equal(occurrenceIdentity(s,b),key);
  }finally{
    if(keep===undefined)delete process.env.TZ;else process.env.TZ=keep;
  }
});
test('E01-10 grace including exact boundary and no-catch-up normal jitter',()=>{
  const due=t('2026-11-25T01:00:00Z');
  assert.equal(assessDeadline(due,due-1,60,'tick'),'not_due');
  assert.equal(assessDeadline(due,due+200,0,'tick'),'on_time');
  assert.equal(assessDeadline(due,due+200,0,'resume'),'missed');
  assert.equal(assessDeadline(due,due+60*MINUTE,60,'resume'),'catch_up');
  assert.equal(assessDeadline(due,due+60*MINUTE+1,60,'resume'),'missed');
});
test('E01-11 independently scan UTC minutes as oracle against optimized cron search',()=>{
  const rules=['1,17,42 0-23/3 * * *','0 7 * * 1-5','15 8 2,10,25 * *'];
  const from=t('2026-11-24T14:51:33Z');
  let compared=0;
  for(const cron of rules){
    const rule=parseCron(cron), s={type:'cron',cron,zone:'UTC'};
    let cursor=from;
    for(let i=0;i<12;i++){
      let oracle=null;
      for(let p=Math.floor(cursor/MINUTE)*MINUTE+MINUTE;p<cursor+40*86400000;p+=MINUTE){
        const d=new Date(p);
        const day={month:d.getUTCMonth()+1,day:d.getUTCDate(),weekday:d.getUTCDay()};
        if(rule.dayMatches(day)&&rule.times.includes(d.getUTCHours()*60+d.getUTCMinutes())){oracle=p;break;}
      }
      assert.notEqual(oracle,null,cron);
      assert.equal(nextOccurrence(s,cursor),oracle,cron);
      cursor=oracle;compared++;
    }
  }
  console.log(JSON.stringify({metric:'cron-minute-oracle',compared}));
});
test('E01-12 benchmark pure next/last scheduling and real local timer dispatch (not model latency)',async()=>{
  const schedule={type:'cron',cron:'*/2 0-23 * * *',zone:'America/New_York'};
  let p=t('2026-11-25T00:12:00Z');
  const durations=[];
  for(let i=0;i<400;i++){
    const a=performance.now();p=nextOccurrence(schedule,p);assert.ok(p);
    durations.push(performance.now()-a);
  }
  durations.sort((a,b)=>a-b);
  const measured=[];
  // Bounded idle timer; multiple pending times, no busy polling.
  const start=Date.now();
  for(const offset of [30,80,130,180,230]){
    const due=start+offset;await delay(Math.max(0,due-Date.now()));
    measured.push(Math.max(0,Date.now()-due));
  }
  console.log(JSON.stringify({metric:'time-engine-local',n:durations.length,p50Ms:durations[200],p95Ms:durations[380],
    maxMs:durations.at(-1),timerLagsMs:measured}));
  assert.ok(Math.max(...measured)<5000);
  assert.ok(durations.at(-1)<5000);
});
