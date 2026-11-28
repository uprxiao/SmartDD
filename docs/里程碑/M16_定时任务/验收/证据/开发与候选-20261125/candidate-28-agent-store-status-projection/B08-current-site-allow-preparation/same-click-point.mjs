// Bounded fresh DOM target and native z-order check for the same actual point.
// The helper never sends a click. Its optional hover runs only on a verified
// point; the returned point has been checked again after that hover.
import assert from 'node:assert/strict';

const validPoint = point => Number.isSafeInteger(point?.x) && Number.isSafeInteger(point?.y);
const samePoint = (a,b) => Boolean(a&&b&&a.point.x===b.point.x&&a.point.y===b.point.y);
const inside = (point,rect) => point.x>=rect.x&&point.x<rect.x+rect.width&&point.y>=rect.y&&point.y<rect.y+rect.height;

export function nativeClearAtPoint(views,point) {
  assert(validPoint(point),'invalid actual DOM point');
  const matches=views.flatMap(w=>w.children.flatMap((c,index)=>
    /\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url)?[{window:w,child:c,index}]:[]));
  assert.equal(matches.length,1,'unique actual shell');
  const {window,child,index}=matches[0];
  assert(window.visible&&!window.minimized&&child.visible!==false,'isolated shell root is not visible');
  assert(inside(point,child.bounds),'actual DOM point outside the shell bounds');
  const shellIdentity={windowId:window.id,webContentsId:child.id,url:child.url};
  const occlusion=window.children.slice(index+1).filter(c=>c.visible!==false&&inside(point,c.bounds));
  return {clear:occlusion.length===0,occlusion,shellIdentity,native:views};
}

export class ClickGuardError extends Error {
  constructor(reason,message,evidence) {
    super(message);
    this.name='ClickGuardError';
    this.reason=reason;
    this.evidence=evidence;
  }
}

export async function stableClickPoint({
  readTarget,readNative,hover=async()=>{},pause,now=()=>Date.now(),
  timeoutMs=8000,occlusionMs=1500,
}) {
  const started=now(),deadline=started+timeoutMs;
  let targetIdentity=null,shellIdentity=null,blockedSince=null,blockedPoint=null,attempts=0,lastNative=null,lastTarget=null;
  const retries=[];
  const evidence=()=>({attempts,retries,elapsedMs:now()-started,point:lastTarget?.point??null,targetIdentity,shellIdentity,native:lastNative?.native??null,occlusion:lastNative?.occlusion??[]});
  const fail=(reason,message)=>{throw new ClickGuardError(reason,message,evidence())};
  const read=async()=> {
    const target=await readTarget();
    if(!target)return null;
    assert(validPoint(target.point)&&typeof target.semantic==='string'&&target.semantic.length>0,'invalid real DOM target observation');
    if(targetIdentity!==null&&target.semantic!==targetIdentity)fail('target-changed','same semantic DOM control identity changed');
    targetIdentity=target.semantic;
    lastTarget=target;
    return target;
  };
  const nativeAt=async point=>{
    const observation=nativeClearAtPoint(await readNative(),point);
    if(shellIdentity!==null){
      if(JSON.stringify(observation.shellIdentity)!==JSON.stringify(shellIdentity))fail('shell-changed','isolated shell native identity changed');
    }else shellIdentity=observation.shellIdentity;
    lastNative=observation;
    if(observation.clear){blockedSince=null;blockedPoint=null;return true}
    const key=point.x+','+point.y;
    if(blockedPoint!==key){blockedPoint=key;blockedSince=now();}
    if(now()-blockedSince>=occlusionMs)fail('native-occlusion','actual shell point remained obstructed by a native view');
    return false;
  };
  const retry=async(phase,a,b)=>{
    retries.push({phase,from:a?.point??null,to:b?.point??null,atMs:now()-started});
    if(!phase.includes('occluded')){blockedSince=null;blockedPoint=null;}
    await pause(60);
  };
  while(now()<deadline){
    attempts++;
    const first=await read();
    if(!first){await retry('no-unique-visible-target',null,null);continue}
    const second=await read();
    if(!samePoint(first,second)){await retry('before-native-point-changed',first,second);continue}
    if(!await nativeAt(first.point)){await retry('native-point-occluded',first,second);continue}
    const afterNative=await read();
    if(!samePoint(first,afterNative)){await retry('after-native-point-changed',first,afterNative);continue}
    // Moving the pointer is not the accepted click. A hover can itself affect
    // layout, so all dependent press/release input waits for another full check.
    await hover(first.point);
    const afterHover=await read();
    if(!samePoint(first,afterHover)){await retry('hover-point-changed',first,afterHover);continue}
    if(!await nativeAt(first.point)){await retry('hover-native-point-occluded',first,afterHover);continue}
    const beforePress=await read();
    if(!samePoint(first,beforePress)){await retry('before-press-point-changed',first,beforePress);continue}
    if(now()>=deadline)break;
    return {...evidence(),point:first.point};
  }
  fail('target-timeout','no fresh stable same-point DOM and unobstructed native target before timeout');
}
