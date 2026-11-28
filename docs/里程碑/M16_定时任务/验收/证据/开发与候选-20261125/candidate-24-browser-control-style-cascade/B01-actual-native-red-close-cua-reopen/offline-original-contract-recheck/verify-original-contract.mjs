// Offline assertion of the existing local synthetic B01.3 evidence. No App, transport, UI or product calls.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyB01RedCloseReceipt} from '/private/tmp/willyou-m16-f36-qa/C22-B01-red-close-native-receipt.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const root='/private/tmp/willyou-m16-f36-b01-red-close-c24-QW6CEU';
const archive='/private/tmp/willyou-m16-c24-b01.3-native-red-close-whitelist.m1a2w2d9';
const exe='/private/tmp/willyou-m16-c24-build.pn0wa8ey/standard/mac-arm64/WillYou.app/Contents/MacOS/WillYou';
const pid=90280;
const pin='68302db0dec3c11291e94a67d5c7cca5b4f9ae98303eff5666194a35419da684';
const nativePin='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
const driverPin='7cd48273facee502918dbdd4e7a223acccdbf987b76be0bb48cb8f219ba33a92';
const receiptName='B01-red-close-user-receipt-6185d89c-2d92-42cb-9847-90a453290f27.json';
const paths={report:[join(root,'result.json'),'f1c3162215fa0535255b7d10a50909c5efeb606942db616125b0946a024f1b1c'],receipt:[join(root,receiptName),'04cc605331b99f227d840de4c54ac39cd1a3b4a174c9aba9f5d6bbe56f1f952e'],focus1:[join(root,'focus-before-close.json'),'452e335141cbe21d868bf952c5edd64b688b638eb2fc09285ddd0430bf8c150f'],focus2:[join(root,'focus-before-close-second.json'),'02154e2013d5155b7b5a2490fa4cf49c2d5fb931918bdf58a51145af88d244e0'],os:[join(root,'explicit-cua-reopen-os-observation.json'),'faeb66d03495bb25ede0cea1b14762fcdc0d2ab7e22ddea6901bfb55daf1d8d7'],oldVerifier:['/private/tmp/willyou-m16-f36-qa/C22-B01-red-close-native-receipt.mjs','d81595e0b6762ce436a0fa869f67a6d0312b49a66a2920b39c983ae371c1f571'],archiveManifest:[join(archive,'SHA256SUMS'),'1f3be99dec7b7a32a3e8bf531ff5c46e823f854051612d60c078528001dfa8e5']};
const sha=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
for(const [path,hash] of Object.values(paths))assert.equal(sha(path),hash,'exact immutable input: '+path);
const value=key=>JSON.parse(readFileSync(paths[key][0],'utf8'));
const actual={r:value('report'),q:value('receipt'),f1:value('focus1'),f2:value('focus2'),os:value('os')};
const same=(a,b,message)=>assert.deepEqual(a,b,message);
const check=(value,message)=>assert(value,message);
const rect=h=>h.sourceBounds;
function focusGuard(samples,receiptSamples,expected,label){
 same(samples,receiptSamples,label+' raw and operator receipt sample arrays');
 check(samples.length===14,label+' exact 14 actual foreground samples');
 for(const [i,s] of samples.entries()){
   same(s.pid,expected.pid,label+' PID');same(s.exe,expected.exe,label+' executable');
   same(realpathSync(s.canonicalPath),realpathSync(expected.exe),label+' canonical path');check(s.focusConfirmed===true&&Number.isFinite(s.at),label+' actual front');
   if(i)check(s.at>samples[i-1].at,label+' ordered times');
 }
 const span=samples.at(-1).at-samples[0].at;check(span>=3000,label+' stable three seconds');return {count:samples.length,spanMs:span,start:samples[0].at,last:samples.at(-1).at};
}
function verify({r,q,f1,f2,os}){
 check(r.schema==='M16-F36-candidate-a-v1'&&r.ordinaryB01RedCloseOnly===true&&r.nativeAutomation===true,'actual C24 ordinary B01.3 native run');
 same(r.pin,pin,'candidate pin');same(r.nativePin,nativePin,'native pin');same(r.driverSha256,driverPin,'source driver pin');same(r.root,root,'private run root');same(r.userData,join(root,'data'),'private run data');same(r.pid,pid,'report PID');
 const h=r.b01RedCloseHandoff,actualRoot=r.actualSystemStart.first,o=q.actualObservations,hidden=r.b01RedCloseHidden,restored=r.b01RedCloseRestoredBeforeReceipt;
 same(h.pid,pid,'handoff PID');same(q.pid,pid,'receipt PID');same(h.exe,exe,'handoff executable');same(q.executable,exe,'receipt executable');same(q.nonce,h.nonce,'original receipt nonce');same(q.action,h.action,'original receipt action');same(h.action,'B01-ordinary-red-close-redisplay','original ordinary native action');
 same(q.rootId,h.rootId,'receipt root');same(h.rootId,1,'original root');same(actualRoot.rootId,h.rootId,'original observed root');same(q.title,h.windowTitle,'receipt title');same(actualRoot.title,h.windowTitle,'initial root title');same(actualRoot.bounds,rect(h),'initial root geometry');
 check(h.operatorMode==='native-automation'&&q.operator==='native-automation'&&q.nativeAutomation===true&&q.userConfirmed===false,'exact native operator, not human confirmation');
 check(q.guiReleased===true&&q.actualRedClose===true&&q.actualRedisplay===true&&q.actualNativeObservation===true&&q.noInputAfterFocusLoss===true,'actual native ordinary close/re-display receipt');
 check(q.closeTool==='CUA-exact-app'&&q.closeControl?.role==='AXCloseButton'&&q.closeControl?.native===true,'actual ordinary native close control');
 check(o.normalWindowMenuOnlyOwnTitle===true,'actual sole ordinary test Window menu item');
 // Contract identifies the normal re-display operation and actual evidence, not a required Dock API.
 // Accept exactly the observed CUA app-selection route here; no arbitrary/renamed source.
 same(q.redisplayEntry,'exact-cua-application-selection','recognized explicit CUA application-selection entry');
 same(o.restoreOperation,'CUA getApp exact bundle path, not Dock or NSRunningApplication API; OS reappeared same PID and visible original synthetic form. Dock CUA call timed out without input.','truthful explicit CUA route, no Dock input');
 same(q.redisplayIdentity,{pid:h.pid,exe:h.exe,rootId:h.rootId},'re-display exact identity');
 const firstFocus=focusGuard(f1,q.focusSamplesBeforeClose,h,'first foreground');const secondFocus=focusGuard(f2,o.secondCloseFocusSamples,h,'second foreground');
 same(hidden.hidden,o.firstHidden,'actual first hidden root matches receipt');same(restored,o.firstCloseAndShow,'actual first restored proof matches receipt');
 for(const [label,st] of [['hidden',hidden.hidden],['restored',restored.restored]]){same(st.id,h.rootId,label+' same root');same(st.title,h.windowTitle,label+' same title');same(st.bounds,rect(h),label+' same geometry');same(st.display,h.sourceDisplay,label+' same display');same(st.roots,[h.rootId],label+' unique root');same(st.minimized,false,label+' not minimized');}
 check(hidden.hidden.visible===false&&hidden.hidden.focused===false,'actual native hide, not exit/minimize');check(restored.restored.visible===true&&restored.restored.focused===true,'actual root re-display');
 const a=hidden.hiddenState,b=restored.actualPage;
 same(a.id,b.id,'same native WC');same(a.process,b.process,'same native renderer PID');same(a.url,b.url,'same local native page URL');same(b.url,'http://127.0.0.1:3425/A','exact local synthetic page');same(a.page.marker,b.page.marker,'same native document marker');same(a.page.form,b.page.form,'same original unsubmitted form');check(typeof b.page.form==='string'&&b.page.form.startsWith('B01原未提交表单 '),'actual synthetic original form');same(a,b,'full original page read-only state');
 same(restored.activeId,h.pageId,'same actual active page ID');same(restored.expectedPageId,h.pageId,'same expected original page ID');check(restored.sameRoot===true&&restored.sameWC===true&&restored.sameDoc===true&&restored.sameForm===true,'actual driver identity checks');
 const hide=restored.events.find(e=>e.kind==='hide'&&!e.visible),show=restored.events.find(e=>e.kind==='show'&&e.visible&&e.at>=hide?.at);
 check(hide&&show,'actual ordered native hide/show events');same(hide.id,h.rootId,'hide event root');same(show.id,h.rootId,'show event root');check(!hide.minimized&&!show.minimized,'hide/show not minimize');same(hide.bounds,rect(h),'hide geometry');same(show.bounds,rect(h),'show geometry');same(hide.display,h.sourceDisplay,'hide display');same(show.display,h.sourceDisplay,'show display');check(firstFocus.last<=hide.at&&show.at<=restored.at&&restored.at<secondFocus.start,'actual first and second operation times');
 // Independent second native close/re-open receipt. Do not claim that later full final driver assertion ran.
 same(o.secondCloseOwnOnScreenNormalWindows,0,'second actual zero own on-screen normal windows');same(os,o.secondReopenOS,'independent OS observation agrees with operator receipt');same(os.pid,h.pid,'second CUA re-open PID');same(os.exe,h.exe,'second CUA re-open executable');check(os.active===true&&os.frontIsOwn===true,'second actual same app foreground');same(os.ownOnScreenNormalWindows,1,'second actual one own on-screen normal window');check(os.at>secondFocus.last,'second actual reopen after stable focus segment');
 same(r.windowsBeforeQuit.length,1,'actual pre-quit unique root');const w=r.windowsBeforeQuit[0];same(w.id,h.rootId,'pre-quit same original root');same(w.title,h.windowTitle,'pre-quit original title');same(w.bounds,rect(h),'pre-quit original geometry');check(w.visible===true&&w.minimized===false,'pre-quit original root visible');check(w.children.some(x=>x.id===b.id&&x.url===b.url&&x.visible===true),'pre-quit original native WC and URL visible');
 same(r.status,'codex-perf-subset-failed','old red result remains failed');same(r.checks.length,1,'original check count');same(r.checks[0].status,'fail','old check is red');same(r.checks[0].error,r.error,'original error retained');check(r.error.includes("['native-dock-activation','native-window-menu','exact-NsRunningApplication-normal-activation'].includes(q.redisplayEntry)"),'old enum failure unchanged');same(r.exit,{pid:h.pid,code:0,signal:null},'actual normal process exit distinct from test result');check(r.b01RedCloseActual===undefined,'post-old-validator full assertion was not reached');
 return {acceptedOrdinaryNativeHideAndReDisplayEvidence:true,originalCriterion:'Actual native close hides and redisplays original window/page; same native identity, document/form and active page; original contract does not mandate a Dock-only source.',actualEntry:q.redisplayEntry,firstActualDriver:{rootId:h.rootId,wc:b.id,pageId:h.pageId,geometry:rect(h),sameDoc:true,sameForm:true,hideAt:hide.at,showAt:show.at,focus:firstFocus},secondIndependentObservation:{actualCloseOwnOnScreenNormalWindows:o.secondCloseOwnOnScreenNormalWindows,actualReopenOwnOnScreenNormalWindows:os.ownOnScreenNormalWindows,pid:os.pid,exactPath:true,frontIsOwn:true,operatorSawOriginalForm:true,preQuitOriginalWCVisible:true,focus:secondFocus},historicalRedRetained:true,normalExit:r.exit,scope:'This checks preserved actual ordinary native red hide/re-display evidence. First driver proves same root/WC/document/form/active ID; second independently proves real 0→1 OS normal-window count, explicit exact CUA application selection and same original form in operator observation. No second full post-receipt driver assertion, no Dock input or other entry invented; no claim of full B01.3 cross-screen/Space/fullscreen/composed native image or whole milestone.'};
}
const positive=verify(actual);let oldRed;try{verifyB01RedCloseReceipt(actual.q,actual.r.b01RedCloseHandoff,true);}catch(e){oldRed=e.message;}
check(oldRed?.includes("['native-dock-activation','native-window-menu','exact-NsRunningApplication-normal-activation'].includes(q.redisplayEntry)"),'unchanged old validator must reject exact actual input');
const negative=[];
function reject(name,edit,expected){const x=structuredClone(actual);edit(x);let observed;try{verify(x);}catch(e){observed=e.message;}check(typeof observed==='string'&&observed.includes(expected),'negative must reject at intended semantic assertion: '+name);negative.push({name,rejected:true,assertion:expected,actualInputFilesUnchanged:true});}
reject('wrong receipt PID',x=>{x.q.pid+=1},'receipt PID');
reject('wrong active page even if receipt agrees',x=>{x.r.b01RedCloseRestoredBeforeReceipt.activeId='wrong-synthetic-page';x.q.actualObservations.firstCloseAndShow.activeId='wrong-synthetic-page'},'same actual active page ID');
reject('unknown re-display source',x=>{x.q.redisplayEntry='unknown-application-selection'},'recognized explicit CUA application-selection entry');
reject('no actual second zero-window observation',x=>{x.q.actualObservations.secondCloseOwnOnScreenNormalWindows=1},'second actual zero own on-screen normal windows');
reject('no actual second one-window observation',x=>{x.os.ownOnScreenNormalWindows=0;x.q.actualObservations.secondReopenOS.ownOnScreenNormalWindows=0},'second actual one own on-screen normal window');
reject('wrong restored WC even if receipt agrees',x=>{x.r.b01RedCloseRestoredBeforeReceipt.actualPage.id+=10;x.q.actualObservations.firstCloseAndShow.actualPage.id+=10},'same native WC');
reject('changed original document even if receipt agrees',x=>{x.r.b01RedCloseRestoredBeforeReceipt.actualPage.page.marker='changed-doc';x.q.actualObservations.firstCloseAndShow.actualPage.page.marker='changed-doc'},'same native document marker');
reject('changed original form even if receipt agrees',x=>{x.r.b01RedCloseRestoredBeforeReceipt.actualPage.page.form='changed-form';x.q.actualObservations.firstCloseAndShow.actualPage.page.form='changed-form'},'same original unsubmitted form');
reject('changed actual root geometry even if receipt agrees',x=>{x.r.b01RedCloseRestoredBeforeReceipt.restored.bounds.width+=1;x.q.actualObservations.firstCloseAndShow.restored.bounds.width+=1},'restored same geometry');
reject('missing second independent foreground sample',x=>{x.f2.pop();x.q.actualObservations.secondCloseFocusSamples.pop()},'second foreground exact 14 actual foreground samples');
for(const [path,hash] of Object.values(paths))same(sha(path),hash,'input remains unchanged: '+path);
const report={schema:'M16-C24-B01.3-bounded-offline-actual-receipt-contract-v1',at:new Date().toISOString(),inputs:Object.fromEntries(Object.entries(paths).map(([k,[path,sha256]])=>[k,{path,sha256}])),positive,negative,oldValidator:{unchanged:true,rejectedActualInput:true,message:oldRed},boundary:'Original B01.3 ordinary native behavior is re-evaluated from existing actual pinned data, not a new execution or change of the historical test. No App, listener, UI, system setting, production or authority mutation. Negative copies exist only in memory. Formal increment: 0; coordinator adjudicates B01.3 as a whole.'};
writeFileSync(join(here,'offline-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({positive:positive.acceptedOrdinaryNativeHideAndReDisplayEvidence,negativeRejected:negative.length,oldRed:true,scope:positive.scope}));
