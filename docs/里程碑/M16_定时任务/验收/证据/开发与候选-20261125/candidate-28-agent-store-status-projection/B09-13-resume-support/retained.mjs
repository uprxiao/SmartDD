import assert from 'node:assert/strict';
import {join,dirname,extname} from 'node:path';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {digest,fullscreenVerdict} from '../guards.mjs';
export const priorRoot='/private/tmp/willyou-m16-b09-c28-1920-pair13-EhnMPS';
export const priorResult=join(priorRoot,'B09-matrix-1920-additional13-result.json');
export const pins={report:'83005515d12455853bc155b602b14322830b24c4c9af0ce5eaa11598112c5a49',
 driver:'169c2a43a2f3e1018cffff77101cd6f43c8442728e273dd73aa66bd66e23c04b',
 states:'c046fd938d567df75463363d5fdf58580c0bdbfe5b0376b1ba9095eedad20470',
 stop:'c9d93e6e93f83c8aaf7e973121a11afab125b38342f32042f71ad7b583f0f6c4',
 failed:'96484ac558921727ee33ba706730ff12dc936054fa767b9502b88bb61a82d582'};
export const matrixKey=(theme,width,state)=>theme+'-rw'+width+'-win1920x1080|'+state;
export const rowKey=(side,theme,width,state)=>side+'|'+matrixKey(theme,width,state);
async function inspectImage(meta,images){
 const p=meta.file;assert(dirname(p)===priorRoot&&await realpath(p)===p);
 assert((await lstat(p)).isFile()&&!(await lstat(p)).isSymbolicLink());
 const hash=await digest(p);assert.equal(hash,meta.sha);images[p]=hash;
 if(extname(p)==='.png'&&Array.isArray(meta.size)){const b=await readFile(p);assert.deepEqual([b.readUInt32BE(16),b.readUInt32BE(20)],meta.size);}
}
async function collectImages(obj,images){
 if(!obj||typeof obj!=='object')return;
 if(typeof obj.file==='string'&&/\.(png|jpg|jpeg)$/.test(obj.file)&&typeof obj.sha==='string'){await inspectImage(obj,images);return;}
 for(const v of Object.values(obj))if(v&&typeof v==='object')await collectImages(v,images);
}
export async function loadRetained(verifiedPins,coreStates){
 assert.equal(coreStates.length,13);
 const exactExpected=new Set([
  ...['light','dark'].flatMap(t=>[480,900].map(w=>matrixKey(t,w,'R01-11-launcher-empty'))),
  ...coreStates.filter(s=>!['R01-11-launcher-empty','B02-loading-stop'].includes(s)).map(s=>matrixKey('dark',480,s))
 ]);
 assert.equal(await realpath(priorRoot),priorRoot);
 assert.equal(await digest(priorResult),pins.report);
 assert.equal(await digest(join(priorRoot,'driver.snapshot.mjs')),pins.driver);
 assert.equal(await digest(join(priorRoot,'states.snapshot.mjs')),pins.states);
 const raw=JSON.parse(await readFile(priorResult,'utf8'));assert.equal(raw.root,priorRoot);
 assert.equal(raw.schema,'M16-B09.2-old-C28-1920-additional13-paired-A');assert.equal(raw.status,'failed-or-partial');
 assert.deepEqual(raw.pins,verifiedPins);assert.equal(raw.longUrl.startsWith('http://127.0.0.1:3425/m16-visual-long?data='),true);assert.equal(raw.shortUrl,'http://127.0.0.1:3425/m16-visual-short');
 assert.equal(raw.sides.length,1);assert.equal(raw.sides[0].side,'old-clean');
 const win=raw.sides[0].window;assert(win.exact&&win.operatorMode==='physical user'&&fullscreenVerdict(win.ready.native,win.ready.actual));
 assert.equal(raw.launches.length,1);assert.equal(raw.launches[0].exit.code,0);assert.equal(raw.launches[0].exit.signal,null);
 assert.equal(raw.launches[0].expected,verifiedPins.specs[0].hash);assert.equal(raw.launches[0].nativePin,verifiedPins.specs[0].native);
 assert.equal(raw.pageFocusEmulation?.restored??raw.sides[0].pageFocusEmulation.restored,true);
 const good=raw.captures.filter(c=>c.passed===true);assert.equal(good.length,15);
 assert.equal(raw.captures.length,16);assert.equal(raw.originalRows.length,15);
 const images={},keys=new Set();
 for(const c of good){
   assert(c.side==='old-clean'&&c.restored&&c.geometry.theme===c.theme&&c.geometry.dpr===1&&Math.abs(c.geometry.panel.width-c.width)<=1);
   assert.deepEqual(c.geometry.inner,[1920,1080]);assert.deepEqual(c.shell.size,[1920,1080]);
   assert(fullscreenVerdict(c.shell.fullscreenBefore,c.geometry)&&fullscreenVerdict(c.shell.fullscreenAfter,c.geometry));
   const key=matrixKey(c.theme,c.width,c.state);assert(exactExpected.has(key));assert(!keys.has(key));keys.add(key);
   const row=raw.originalRows.find(r=>r.key===key);assert.equal(row?.side,'old-clean');assert.equal(row?.label,c.label);assert.equal(row?.shell,c.shell.file);
   await collectImages(c,images);
 }
 assert.deepEqual([...keys].sort(),[...exactExpected].sort());
 const fail=raw.captures.find(c=>!c.passed);assert(fail&&fail.state==='B02-loading-stop'&&fail.theme==='dark'&&fail.width===480);
 assert.equal(await digest(fail.shell.file),pins.stop);
 const failedImage=join(priorRoot,fail.label+'-failed-shell.png');assert.equal(await digest(failedImage),pins.failed);
 const slow=raw.slowRequests[0];assert.equal(raw.slowRequests.length,1);assert.equal(slow.query,'?case=old-clean-dark-rw480-win1920x1080');assert(slow.closedAt>slow.at&&slow.responseCompleted===false);
 const stopAction=raw.actions.findLast(x=>x.selector==='[aria-label="停止加载"]');assert(slow.closedAt>=stopAction.at&&stopAction.stage===fail.label);
 assert(raw.error.includes('driver.mjs:96:2')&&raw.error.includes('states.mjs:67:334'));
 const captures=good.map(c=>({...c,retainedFrom:{root:priorRoot,report:priorResult,reportSha:pins.report,originalLabel:c.label}}));
 const retainedKeys=captures.map(c=>rowKey(c.side,c.theme,c.width,c.state));
 const provenance={root:priorRoot,result:priorResult,resultSha:pins.report,priorDriverSha:pins.driver,priorStatesSha:pins.states,
  nativeFullscreen:win,normalExit:raw.launches[0].exit,retainedKeys,retainedRawImages:images,
  failedBefore:{key:matrixKey('dark',480,'B02-loading-stop'),capture:fail.shell,error:raw.error,failedImage,failedImageSha:pins.failed,slow,stopAction,
   boundary:'Original failed Stop capture remains failed and is excluded from retained rows; no post-stop DOM value was recorded.'}};
 return {captures,keys:new Set(retainedKeys),provenance,oldRaw:raw};
}
