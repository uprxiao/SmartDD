import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP,projectPath=process.env.SMARTDD_MEDIA_FORMAT_PROJECT;assert(executable&&projectPath);
const fixtureRoot=dirname(projectPath),scratch=await mkdtemp(join(fixtureRoot,'app-run-')),oracle=JSON.parse(await readFile(join(fixtureRoot,'fixtures.json'),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const s=await stat(join(projectPath,name),{bigint:true});return[name,{sha256:sha(await readFile(join(projectPath,name))),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseIds:['M9-T-F22','M9-T-F23'],at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),projectPath,before:await fingerprints(),checks:[],status:'running'};let app,stage='initial';
const point=async(selector,fraction=.5)=>app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width*${fraction},y:r.y+r.height/2}})()`);
const mouse=async(type,p)=>app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Audio/video all-format acceptance'});
 for(const item of oracle.cases){
  stage=item.name;await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.fw-media-view'))");
  await app.waitFor("Boolean(document.querySelector('.fw-media-view [role=alert]'))||Boolean(document.querySelector('.fw-media-view button[aria-label=播放]:not(:disabled)'))",20000);
  const state=await app.evaluate("(()=>{const m=document.querySelector('.fw-media-view audio,.fw-media-view video');window.__m9MediaChecked=m;return{tag:m.tagName,controls:m.controls,hidden:m.hidden,readyState:m.readyState,duration:Number.isFinite(m.duration)?m.duration:null,width:m.videoWidth??null,height:m.videoHeight??null,transport:m.dataset.mediaTransport,error:document.querySelector('.fw-media-view [role=alert]')?.textContent??null}})()");
  const check={file:item.name,expectedKind:item.kind,invalid:Boolean(item.invalid),encodedStreams:item.streams??[],state};
  assert.equal(state.tag,item.kind.toUpperCase());assert.equal(state.controls,false);if(item.kind==='audio')assert(state.hidden);
  if(state.error){
   assert.match(state.error,/无法播放|解码失败|格式或编码不受支持/);assert(!state.error.includes('超时'));
   assert(await app.evaluate("document.querySelector('.fw-media-view button[aria-label=播放]').disabled"));
   assert.equal(await app.evaluate("window.__m9MediaChecked.getAttribute('src')"),null);check.explicitUnsupportedOrInvalid=true;
  }else{
   assert(!item.invalid);assert(state.duration>7&&state.duration<10);assert.equal(state.transport,'protocol');
   if(item.kind==='video'){assert.equal(state.width,320);assert.equal(state.height,180)}
   await app.click('.fw-media-view button[aria-label=播放]');await app.waitFor('!window.__m9MediaChecked.paused&&window.__m9MediaChecked.currentTime>.08');
   check.playingTime=await app.evaluate('window.__m9MediaChecked.currentTime');
   await app.click('.fw-media-view button[aria-label=暂停]');await app.waitFor('window.__m9MediaChecked.paused');
   const seek=await point('.fw-media-seek',.6);await mouse('mousePressed',seek);await mouse('mouseReleased',seek);
   await app.waitFor('window.__m9MediaChecked.currentTime>3');assert(await app.evaluate('window.__m9MediaChecked.paused'));check.pausedSeekTime=await app.evaluate('window.__m9MediaChecked.currentTime');
   await app.click('.fw-media-view button[aria-label=播放]');await app.waitFor('!window.__m9MediaChecked.paused');
   const drag=await point('.fw-media-seek',.4);await mouse('mousePressed',drag);await app.waitFor('window.__m9MediaChecked.paused');await mouse('mouseReleased',drag);await app.waitFor('!window.__m9MediaChecked.paused');
   check.dragPausedAndResumed=true;check.seekStep=await app.evaluate("document.querySelector('.fw-media-seek').step");assert.equal(check.seekStep,'0.1');
   check.displayTime=await app.evaluate("document.querySelector('.fw-media-time').textContent");
   if(item.kind==='video'){
    await app.waitFor('window.__m9MediaChecked.getVideoPlaybackQuality().totalVideoFrames>0');
    check.actualVideoFrames=await app.evaluate('window.__m9MediaChecked.getVideoPlaybackQuality().totalVideoFrames');
    check.framePixel=await app.evaluate("(()=>{const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(window.__m9MediaChecked,0,0,1,1);return [...x.getImageData(0,0,1,1).data]})()");assert.equal(check.framePixel[3],255);
   }
  }
  await app.screenshot(join(scratch,item.name+'.png'));await app.click(`[aria-label=${JSON.stringify('关闭 '+item.name)}]`);
  await app.waitFor("!document.querySelector('.fw-media-view')&&window.__m9MediaChecked.paused&&window.__m9MediaChecked.getAttribute('src')===null&&!window.__m9MediaChecked.isConnected");
  check.closedDetachedPausedAndSourceCleared=true;result.checks.push(check);
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
 result.boundary='Real encoded codecs are probed independently and measured in packaged Chromium. Successful formats play/pause/seek and resume after pointer drag. Decode failures are explicit, not treated as playback support. No audible fidelity, system output device, native save/clipboard/PiP/fullscreen or full pixel claim. Closing reads the actual detached media node cleanup; native capability revocation is separately tested at I.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
