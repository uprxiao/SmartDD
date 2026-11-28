// Private diagnostic-only timing and numeric/identity validation. No App access here.
import assert from 'node:assert/strict';
export const FIRST_IDLE_SECONDS=Object.freeze([15,60,180,295]);
export const SECOND_IDLE_SECONDS=Object.freeze([15,60]);
export const MIN_FIRST_IDLE_SECONDS=300;
export const MAX_DIAGNOSTIC_SECONDS=480;
export const WATCHDOG_SECONDS=720;
const NS=1000000000n;
const numeric=(value,keys,label)=>{
 assert(value&&typeof value==='object'&&!Array.isArray(value),label+' unavailable');
 return Object.fromEntries(keys.map(k=>{const v=value[k];assert(Number.isSafeInteger(v)&&v>=0,label+' nonnumeric '+k);return [k,v];}));
};
export function normalizeMainHeap(value){return numeric(value,['rss','heapUsed','heapTotal','external','arrayBuffers'],'actual own main numeric heap');}
export function normalizeShellHeap(value){return numeric(value,['usedSize','totalSize','embedderHeapUsedSize','backingStorageSize'],'actual trusted shell numeric heap');}
const setRows=s=>s.finalIdentityRoles.map(x=>[x.pid,x.birth,x.role,x.pathClass]).sort((a,b)=>a[0]-b[0]);
export function assertSameClosedScope(s,baseline=s){
 assert(s&&baseline&&s.closed&&baseline.closed,'diagnostic owned scope must be closed');
 assert(s.scopeApproved===false&&baseline.scopeApproved===false,'never formal scope approval');
 assert(s.finalIdentitySet.length===s.netLive&&baseline.finalIdentitySet.length===baseline.netLive);
 assert.equal(new Set(s.finalIdentitySet).size,s.netLive);assert.equal(new Set(baseline.finalIdentitySet).size,baseline.netLive);
 assert.equal(s.finalIdentityRoles.length,s.netLive);assert.equal(baseline.finalIdentityRoles.length,baseline.netLive);
 for(const row of s.finalIdentityRoles)assert(s.finalIdentitySet.includes(row.pid+':'+row.birth),'exact current owned role/identity');
 assert.deepEqual([...s.finalIdentitySet].sort(),[...baseline.finalIdentitySet].sort(),'same exact diagnostic PID/birth set required; no comparison across identities');
 assert.deepEqual(setRows(s),setRows(baseline),'same exact owned diagnostic role and path required');
 return true;
}
function owner(s,pid){const matches=s.finalIdentityRoles.filter(q=>q.pid===pid&&q.role==='product');assert.equal(matches.length,1,'actual numeric owner not uniquely bound to product scope');return matches[0];}
function ownMain(row,expectedMainPid,expectedShellUrl){
 assert(row&&row.mainPid===expectedMainPid,'own main numeric PID changed');
 assert(Number.isSafeInteger(row.shellRoot)&&row.shellRoot>0&&Number.isSafeInteger(row.shellWc)&&row.shellWc>0&&Number.isSafeInteger(row.shellPid)&&row.shellPid>0&&row.shellPid!==row.mainPid,'own shell identity missing');
 assert.equal(row.shellUrl,expectedShellUrl);assert.equal(row.shellLoading,false);
 return {mainPid:row.mainPid,shellRoot:row.shellRoot,shellWc:row.shellWc,shellPid:row.shellPid,mainHeap:normalizeMainHeap(row.mainHeap)};
}
export async function numericObservation({label,baseline,scope,readMain,readTarget,readShell,clockNs,anchorNs,idleAnchorNs=null,plannedOffsetSeconds=null,expectedMainPid,expectedShellUrl}){
 const before=await scope(label+'-before-numeric');assertSameClosedScope(before,baseline);
 const began=clockNs(),first=ownMain(await readMain(),expectedMainPid,expectedShellUrl);
 const mainOwner=owner(before,first.mainPid),shellOwner=owner(before,first.shellPid);
 assert.equal(mainOwner.pathClass,'candidate/Contents/MacOS/WillYou');
 assert(shellOwner.pathClass.includes('/WillYou Helper (Renderer).app/Contents/MacOS/WillYou Helper (Renderer)'), 'expected own trusted shell renderer path');
 assert.equal(await readTarget(),expectedShellUrl,'bound trusted CDP target changed');
 const shellHeap=normalizeShellHeap(await readShell());
 const finish=ownMain(await readMain(),expectedMainPid,expectedShellUrl),ended=clockNs();
 assert.deepEqual([finish.mainPid,finish.shellRoot,finish.shellWc,finish.shellPid],[first.mainPid,first.shellRoot,first.shellWc,first.shellPid],'exact own shell identity changed while observing numeric heap');
 const after=await scope(label+'-after-numeric');assertSameClosedScope(after,baseline);
 assert.deepEqual(owner(after,first.mainPid),mainOwner);assert.deepEqual(owner(after,first.shellPid),shellOwner);
 const secs=x=>Number(x)/1e9;
 return {label,plannedOffsetSeconds,actualObservationStartSeconds:secs(began-anchorNs),actualObservationEndSeconds:secs(ended-anchorNs),actualIdleStartSeconds:idleAnchorNs===null?null:secs(began-idleAnchorNs),actualIdleEndSeconds:idleAnchorNs===null?null:secs(ended-idleAnchorNs),numericObserverSeconds:secs(ended-began),beforeScope:before,afterScope:after,observerRssDeltaBytes:after.rssTotalBytes-before.rssTotalBytes,mainOwner:{pid:mainOwner.pid,birth:mainOwner.birth},shellOwner:{pid:shellOwner.pid,birth:shellOwner.birth,rootId:first.shellRoot,wcId:first.shellWc},numericHeap:{mainBefore:first.mainHeap,mainAfter:finish.mainHeap,shell:shellHeap},formalEligible:false,scopeApproved:false};
}
export async function waitUntilNs(targetNs,{clockNs,pause,guard}){
 while(true){guard();const remaining=targetNs-clockNs();if(remaining<=0n)return;await pause(Math.min(500,Math.max(1,Math.ceil(Number(remaining)/1e6))));}
}
export async function runMemoryPhase({clockNs,pause,guard,observe,executeRound}){
 const anchorNs=clockNs(),phaseGuard=()=>{guard();assert(clockNs()-anchorNs<=BigInt(MAX_DIAGNOSTIC_SECONDS)*NS,'diagnostic time budget exceeded; never extend or repeat a command');};
 const record=async(label,idleAnchorNs=null,plannedOffsetSeconds=null)=>{phaseGuard();await observe({label,anchorNs,idleAnchorNs,plannedOffsetSeconds});phaseGuard();};
 const delay=async(idleAnchorNs,offset)=>waitUntilNs(idleAnchorNs+BigInt(offset)*NS,{clockNs,pause,guard:phaseGuard});
 await record('round-1-pre');
 const r1=await executeRound(1,phaseGuard);phaseGuard();
 assert(typeof r1==='bigint'&&r1>=anchorNs&&r1<=clockNs(),'actual first round monotonic terminal time');
 await record('round-1-post',r1,0);
 for(const offset of FIRST_IDLE_SECONDS){await delay(r1,offset);await record('round-1-idle-'+offset,r1,offset);}
 await delay(r1,MIN_FIRST_IDLE_SECONDS);await record('round-2-pre',r1,MIN_FIRST_IDLE_SECONDS);
 const round2StartNs=clockNs();assert(round2StartNs-r1>=BigInt(MIN_FIRST_IDLE_SECONDS)*NS,'actual natural first idle must be >=300 seconds');
 const r2=await executeRound(2,phaseGuard);phaseGuard();assert(typeof r2==='bigint'&&r2>=round2StartNs&&r2<=clockNs(),'actual second round monotonic terminal time');
 await record('round-2-post',r2,0);
 for(const offset of SECOND_IDLE_SECONDS){await delay(r2,offset);await record('round-2-idle-'+offset,r2,offset);}
 phaseGuard();
 return {firstTrueIdleSeconds:Number(round2StartNs-r1)/1e9,elapsedSeconds:Number(clockNs()-anchorNs)/1e9,firstIdleObservationPlanSeconds:[...FIRST_IDLE_SECONDS],secondIdleObservationPlanSeconds:[...SECOND_IDLE_SECONDS],formalEligible:false,scopeApproved:false,formalCasePassCandidate:false};
}
