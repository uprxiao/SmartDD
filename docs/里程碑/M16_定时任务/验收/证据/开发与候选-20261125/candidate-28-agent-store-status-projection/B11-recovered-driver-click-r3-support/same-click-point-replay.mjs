// Offline replay only. Historical point sequences and native stacks are
// preserved inputs. Continued observations are labelled synthetic controls.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {nativeClearAtPoint,stableClickPoint} from './same-click-point.mjs';

const base=dirname(fileURLToPath(import.meta.url));
const history='/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125';
const c28Path=join(base,'run-HZurDd/result.json');
const c22Path=join(history,'candidate-22-notification-ownership-and-cold-paint/B11-exact-UID-XPC-early-scope-click-guard/index.json');
const c27Path=join(history,'candidate-27-schedule-active-query-reuse/B11-real-1800s-recheck/archive-safe/result.json.gz');
const c28Raw=readFileSync(c28Path),c22Raw=readFileSync(c22Path),c27Raw=readFileSync(c27Path);
const c28=JSON.parse(c28Raw),c22=JSON.parse(c22Raw),c27=JSON.parse(gunzipSync(c27Raw));
const sha=v=>createHash('sha256').update(v).digest('hex');
const tested=[];
const check=async(name,fn)=>{await fn();tested.push(name)};
const rejects=async(name,fn,reason)=>check(name,()=>assert.rejects(fn,reason));
const extractDrift=error=>{
 const match=/\+\s*x:\s*(\d+),\s*\n-\s*x:\s*(\d+),\s*\n\s*y:\s*(\d+)/.exec(error);
 assert(match,'retained original mismatch missing');
 return {before:{x:Number(match[2]),y:Number(match[3])},after:{x:Number(match[1]),y:Number(match[3])}};
};
const drift28=extractDrift(c28.error),drift22=extractDrift(c22.check.error);
assert.deepEqual(drift28,drift22);
const ownSemantic=JSON.stringify({query:'[aria-label="网页地址"]',taskId:'isolated-task',pageId:'isolated-page',tag:'INPUT'});
const target=(point,semantic=ownSemantic)=>({point,semantic});
const recordedNative=c28.windowsBeforeQuit;
const recordedMenu=c27.menuHitTests;
const c27Address=c27.actions.filter(a=>a.selector==='[aria-label="网页地址"]');
const c28Address=c28.actions.filter(a=>a.selector==='[aria-label="网页地址"]');
assert.equal(c27Address.length,5);assert.equal(c28Address.length,3);
const events=[];
function simulation(points,native=recordedNative,{timeoutMs=800,occlusionMs=150}={}){
 let ti=0,ni=0,clock=0;
 const readTarget=async()=>{
  const p=points[Math.min(ti++,points.length-1)];
  events.push({event:'dom',point:p?.point??null});
  return p;
 };
 const readNative=async()=>{
  events.push({event:'native'});
  return Array.isArray(native[0])?native[Math.min(ni++,native.length-1)]:native;
 };
 const hover=async p=>events.push({event:'mouseMoved',point:p});
 return stableClickPoint({readTarget,readNative,hover,pause:async ms=>{clock+=ms;},now:()=>clock,timeoutMs,occlusionMs});
}
function reset(){events.length=0}
const oldPoint=target(drift28.before),newPoint=target(drift28.after);
await check('C28 retained immediate x1094→1080 mismatch reacquires and validates fresh point',async()=>{
 reset();
 const result=await simulation([oldPoint,newPoint,newPoint]);
 assert.deepEqual(result.point,drift28.after);
 assert.equal(result.retries[0].phase,'before-native-point-changed');
 assert.deepEqual(result.retries[0].from,drift28.before);assert.deepEqual(result.retries[0].to,drift28.after);
 assert(events.filter(e=>e.event==='mouseMoved').every(e=>e.point.x===1080));
 assert.equal(events.at(-1).event,'dom');assert.equal(events.at(-2).event,'native');
});
await check('C22 retained post-native x1094→1080 mismatch repeats complete target/native guard',async()=>{
 reset();
 const result=await simulation([oldPoint,oldPoint,newPoint,newPoint]);
 assert.deepEqual(result.point,drift22.after);
 assert.equal(result.retries[0].phase,'after-native-point-changed');
 assert(events.filter(e=>e.event==='native').length>=3);
 assert(events.filter(e=>e.event==='mouseMoved').every(e=>e.point.x===1080));
});
await check('C27 five actual successful address points and five recorded clear native menu stacks',async()=>{
 assert.equal(recordedMenu.length,5);
 for(let i=0;i<5;i++){
  const record=recordedMenu[i],point=c27Address[i].point;
  assert.deepEqual(point,drift28.after);
  assert.equal(nativeClearAtPoint(record.native,record.point).clear,true);
  reset();
  // Actual C27 address click points, backed by the adjacent recorded native
  // menu stack; repeat observations are a synthetic guard replay control.
  const result=await simulation([target(point)],record.native);
  assert.deepEqual(result.point,point);assert.equal(result.attempts,1);
 }
});
await check('C28 preceding three successful actual address points remain valid',async()=>{
 for(const action of c28Address){
  assert.deepEqual(action.point,drift28.after);
  const result=await simulation([target(action.point)]);
  assert.deepEqual(result.point,action.point);
 }
});
const blocked=structuredClone(recordedNative);
blocked[0].children.push({id:999,url:'http://127.0.0.1:3425/owned-test',visible:true,bounds:{x:1000,y:50,width:200,height:100}});
const hiddenBlock=structuredClone(blocked);hiddenBlock[0].children.at(-1).visible=false;
await check('hidden native view does not obscure the current point',async()=>assert(nativeClearAtPoint(hiddenBlock,drift28.after).clear));
await rejects('persistently overlapping native view blocks every click',async()=>{
 reset();await simulation([newPoint],blocked);
},error=>error.reason==='native-occlusion'&&events.every(e=>e.event!=='mouseMoved'));
await rejects('same coordinate with changed semantic task/page identity is forbidden',()=>simulation([newPoint,target(drift28.after,'different-task-page')]),error=>error.reason==='target-changed');
await rejects('no unique visible actual target is bounded and sends no input',async()=>{
 reset();await simulation([null]);
},error=>error.reason==='target-timeout'&&events.every(e=>e.event!=='mouseMoved'));
await rejects('native shell hidden',()=>simulation([newPoint],recordedNative.map(w=>({...w,visible:false}))),/not visible/);
await rejects('native shell minimized',()=>simulation([newPoint],recordedNative.map(w=>({...w,minimized:true}))),/not visible/);
await rejects('native shell identity changed despite unchanged coordinates',()=>{
 const changed=structuredClone(recordedNative);
 changed[0].children.find(c=>/\/out\/renderer\/index\.html/.test(c.url)).id=98765;
 return simulation([newPoint],[recordedNative,changed]);
},error=>error.reason==='shell-changed');
await rejects('point outside native shell bounds',()=>simulation([target({x:9999,y:70})]),/outside the shell bounds/);
await check('hover geometry drift triggers fresh target and native clearance checks',async()=>{
 reset();
 const result=await simulation([oldPoint,oldPoint,oldPoint,newPoint,newPoint]);
 assert.deepEqual(result.point,drift28.after);
 assert.equal(result.retries[0].phase,'hover-point-changed');
 assert.deepEqual(events.filter(e=>e.event==='mouseMoved').map(e=>e.point),[drift28.before,drift28.after]);
 assert.equal(events.at(-1).event,'dom');assert.equal(events.at(-2).event,'native');
});
await rejects('native overlap appearing after hover cannot authorize press',()=>{
 reset();return simulation([newPoint],[recordedNative,blocked]);
},error=>error.reason==='native-occlusion');
await rejects('repeated unstable coordinates never authorize a click',()=>{
 const points=Array.from({length:50},(_,i)=>i%2?newPoint:oldPoint);
 reset();return simulation(points);
},error=>error.reason==='target-timeout'&&events.every(e=>e.event!=='mouseMoved'));
await rejects('duplicate real shell identities are refused',()=>{
 const multiple=structuredClone(recordedNative);multiple.push(structuredClone(recordedNative[0]));
 return simulation([newPoint],multiple);
},/unique actual shell/);

// Compile and execute the actual DOM expression from the current driver,
// against a small synthetic DOM. This verifies the real selector/owner/hit/
// focus guard, rather than an independently reimplemented predicate.
const require=createRequire(import.meta.url),ts=require('typescript');
const source=ts.createSourceFile('run.mjs',readFileSync(join(base,'run.mjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let actualExpression;
function walk(node){
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='readShellTarget'){
  function find(part){
   if(ts.isCallExpression(part)&&part.expression.getText(source)==='js'&&ts.isArrowFunction(part.arguments[0]))actualExpression=part.arguments[0].getText(source);
   ts.forEachChild(part,find);
  }
  find(node);
 }
 ts.forEachChild(node,walk);
}
walk(source);assert(actualExpression,'actual driver DOM predicate absent');
function domControl({currentTask='owned-task',currentPage='owned-page',expectedTask='owned-task',expectedPage='owned-page',active=true,blocked=false,duplicate=false,disabled=false,focusRequired=false}={}){
 const workspace={dataset:{browserTask:currentTask,browserPage:currentPage}};
 const node={isConnected:true,tagName:'INPUT',getBoundingClientRect:()=>({x:1000,y:60,width:160,height:20}),matches:()=>disabled,getAttribute:k=>k==='aria-label'?'网页地址':null,closest:s=>s==='.bw-workspace'?workspace:null,scrollIntoView(){},contains:hit=>hit===node};
 const doc={querySelectorAll:()=>duplicate?[node,node]:[node],elementFromPoint:()=>blocked?{}:node,activeElement:active?node:{}};
 const fn=runInNewContext('('+actualExpression+')',{document:doc});
 return fn('[aria-label="网页地址"]',null,{taskId:expectedTask,pageId:expectedPage},focusRequired);
}
await check('actual driver DOM predicate verifies current exact task/page, unique hit and point',()=>{
 const actual=domControl();assert.deepEqual(JSON.parse(JSON.stringify(actual.point)),drift28.after);
 const identity=JSON.parse(actual.semantic);assert.equal(identity.taskId,'owned-task');assert.equal(identity.pageId,'owned-page');
});
await check('actual driver DOM predicate rejects a different browser task or page',()=>{
 assert.equal(domControl({currentTask:'other-task'}),null);
 assert.equal(domControl({currentPage:'other-page'}),null);
});
await check('actual driver DOM predicate rejects disabled, duplicate and obscured targets',()=>{
 for(const options of [{disabled:true},{duplicate:true},{blocked:true}])assert.equal(domControl(options),null);
});
await check('actual keyboard-input predicate requires same active field and page',()=>{
 assert.equal(domControl({active:false,focusRequired:true}),null);
 assert.equal(domControl({currentPage:'other-page',focusRequired:true}),null);
 assert(domControl({focusRequired:true}));
});

const result={staticOnly:true,originalC28:{source:c28Path,sha256:sha(c28Raw),drift:drift28,originalFailedBeforeInput:true,successfulPriorAddressClicks:c28Address.length,requestPaths:c28.requests.map(r=>r.path),productNormalExit:c28.exit},originalC22:{source:c22Path,sha256:sha(c22Raw),drift:drift22,previousFailed:true},originalC27:{source:c27Path,sha256:sha(c27Raw),successfulAddressPoints:c27Address.map(x=>x.point),recordedNativeMenuChecks:recordedMenu.length},boundary:'Replay uses retained actual mismatch coordinates, historical stable points and native window stacks. Subsequent DOM sample sequences are synthetic offline controls, not a new real UI pass.',tests:tested,passed:tested.length,failed:0};
writeFileSync(join(base,'same-click-point-replay.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:tested.length,failed:0,C28OriginalDrift:drift28,C22OriginalDrift:drift22,C27ActualStableAddressPoints:c27Address.length}));
