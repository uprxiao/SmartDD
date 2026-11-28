import {describe,expect,it} from 'vitest';
import {nextOccurrence,previewOccurrences,validateSchedule,resolveOnce,occurrenceIdentity,assessDeadline,lastOccurrence} from '@shared/schedule-engine.mjs';
import type {Schedule} from '@shared/schedule';
const ts=(s:string)=>Date.parse(s),iso=(values:number[])=>values.map(v=>new Date(v).toISOString());
describe('M16 shared production calendar',()=>{
  it('A03 rejects all invalid interval values and keeps the anchored schedule',()=>{
    const at=ts('2026-11-25T10:00:00Z');for(const minutes of [0,-1,1.5,Number.MAX_SAFE_INTEGER])expect(validateSchedule({type:'interval',zone:'UTC',minutes},at).ok).toBe(false);
    const s:Schedule={type:'interval',zone:'UTC',minutes:1,anchor:at};expect(nextOccurrence(s,at+65000)).toBe(at+120000);expect(lastOccurrence(s,at+65000)).toBe(at+60000);
  });
  it('A04 daily/weekdays/multi-weekly and no selected day',()=>{
    const at=ts('2026-11-27T03:00:00Z'),zone='Asia/Shanghai',time='09:00';
    expect(iso(previewOccurrences({type:'daily',zone,time},at))).toEqual(['2026-11-28T01:00:00.000Z','2026-11-29T01:00:00.000Z','2026-11-30T01:00:00.000Z']);
    expect(iso(previewOccurrences({type:'workdays',zone,time},at))).toEqual(['2026-11-30T01:00:00.000Z','2026-12-01T01:00:00.000Z','2026-12-02T01:00:00.000Z']);
    expect(iso(previewOccurrences({type:'weekly',zone,time,days:[1,3]},at))).toEqual(['2026-11-30T01:00:00.000Z','2026-12-02T01:00:00.000Z','2026-12-07T01:00:00.000Z']);
    expect(validateSchedule({type:'weekly',zone,time,days:[]},at).ok).toBe(false);
  });
  it('A05 missing month date skips; last and leap days are calendar-correct',()=>{
    const at=ts('2027-01-31T10:00:00Z'),zone='UTC',time='09:00';
    expect(nextOccurrence({type:'monthly',zone,time,monthDay:31},at)).toBe(ts('2027-03-31T09:00:00Z'));
    expect(nextOccurrence({type:'monthly',zone,time,monthDay:'last'},at)).toBe(ts('2027-02-28T09:00:00Z'));
    expect(nextOccurrence({type:'monthly',zone,time,monthDay:29},ts('2028-01-31T10:00:00Z'))).toBe(ts('2028-02-29T09:00:00Z'));
  });
  it('A06 rejects past, invalid dates and a missing DST wall instant, resolves fold once',()=>{
    const at=ts('2026-11-25T10:00:00Z');for(const date of ['2026-11-24','2027-02-30'])expect(validateSchedule({type:'once',zone:'UTC',time:'09:00',date},at).ok).toBe(false);
    expect(validateSchedule({type:'once',zone:'America/New_York',time:'02:30',date:'2027-03-14'},at).ok).toBe(false);
    expect(resolveOnce({type:'once',zone:'America/New_York',time:'01:30',date:'2027-11-07'})).toBe(ts('2027-11-07T05:30:00Z'));
  });
  it('A07 Cron names, lists, steps, POSIX DOM/DOW, Sunday aliases and invalid dialect',()=>{
    const at=ts('2026-11-27T11:00:00Z'),zone='UTC';
    expect(nextOccurrence({type:'cron',zone,cron:'0 9 * * MON-FRI'},at)).toBe(ts('2026-11-30T09:00:00Z'));
    expect(iso(previewOccurrences({type:'cron',zone,cron:'*/15 * * * *'},at))).toEqual(['2026-11-27T11:15:00.000Z','2026-11-27T11:30:00.000Z','2026-11-27T11:45:00.000Z']);
    const independent=[];for(let t=at+60000;t<=at+10*86400000&&independent.length<3;t+=60000){const d=new Date(t);if(d.getUTCHours()===9&&d.getUTCMinutes()===0&&(d.getUTCDay()===1||d.getUTCDate()===1||d.getUTCDate()===3))independent.push(t);}
    expect(previewOccurrences({type:'cron',zone,cron:'0 9 1,3 * MON'},at)).toEqual(independent);
    expect(nextOccurrence({type:'cron',zone,cron:'0 9 * * 0'},at)).toEqual(nextOccurrence({type:'cron',zone,cron:'0 9 * * 7'},at));
    expect(nextOccurrence({type:'cron',zone,cron:'0 0 29 2 *'},ts('2096-03-01T00:00:00Z'))).toBe(ts('2104-02-29T00:00:00Z'));
    for(const cron of ['0 0 0 0 0 0','*/0 * * * *','0 9 L * *','0 9 1W * *','0 9 * * 1#2','@reboot','0 9 31 2 *'])expect(validateSchedule({type:'cron',zone,cron},at).ok).toBe(false);
  });
  it('A08 DST gap/fold and non-hour changes; same wall slot key is stable',()=>{
    const ny:Schedule={type:'daily',zone:'America/New_York',time:'02:30'};
    expect(nextOccurrence(ny,ts('2027-03-13T08:00:00Z'))).toBe(ts('2027-03-15T06:30:00Z'));
    const fold:Schedule={type:'daily',zone:'America/New_York',time:'01:30'};expect(nextOccurrence(fold,ts('2027-11-07T05:31:00Z'))).toBe(ts('2027-11-08T06:30:00Z'));
    expect(nextOccurrence({type:'daily',zone:'Australia/Lord_Howe',time:'02:15'},ts('2027-10-02T16:00:00Z'))).toBe(ts('2027-10-03T15:15:00Z'));
    const due=ts('2027-11-07T05:30:00Z');expect(occurrenceIdentity(fold,due)).toBe(occurrenceIdentity(fold,due+3600000));
  });
  it('A28 distinguishes live jitter and restart grace at exact and +1ms boundary',()=>{const due=ts('2026-11-25T10:00:00Z');expect(assessDeadline(due,due+5000,0,'tick')).toBe('on_time');expect(assessDeadline(due,due+1,0,'resume')).toBe('missed');for(const grace of [10,60,720]){expect(assessDeadline(due,due+grace*60000,grace,'resume')).toBe('catch_up');expect(assessDeadline(due,due+grace*60000+1,grace,'resume')).toBe('missed');}});
});
