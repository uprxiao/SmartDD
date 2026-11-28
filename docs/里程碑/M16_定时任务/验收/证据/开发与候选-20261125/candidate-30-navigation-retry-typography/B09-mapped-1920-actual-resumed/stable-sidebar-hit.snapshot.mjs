import assert from 'node:assert/strict';
// An async DOM/layout race is not a new click authorization: maintain exact
// unique hit-tested UI target, independently verify owned native clearance,
// and discard a candidate whenever the actual center changes.
const same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
const valid=p=>p===null||Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&Number.isInteger(p.x)&&Number.isInteger(p.y);
export async function stableSidebarHit({sample,clear,move,pause,now=Date.now,events=[],budgetMs=8000,stableMs=250}){
 const deadline=now()+budgetMs;let previous=null,stableSince=0,count=0,moved=null,blockedSince=null;
 while(now()<deadline){
  const q=await sample();assert(valid(q),'Invalid actual sidebar hit');
  if(!q||!same(q,previous)){if(previous)events.push({kind:'candidate-discarded',previous,actual:q,at:now()});previous=q;stableSince=now();count=q?1:0;}
  else count++;
  if(!q||count<3||now()-stableSince<stableMs){await pause(60);continue;}
  // Main-process guard checks the exact root/shell and visible native overlap.
  const native=await clear(q);assert(typeof native==='boolean');
  if(!native){blockedSince??=now();if(now()-blockedSince>=1500)throw Error('Actual owned sidebar target native occlusion');await pause(60);continue;}
  blockedSince=null;
  const fresh=await sample();assert(valid(fresh));
  if(!same(fresh,q)){events.push({kind:'discard-after-native-clear',previous:q,actual:fresh,at:now()});previous=fresh;stableSince=now();count=fresh?1:0;await pause(60);continue;}
  if(!same(moved,q)){
   // Real pointer positioning may itself change :hover layout. No press until
   // the same exact target and point survive a second stability/native check.
   await move(q);moved=q;previous=null;count=0;events.push({kind:'actual-pointer-positioned-reobserve',point:q,at:now()});continue;
  }
  events.push({kind:'verified-final-actual-sidebar-hit',point:q,stableSamples:count,stableMs:now()-stableSince,at:now()});return q;
 }
 throw Error('Actual sidebar target geometry/visibility not stable; no mouse press dispatched');
}
