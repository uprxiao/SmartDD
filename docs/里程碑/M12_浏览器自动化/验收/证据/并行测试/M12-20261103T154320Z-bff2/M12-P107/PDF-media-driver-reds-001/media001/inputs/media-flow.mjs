// Original source035 media-formats-ui.mjs full15 business loop; private lifecycle/persistence adapter only.
import assert from'node:assert/strict';import{writeFile}from'node:fs/promises';import{join,basename}from'node:path';import{pause}from'./driver-source/scripts/lib/electron-harness.mjs';import{pngFirstPixel}from'./png-first-pixel.mjs';import{sha}from'./io.mjs';
export async function runMediaAcceptance({actual,ui,result,oracle,scratch,fingerprints,persist,screenshot,openFile,changeStage}){
const app={evaluate:(...x)=>actual.evaluate(...x),waitFor:(...x)=>actual.waitFor(...x),invoke:(...x)=>actual.invoke(...x),get rendererErrors(){return actual.rendererErrors},click:(...x)=>ui.click(...x),open:openFile,screenshot:path=>screenshot(basename(path)),cdp:async(method,params,...rest)=>{const value=await actual.cdp(method,params,...rest);if(method.startsWith('Input.')||method==='Emulation.setTouchEmulationEnabled'){result.actions.push({kind:'original-media-cdp',method,type:params?.type,button:params?.button,buttons:params?.buttons,enabled:params?.enabled,at:new Date().toISOString()});await persist();}return value}};
const markStage=async name=>{changeStage(name);await persist()};let touchEnabled=false,primaryError;
const restoreObserver=()=>app.evaluate("(()=>{const s=window.__mediaObservation;if(s){for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])s.seek.removeEventListener(type,s.onPointer);s.media.removeEventListener('play',s.onPlay);}delete window.__mediaObservation;return !window.__mediaObservation})()");
const point=async(selector,fraction=.5)=>app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width*${fraction},y:r.y+r.height/2}})()`);
const mouse=async(type,p)=>app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});result.compositorImages=[];
try{
 for(const item of oracle.cases){
  await markStage(item.name);await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.fw-media-view'))");
  await app.waitFor("Boolean(document.querySelector('.fw-media-view [role=alert]'))||Boolean(document.querySelector('.fw-media-view button[aria-label=播放]:not(:disabled)'))",20000);
  const state=await app.evaluate("(()=>{const m=document.querySelector('.fw-media-view audio,.fw-media-view video');window.__m9MediaChecked=m;return{tag:m.tagName,controls:m.controls,hidden:m.hidden,readyState:m.readyState,duration:Number.isFinite(m.duration)?m.duration:null,width:m.videoWidth??null,height:m.videoHeight??null,transport:m.dataset.mediaTransport,retryAvailable:Boolean(document.querySelector('.fw-media-view [role=alert] button:not(:disabled)')),error:document.querySelector('.fw-media-view [role=alert]')?.textContent??null}})()");
  const check={file:item.name,expectedKind:item.kind,invalid:Boolean(item.invalid),unsupportedCodec:Boolean(item.unsupportedCodec),encodedStreams:item.streams??[],state};
  result.currentCheck=check;
  assert.equal(state.tag,item.kind.toUpperCase());assert.equal(state.controls,false);if(item.kind==='audio')assert(state.hidden);
  if(state.error){
   assert.match(state.error,/无法播放|解码失败|格式或编码不受支持/);assert(!state.error.includes('超时'));
   assert(await app.evaluate("document.querySelector('.fw-media-view button[aria-label=播放]').disabled"));
   assert.equal(await app.evaluate("window.__m9MediaChecked.getAttribute('src')"),null);check.explicitUnsupportedOrInvalid=true;
  }else{
   assert(!item.invalid&&!item.unsupportedCodec);assert(state.duration>7&&state.duration<10);assert.equal(state.transport,'protocol');
   if(item.kind==='video'){assert.equal(state.width,320);assert.equal(state.height,180)}
   await app.click('.fw-media-view button[aria-label=播放]');await app.waitFor('!window.__m9MediaChecked.paused&&window.__m9MediaChecked.currentTime>.08');
   check.playingTime=await app.evaluate('window.__m9MediaChecked.currentTime');
   await app.click('.fw-media-view button[aria-label=暂停]');await app.waitFor('window.__m9MediaChecked.paused');
   const seek=await point('.fw-media-seek',.6);await mouse('mousePressed',seek);await mouse('mouseReleased',seek);
   await app.waitFor('window.__m9MediaChecked.currentTime>3');assert(await app.evaluate('window.__m9MediaChecked.paused'));check.pausedSeekTime=await app.evaluate('window.__m9MediaChecked.currentTime');check.pausedAfterSeek=await app.evaluate('window.__m9MediaChecked.paused');
   await app.click('.fw-media-view button[aria-label=播放]');await app.waitFor('!window.__m9MediaChecked.paused');
   const drag=await point('.fw-media-seek',.4);await mouse('mousePressed',drag);await app.waitFor('window.__m9MediaChecked.paused');const dragEnd=await point('.fw-media-seek',.45);await mouse('mouseMoved',dragEnd);await mouse('mouseReleased',dragEnd);await app.waitFor('!window.__m9MediaChecked.paused');check.dragGeometry={start:drag,end:dragEnd};
   check.dragPausedAndResumed=true;check.seekStep=await app.evaluate("document.querySelector('.fw-media-seek').step");assert.equal(check.seekStep,'0.1');
   check.displayTime=await app.evaluate("document.querySelector('.fw-media-time').textContent");
   if(item.kind==='video'){
    await app.waitFor('window.__m9MediaChecked.getVideoPlaybackQuality().totalVideoFrames>0');
    check.actualVideoFrames=await app.evaluate('window.__m9MediaChecked.getVideoPlaybackQuality().totalVideoFrames');
    // The opaque media protocol is cross-origin. Read compositor screenshots,
    // preserving the real canvas security boundary instead of bypassing it.
    const clips=await app.evaluate("(()=>{const r=window.__m9MediaChecked.getBoundingClientRect();return [.2,.4,.6,.8].map(f=>({x:Math.floor(r.x+r.width*f),y:Math.floor(r.y+r.height/2),width:1,height:1,scale:1}))})()");
    check.compositorPixels=[];
    for(let index=0;index<clips.length;index++){const {data}=await app.cdp('Page.captureScreenshot',{format:'png',clip:clips[index]}),bytes=Buffer.from(data,'base64');check.compositorPixels.push(pngFirstPixel(bytes));await writeFile(join(scratch,`${item.name}-frame-${index}.png`),bytes,{mode:0o600});result.compositorImages.push({file:`${item.name}-frame-${index}.png`,sha256:sha(bytes),clip:clips[index]})}
    assert(check.compositorPixels.some(pixel=>pixel.slice(0,3).some(v=>v>30)),'No actual colored video pixels');
    if(item.name==='video.mp4'){
     await app.evaluate("(()=>{const seek=document.querySelector('.fw-media-seek'),media=window.__m9MediaChecked,s={seek,media,rows:[],plays:0};s.onPointer=e=>s.rows.push({type:e.type,id:e.pointerId,trusted:e.isTrusted});s.onPlay=()=>s.plays++;for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])seek.addEventListener(type,s.onPointer);media.addEventListener('play',s.onPlay);window.__mediaObservation=s;return true})()");
     await app.cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});touchEnabled=true;
     check.cancelChecks=[];
     for(const wasPlaying of [true,false]){
      const paused=await app.evaluate('window.__m9MediaChecked.paused');
      if(paused===wasPlaying)await app.click(`.fw-media-view button[aria-label=${wasPlaying?'播放':'暂停'}]`);
      await app.waitFor(`window.__m9MediaChecked.paused===${!wasPlaying}`);
      const before=await app.evaluate('window.__mediaObservation.plays'),p=await point('.fw-media-seek',.35);
      await app.cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await app.waitFor('window.__m9MediaChecked.paused');
      await app.cdp('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await app.waitFor(`window.__m9MediaChecked.paused===${!wasPlaying}`);await pause(100);
      const resumeCount=await app.evaluate('window.__mediaObservation.plays')-before;assert.equal(resumeCount,wasPlaying?1:0);
      check.cancelChecks.push({wasPlaying,resumeCount});
     }
     await app.cdp('Emulation.setTouchEmulationEnabled',{enabled:false});touchEnabled=false;check.cancelEvents=await app.evaluate('window.__mediaObservation.rows');check.observerRestored=await restoreObserver();
     assert(check.cancelEvents.some(e=>e.type==='pointercancel'));assert(check.cancelEvents.some(e=>e.type==='lostpointercapture'));assert(check.cancelEvents.every(e=>e.trusted));
    }
   }
  }
  await app.screenshot(join(scratch,item.name+'.png'));await app.click(`[aria-label=${JSON.stringify('关闭 '+item.name)}]`);
  await app.waitFor("!document.querySelector('.fw-media-view')&&window.__m9MediaChecked.paused&&window.__m9MediaChecked.getAttribute('src')===null&&!window.__m9MediaChecked.isConnected");
  check.afterClose=await app.evaluate('({paused:window.__m9MediaChecked.paused,src:window.__m9MediaChecked.getAttribute("src"),connected:window.__m9MediaChecked.isConnected})');check.closedDetachedPausedAndSourceCleared=true;result.checks.push(check);delete result.currentCheck;await persist();
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.caseResults={F22:'passed',F23:'passed'};
 result.boundary='Real encoded codecs are probed independently and measured in packaged Chromium. Successful formats play/pause/seek and resume after pointer drag. Decode failures are explicit, not treated as playback support. No audible fidelity, system output device, native save/clipboard/PiP/fullscreen or full pixel claim. Closing reads the actual detached media node cleanup; native capability revocation is separately tested at I.';
await persist();
}catch(error){primaryError=error;throw error}finally{try{if(touchEnabled)await app.cdp('Emulation.setTouchEmulationEnabled',{enabled:false});result.mediaObserverRestored=await restoreObserver();await app.evaluate('delete window.__m9MediaChecked;true');}catch(error){result.mediaObserverRestorationFailure={name:error.name,message:error.message};if(!primaryError)throw error;}}
}
