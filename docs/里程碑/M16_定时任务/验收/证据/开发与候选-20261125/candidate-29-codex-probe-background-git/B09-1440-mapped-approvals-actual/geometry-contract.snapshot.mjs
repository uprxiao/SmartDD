import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {support,digest} from '../guards-c29.mjs';
import {geometryVerdict,focusPlan,checkGeometryRecovery} from '../mapped-approvals-1440-internal/geometry-contract.mjs';
export {geometryVerdict,focusPlan};
export function recognizedBackground1440(q,expectedDisplay){return !!(q?.exact&&geometryVerdict(q.native,q.actual,[1440,900],expectedDisplay));}
export function chooseBackgroundTarget(n,locked){
 if(!n?.visible||n.minimized||n.fullScreen||n.shellZoomFactor!==1||!Number.isInteger(n.rootId)||!Number.isInteger(n.shellId))return null;
 const eligible=n.displays.filter(d=>d.bounds.width===1512&&d.bounds.height===982&&d.scaleFactor===2&&d.workArea.width>=1440&&d.workArea.height>=900);
 if(locked!=null)return eligible.find(d=>d.id===locked)??null;
 return eligible.find(d=>d.id===n.actualDisplay?.id)??(eligible.length===1?eligible[0]:null);
}
export async function checkBackgroundGeometry(dir){
 const priorRoot=join(dir,'prior-focus-timeout');
 const oldResult=join(priorRoot,'result.json'),oldProgress=join(priorRoot,'progress.json');
 const previous=JSON.parse(await readFile(oldResult,'utf8')),progress=JSON.parse(await readFile(oldProgress,'utf8'));
 assert.equal(previous.root,'/private/tmp/willyou-m16-b09-c28-mapped-approval-pair-UGHZjD');assert.equal(progress.root,previous.root);assert.equal(previous.status,'failed-or-partial');assert.equal(previous.captures.length,0);assert.equal(previous.originalRows.length,0);assert.equal(previous.fixture.trace.length,0);assert.equal(previous.launches.length,1);assert.equal(previous.launches[0].exit.code,0);assert.equal(previous.launches[0].exit.signal,null);
 assert(previous.error.includes('Timeout: exact focused manual geometry or user returned exact own foreground 3s'));assert.equal(progress.stage,'await-user-focus-mapped-1440');
 const prevDriver=join(support,'mapped-approvals-1440-internal/driver.mjs');assert.equal(await digest(prevDriver),previous.driverSha);
 const oldGeom=await checkGeometryRecovery();assert.equal(oldGeom.actualOldNewRawPairs.length,2);
 // Previous real progress contains actual internal display and owned root IDs.
 // It does not persist its observed initial 1400x900 bounds; that coordinator
 // observation is a controlled starting geometry here, not retroactive evidence.
 assert.equal(progress.eligibleDisplays.length,1);const display=progress.eligibleDisplays[0],title=progress.windowTitle,{rootId,shellId}=progress.rootIdentity;
 const initial={x:display.workArea.x+10,y:display.workArea.y+10,width:1400,height:900};
 const exact={x:display.workArea.x+Math.floor((display.workArea.width-1440)/2),y:display.workArea.y+Math.floor((display.workArea.height-900)/2),width:1440,height:900};
 const native={rootId,shellId,windowTitle:title,visible:true,minimized:false,focused:false,fullScreen:false,bounds:initial,contentBounds:initial,actualDisplay:display,displays:[display],shellZoomFactor:1};
 assert.equal(chooseBackgroundTarget(native,null).id,display.id);assert.equal(chooseBackgroundTarget(native,display.id).id,display.id);assert.equal(chooseBackgroundTarget(native,display.id+1000),null);
 assert(!recognizedBackground1440({native,actual:{inner:[1400,900],dpr:2},exact:false},display.id));
 const ready={...native,bounds:exact,contentBounds:exact};const q={native:ready,actual:{inner:[1440,900],dpr:2},exact:true};assert(recognizedBackground1440(q,display.id),'actual normal 1440 geometry is independent of global focus');
 for(const [name,a] of [['dpr',{...q,actual:{...q.actual,dpr:1}}],['css',{...q,actual:{...q.actual,inner:[1400,900]}}],['hidden',{...q,native:{...ready,visible:false}}],['minimized',{...q,native:{...ready,minimized:true}}],['fullscreen',{...q,native:{...ready,fullScreen:true}}],['zoom',{...q,native:{...ready,shellZoomFactor:1.1}}],['display',{...q,native:{...ready,actualDisplay:{...display,id:999}}}],['bounds',{...q,native:{...ready,bounds:{...exact,x:display.workArea.x-1}}}]])assert(!recognizedBackground1440(a,display.id),name);
 // Re-execute the ACTUAL driver callback off-line, not a reimplemented
 // approximation or live Electron. OS/user input methods are absent.
 const src=await readFile(join(dir,'driver.mjs'),'utf8'),ast=ts.createSourceFile('driver.mjs',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),decl=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='resizeOwnedRoot1440');assert(decl);const resize=vm.runInNewContext('('+decl.getText(ast)+')');
 const base=()=>{let bounds={...initial},focused=false,shows=0,focusRequests=0,sets=0;const web={id:shellId,isDestroyed:()=>false,getURL:()=> 'file:///isolated/Contents/Resources/app.asar/out/renderer/index.html',getZoomFactor:()=>1};const w={id:rootId,webContents:web,contentView:{children:[]},isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFullScreen:()=>false,getTitle:()=>title,isFocused:()=>focused,getBounds:()=>({...bounds}),getContentBounds:()=>({...bounds}),setBounds:v=>{sets++;bounds={...v}},show:()=>{shows++;throw Error('unexpected show')},focus:()=>{focusRequests++;throw Error('unexpected focus')}};const E={BaseWindow:{getAllWindows:()=>[w],fromId:id=>id===rootId?w:null},screen:{getAllDisplays:()=>[display],getDisplayMatching:()=>display}};return {w,web,E,stats:()=>({sets,shows,focusRequests}),becomesFocused:()=>{focused=true;}};};
 let test=base(),out=resize(test.E,rootId,shellId,title,display);assert.deepEqual(JSON.parse(JSON.stringify(out.requested)),exact);assert.equal(out.beforeFocus,false);assert.equal(out.afterFocus,false);assert.equal(out.activationRequested,false);assert.equal(out.systemInput,false);assert.deepEqual(test.stats(),{sets:1,shows:0,focusRequests:0});
 const rejected=[];for(const [name,change,params] of [
  ['wrong window id',()=>{},[rootId+1,shellId,title,display]],['wrong shell id',()=>{},[rootId,shellId+1,title,display]],['wrong title',()=>{},[rootId,shellId,title+'-unexpected',display]],['hidden',t=>{t.w.isVisible=()=>false;}],['minimized',t=>{t.w.isMinimized=()=>true;}],['fullscreen',t=>{t.w.isFullScreen=()=>true;}],['zoom',t=>{t.web.getZoomFactor=()=>2;}],['display ID changed',t=>{t.E.screen.getAllDisplays=()=>[{...display,id:999}]}],['physical workArea changed',t=>{t.E.screen.getAllDisplays=()=>[{...display,workArea:{...display.workArea,height:899}}]}],['duplicate root',t=>{t.E.BaseWindow.getAllWindows=()=>[t.w,{...t.w,id:rootId+5}]}],
 ]){test=base();change(test);assert.throws(()=>resize(test.E,...(params??[rootId,shellId,title,display])),name);assert.deepEqual(test.stats(),{sets:0,shows:0,focusRequests:0});rejected.push(name);}
 test=base();const original=test.w.setBounds;test.w.setBounds=v=>{original(v);test.becomesFocused();};assert.throws(()=>resize(test.E,rootId,shellId,title,display),/unexpectedly activated/);assert.deepEqual(test.stats(),{sets:1,shows:0,focusRequests:0});rejected.push('unexpected native activation stops subsequent input');
 assert(!/Page\.bringToFront|\.focus\(|\.show\(|setFullScreen\(|Emulation\.setDeviceMetricsOverride|front-observer|await-user-focus-mapped-1440/.test(src),'A driver cannot reintroduce native focus/activation or viewport substitution');
 return {actualPriorFailurePreserved:true,previousActualRoot:previous.root,retainedResultSha:await digest(oldResult),retainedProgressSha:await digest(oldProgress),actualPriorCaptures:0,actualPriorRequests:0,actualPriorExit:previous.launches[0].exit,actualDisplay:display,actualRootIdentity:progress.rootIdentity,originalKnownGeometryEvidence:oldGeom,positiveControlledActualCallback:{requested:exact,activationRequested:false,systemInput:false},rejectedActualCallbackControls:rejected,geometryNegatives:8,boundary:'Actual old failed focus/0 images/normal exit and real C19 archive geometry/PNG pairs preserved. Current initial 1400x900 and fake Electron callback results are controlled replay only. No current native geometry, click, screenshot, system focus or new A result.'};
}
