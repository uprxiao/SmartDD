import assert from 'node:assert/strict';
export const atMinutes=(t,m)=>Math.ceil(t/60000)*60000+m*60000;
export const localTime=(t,offset)=>new Date(t-offset*60000).toISOString().slice(11,16);
export const utcOnce=t=>({type:'once',zone:'UTC',date:new Date(t).toISOString().slice(0,10),time:new Date(t).toISOString().slice(11,16)});
export const wallSkew=(baseline,current)=>current.wall-baseline.wall-(current.mono-baseline.mono);
export function naturalWaitBudget(now,due){assert(Number.isSafeInteger(now)&&Number.isSafeInteger(due));return Math.max(0,due-now)+90000;}
export function assertZoneOnly(before,changed,original){
 assert.equal(original.zone,'Asia/Singapore');assert.equal(original.offset,-480);
 assert.equal(changed.zone,'Asia/Bangkok');assert.equal(changed.offset,-420);
 assert(Math.abs(wallSkew(before,changed))<15000,'actual absolute wall changed in zone-only scenario');
 assert(!changed.events.some(e=>e.kind==='suspend'&&e.wall>=before.wall),'actual sleep not part of zone scenario');
}
export function observedResumeProof(suspend,resume,due,accepted,skipped){
 assert(suspend.kind==='suspend'&&resume.kind==='resume'&&suspend.wall<due&&resume.wall>due+5000&&resume.wall<=due+600000);
 // Production resume callback may run before the passive observer in the same native event.
 // Require actual claimed times well after due and within 1000ms of resume observation or later.
 for(const r of [accepted,skipped]){
  assert.equal(r.due,due);assert(Number.isSafeInteger(r.claimedAt)&&r.claimedAt>due&&r.claimedAt>=resume.wall-1000,'no fabricated claim during actual sleep');
 }
 assert(accepted.taskId&&accepted.turnId&&accepted.status==='completed');
 assert(Number.isSafeInteger(accepted.startedAt)&&accepted.startedAt>=resume.wall-1000,'no task start during physical sleep');
 assert.equal(skipped.status,'skipped');assert.equal(skipped.taskId,null);assert.equal(skipped.turnId,null);
 return {nativeEventOrderToleranceMs:1000};
}
