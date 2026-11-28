import assert from 'node:assert/strict';
// The existing passive AppKit observer samples at about 100ms. Reject stale,
// omitted or non-own samples, not merely a last positive process ID.
export function frontStable(samples,now,ms=500){
 const q=samples.filter(x=>x.at>=now-ms-150);if(q.length<Math.max(2,Math.floor(ms/150)))return false;
 if(q.at(-1).at>now+50||now-q.at(-1).at>350||q[0].at>now-ms+150||q.some(x=>!x.own))return false;
 return q.slice(1).every((x,i)=>x.at>q[i].at&&x.at-q[i].at<=350);
}
export function contextBeforeEvent(last,event,wc){
 return !!(last?.c?.ok&&last.f?.wc===wc&&last.f.focused&&last.f.visible&&!last.f.minimized&&event?.ownerFocused&&event.wc===wc&&Number.isFinite(event.at)&&Number.isFinite(last.at)&&event.at>=last.at-25&&event.at-last.at<=350);
}
