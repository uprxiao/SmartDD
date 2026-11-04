from pathlib import Path
r=Path('/private/tmp/willyou-m12-p067-pause-stop-app-002');p=r/'run.mjs';s=p.read_text()
s=s.replace("import{captureService}from'./capture-service.mjs';","import{captureService}from'./capture-service.mjs';import{waitStableGeometry}from'./geometry.mjs';")
s=s.replace("taskCreations:[]};","taskCreations:[],geometryWaits:[],cleanupErrors:[]};").replace("'taskCreations'])","'taskCreations','geometryWaits','cleanupErrors'])")
a=s.index('async function click(');b=s.index('async function field(',a)
new='''async function click(selector,text){
 await app.checkInputFocus('P067.MainUiClick');await app.evaluate('document.fonts.ready.then(()=>true)');
 const expression="(()=>{const e=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&getComputedStyle(e).visibility==='visible'&&"+(text===undefined?"true":"e.textContent.trim()==="+JSON.stringify(text))+");if(!e)return{available:false,reason:'missing-or-refresh'};e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))return{available:false,reason:'disabled-or-occluded'};let activeAnimations=0;for(let a=e;a&&a!==document.body;a=a.parentElement)activeAnimations+=a.getAnimations({subtree:false}).filter(v=>v.playState==='running'||v.playState==='pending').length;return{available:true,activeAnimations,x,y}})()";
 new Function(expression);const row={stage,selector,text,startedAtMs:Date.now(),samples:[]};r.geometryWaits.push(row);
 const read=()=>app.evaluate(expression),frame=()=>app.evaluate('new Promise(r=>requestAnimationFrame(r))');
 let point;try{point=await waitStableGeometry({read,frame,focus:()=>app.checkInputFocus('P067.WaitUiSettle'),samples:row.samples});await frame();await frame();const final=await read();assert(final.available&&final.activeAnimations===0);assert.deepEqual({x:final.x,y:final.y},point);row.final=final;}catch(error){row.error=String(error);await persist();throw error}
 for(const type of['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});r.actions.push({atMs:Date.now(),stage,kind:'click',selector,text,point,geometrySamples:row.samples.length});await persist();
}
'''
s=s[:a]+new+s[b:]
a=s.index("await capture();r.initial=");b=s.index("stage='T113-realrun-end-and-fresh-runs'",a)
s=s[:a]+'''await capture();r.initial=await checkpoint('remaining-lifecycle-initial-native-identities');const initialHelperSource=await readFile(root+'/helper-observer.js','utf8');r.initialPassiveHelperInstallation=await own('return ('+initialHelperSource+')(E,'+JSON.stringify({path:root+'/helper-events-initial.jsonl',userData,executable:p.package.app+'/Contents/Resources/agent-browser/arm64/agent-browser'})+')');r.lifecyclePreconditionGrant=await grant('T2','T1','lifecycle-precondition-control');await success('T1','lifecycle-activity-snapshot',pageArgs('one',['snapshot']));
 '''+s[b:]
s=s.replace("delete r.quitRequestedAtMs;r.quitObservations=[];","delete r.quitRequestedAtMs;delete r.quitOutcome;delete r.normalExit;delete r.harnessProcessReceipt;r.forcedClose=false;r.quitObservations=[];")
old="async function normalPhaseQuit(){await resources();const initialPid=app.processId;await normalQuit();r.phases.push({instance,pid:initialPid,quitRequestedAtMs:r.quitRequestedAtMs,quitOutcome:r.quitOutcome,normalExit:r.normalExit,harnessProcessReceipt:r.harnessProcessReceipt,quitObservations:r.quitObservations,nativeEvents:r.nativeEvents,forcedClose:r.forcedClose});await persist()}"
new="async function normalPhaseQuit(){await resources();const initialPid=app.processId;try{await normalQuit()}finally{r.phases.push({instance,pid:initialPid,quitRequestedAtMs:r.quitRequestedAtMs,quitOutcome:r.quitOutcome,normalExit:r.normalExit,harnessProcessReceipt:r.harnessProcessReceipt??(app?app.observedProcess():null),quitObservations:r.quitObservations,nativeEvents:r.nativeEvents,forcedClose:r.forcedClose});await persist()}}"
assert old in s;s=s.replace(old,new)
a=s.index("\nfinally{\n");s=s[:a]+'''
finally{
 const cleanupStep=async(label,work)=>{try{return await work()}catch(error){r.cleanupErrors.push({label,error:String(error),atMs:Date.now()});return null}};
 try{
  if(app){
   await cleanupStep('resource-observation',resources);
   await cleanupStep('stop-owned-fixture-roots',stopFixtures);
   await cleanupStep('restore-own-observers',restoreObservers);
   await cleanupStep('normal-own-app-exit',async()=>{if(!r.quitRequestedAtMs)await normalPhaseQuit();else if(app)await app.waitForExit(45000)});
   if(app){const remaining=app;try{await cleanupStep('save-own-app-log',()=>writeFile(root+'/electron-'+instance+'.log',remaining.logs()));await cleanupStep('harness-exact-owned-close',()=>remaining.close());await cleanupStep('real-child-exit-receipt',async()=>{r.harnessProcessReceipt=remaining.observedProcess();r.forcedClose=r.harnessProcessReceipt.signals.some(x=>x.method==='close')})}finally{app=null}}
  }
 }finally{
  await cleanupStep('native-lifecycle-log',async()=>{r.nativeEvents=await traceRows();for(const event of r.nativeEvents){if(event.state?.osPid>0)pids.add(event.state.osPid);for(const m of event.snapshot?.metrics??[])if(m.pid>0)pids.add(m.pid)}});
  await cleanupStep('owned-agent-events',async()=>{r.agentEvents=await events();for(const e of r.agentEvents)if(e.pid)pids.add(e.pid)});
  await cleanupStep('close-owned-fixture-server',async()=>{for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(ok=>server.close(ok));r.serverClosed=true});
  r.knownPids=[...pids];r.knownPorts=[...ports];r.knownPageIds=Object.values(r.pages).map(x=>x.pageId);r.finishedAt=new Date().toISOString();
  try{await cleanupStep('last-live-write',persist)}finally{await save('raw.json',r)}
  console.log(JSON.stringify({root,status:r.status,error:r.error,stage,phases:r.phases.map(x=>({instance:x.instance,pid:x.pid,outcome:x.normalExit})),pids:r.knownPids,ports:r.knownPorts,serverClosed:r.serverClosed,cleanupErrors:r.cleanupErrors}));
 }
}
'''
p.write_text(s)
