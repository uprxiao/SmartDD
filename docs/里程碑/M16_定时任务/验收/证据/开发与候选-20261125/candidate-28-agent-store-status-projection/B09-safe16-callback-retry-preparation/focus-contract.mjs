import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {digest,specs,fullscreenVerdict} from '../guards.mjs';
export function focusPlan(o){
 assert(o.browserAddress&&o.browserViewport&&o.actualSeparator,'A real visible browser context, not directory-only panel, is required');
 assert(Number.isFinite(o.existingBrowserWidth)&&Number.isFinite(o.target)&&o.target>=o.min&&o.target<=o.max,'Target must be reachable by real keyboard steps');
 if(Math.abs(o.existingBrowserWidth-o.target)<=1)return 'already-exact-browser-width';
 return 'browser-address-reverse-tab';
}
export async function readPriorFocusFailure(){
 const root='/private/tmp/willyou-m16-b09-c28-1920-safe16-pair-WlfF3b',result=join(root,'B09-safe16-pair-result.json'),image=join(root,'old-clean-light-rw480-win1920x1080-network-failed-shell.png'),reference='/private/tmp/willyou-m16-b09-c28-1920-pair13-GeAWgW/B09-matrix-1920-additional13-result.json';
 assert.equal(await realpath(root),root);assert.equal(await digest(result),'5c4facdaebe0d472a7e809e957a9256499ab2166feea077f66e443c44b5115de');assert.equal(await digest(image),'6ffd320f97fe90e46d8bb4feb8e7c38b7561899422656af1513fb0bef253efe2');assert.equal(await digest(join(root,'driver.snapshot.mjs')),'bd2a8b9ed6200cb4f1b7a18f757324a5841d03246cf40f23c1412a014996e3c9');assert.equal(await digest(join(root,'states.snapshot.mjs')),'bda5accf3c8e110ff35ebbea26caceb92e586aa4aa826622c95a8449adcdf80a');
 assert.equal(await digest(reference),'0cc3b8dcf2aa1bb4126d5c790f3fdbbaddb89497364b78a5e708a2ee86000191');
 const raw=JSON.parse(await readFile(result,'utf8')),good=JSON.parse(await readFile(reference,'utf8'));assert.equal(raw.root,root);assert.equal(raw.status,'failed-or-partial');assert.equal(raw.captures.length,0);assert.equal(raw.originalRows.length,0);assert.equal(raw.sides.length,1);assert.equal(raw.sides[0].tasks.length,16);assert(raw.error.includes('Actual real separator must own keyboard focus')&&raw.error.includes('driver.mjs:134:469'));assert.equal(raw.launches[0].exit.code,0);assert.equal(raw.launches[0].exit.signal,null);assert(fullscreenVerdict(raw.sides[0].window.ready.native,raw.sides[0].window.ready.actual));
 const fileWidth=raw.actions.find(x=>x.kind==='real-keyboard-panel-width');assert.deepEqual(fileWidth.before,{width:250,min:220,max:1384,focused:true});assert.deepEqual(fileWidth.after,{width:480,min:220,max:1384,focused:true});
 const secondClick=raw.actions.findLast(x=>x.selector==='[role=separator][aria-label="调整文件区域宽度"]');assert.deepEqual(secondClick.point,{x:992,y:560});
 const e=raw.groupErrors[0],snap=e.actualSnapshot,t=snap.tabs[0],native=e.actualWindows.find(w=>w.id===1).children.find(c=>c.url===t.url);
 assert(snap.tabs.length===1&&snap.activeId===t.id&&t.url==='http://127.0.0.1:55011/page?combo=light-rw480-win1920x1080'&&!t.loading&&!t.failure&&native.id===2);
 assert.deepEqual(native.bounds,{x:993,y:97,width:921,height:977});assert(native.visible);assert.equal(raw.localFixtureRequests.network.filter(x=>x.url.includes('/page?')).length,1);
 assert.equal(good.status,'actual-thirteen-state-pair-recorded');const working=good.actions.find(x=>x.kind==='real-keyboard-panel-width'&&x.before.min===420&&x.requested===480);assert(working.before.focused&&working.after.focused&&working.after.width===480);assert.equal(working.before.width,925.671875);
 const renderer=JSON.parse(execFileSync('python3',['-c',`import struct,json,sys,hashlib
out=[]
for p in sys.argv[1:]:
 with open(p,'rb') as f:
  _,h,_,n=struct.unpack('<IIII',f.read(16));hdr=json.loads(f.read(n));a=hdr['files']['out']['files']['renderer']['files']['assets']['files'];name=next(k for k in a if k.startswith('index-') and k.endswith('.js'));v=a[name];f.seek(8+h+int(v['offset']));raw=f.read(v['size']);s=raw.decode();x=s.index('调整文件区域宽度');part=s[x-130:x+1400];out.append({'asset':name,'sha':hashlib.sha256(raw).hexdigest(),'pointerPreventDefault':'event.preventDefault();' in part and 'setPointerCapture(event.pointerId)' in part,'tabIndexZero':'tabIndex: 0' in part,'keyboardArrowWidth':'ArrowLeft' in part and 'ArrowRight' in part,'distinctDirectoryWidthPreference':'directoryPanelWidthPreference' in s and 'filePanelWidthPreference' in s})
print(json.dumps(out))
`,...specs.map(s=>join(s.bundle,'Contents/Resources/app.asar'))],{encoding:'utf8'}));assert(renderer.every(x=>x.pointerPreventDefault&&x.tabIndexZero&&x.keyboardArrowWidth&&x.distinctDirectoryWidthPreference));
 const replayActual={browserAddress:true,browserViewport:true,actualSeparator:true,existingBrowserWidth:working.before.width,target:480,min:working.before.min,max:working.before.max};
 const plan=focusPlan(replayActual);assert.equal(plan,'browser-address-reverse-tab');assert.throws(()=>focusPlan({...replayActual,browserAddress:false}));assert.throws(()=>focusPlan({...replayActual,target:2000}));
 return {priorRoot:root,report:result,reportSha:await digest(result),failureImage:image,imageSha:await digest(image),priorError:raw.error,actualNormalExit:raw.launches[0].exit,actualPriorRows:0,originalFullscreen:raw.sides[0].window.ready,actualFilePanelWidth:fileWidth,actualLoadedBrowser:{taskCount:16,snapshot:snap,native,secondClick},goodReference:{result:reference,sha:await digest(reference),firstActualBrowserResize:working},renderer,replayedInput:{...replayActual,plan},boundary:'Actual WlfF3b first file-panel width succeeded; browser switched to its independent preference, same loaded native WC. Failure screenshot blue keyboard outline is on a sidebar project; exact previous document.activeElement was not logged. Actual compiled pointer prevents focus default; global 100 Tabs in expanded 16-project shell did not reach separator. The positive new anchor is a conditional static replay of actual loaded-page/width context, not a new live focus observation. Real click and each real reverse Tab/Arrow focus and width must be proved at execution.'};
}
