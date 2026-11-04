from pathlib import Path
r=Path('/private/tmp/willyou-m12-p070-js-dialog-native-003-a');p=r/'run.mjs';s=p.read_text()
s=s.replace("case:'M12-T068',layer:'I only; actualNative/M11/v2/CLI/fixedHelper; notA/modelR'", "case:'T068-supplement-003A',layer:'SupplementalI actualNative/M11/v2/CLI; Helperpointer and hostdialog; notA/modelR'")
s=s.replace("steps:[],scenarios:[],messages:[]", "steps:[],scenarios:[],pointerScenarios:[],compatScenarios:[],messages:[]")
s=s.replace("['steps','scenarios','messages'", "['steps','scenarios','pointerScenarios','compatScenarios','messages'")
start=s.index("r.hostPrecheck=await ok(");end=s.index("}catch(error){r.status=",start)
body=r'''r.hostPrecheck=await ok('host-title-precheck-not-helper-warmup',['browser','get','--what','title','--page',r.page.id]);
 r.stage='real-helper-warmup';r.helperWarmup=await ok('actual-fixed-helper-console',['browser','console','--page',r.page.id]);r.warmState=await call({command:'dialog-state'});assert(r.warmState.helperSpawnCount>0,'ActualHelper executable must have launched');assert(r.warmState.pages.find(x=>x.id===r.page.id).helperDaemonPid>0,'ActualHelperdaemon must exist');await resources();
 const contract=JSON.parse(await readFile(root+'/contract-3a.json'));
 async function pageRead(label,expression,pageId){const step=await ok(label,['browser','eval','--expression',expression,'--page',pageId]);return{step,value:JSON.parse(step.parsed.data.value)}}
 async function openingFor(row,pageId){return poll(async()=>{const state=await call({command:'dialog-state'});row.queueObservations.push({atMs:Date.now(),pages:state.pages,helperSpawnCount:state.helperSpawnCount});return state.dialogs.slice(row.beforeEventCount).find(e=>e.pageId===pageId&&e.method==='Page.javascriptDialogOpening'&&e.params.message===row.message)},12000)}
 async function completeAnswer(row,pageId,args){row.response=await cli('answer-'+row.id,args);row.actual=await poll(()=>fixture.results.find(x=>x.id===row.id),10000);row.closed=await poll(async()=>{const state=await call({command:'dialog-state'});return state.dialogs.slice(row.beforeEventCount).find(e=>e.pageId===pageId&&e.method==='Page.javascriptDialogClosed')},10000);row.readback=await pageRead('return-'+row.id,'window.p070Results['+JSON.stringify(row.id)+']',pageId);row.events=(await call({command:'dialog-state'})).dialogs.slice(row.beforeEventCount);await persist()}
 for(const spec of contract.pointerCases){
  r.stage='pointer-'+spec.id;const before=await call({command:'dialog-state'}),row={...spec,id:'p0703a-'+spec.id,message:'M12 pointer '+spec.id,beforeEventCount:before.dialogs.length,queueObservations:[],startedAtMs:Date.now()};r.pointerScenarios.push(row);await persist();
  fixture.trigger({channel:'pointer',mode:'arm-pointer',id:row.id,kind:'prompt',trigger:spec.trigger,message:row.message,defaultValue:'pointer-initial'});
  row.armedRead=await pageRead('armed-'+row.id,'({armed:window.p070Pointer.armed,counts:window.p070Pointer.counts})',r.page.id);assert.equal(row.armedRead.value.armed.id,row.id);
  let pointerPromise;
  if(spec.id==='helper-mousedown-paired-up'){
   row.geometry=await pageRead('geometry-'+row.id,'(()=>{const r=document.querySelector("#primary").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()',r.page.id);
   row.move=await ok('mousemove-'+row.id,['browser','mouse','move','--x',String(row.geometry.value.x),'--y',String(row.geometry.value.y),'--page',r.page.id]);
   pointerPromise=cli('mousedown-'+row.id,['browser','mouse','down','--button','left','--page',r.page.id]);
  }else pointerPromise=cli('find-primary-'+row.id,['browser','find','--locator','testid','--value','primary','--action','click','--page',r.page.id]);
  row.opening=await openingFor(row,r.page.id);await persist();
  await completeAnswer(row,r.page.id,['browser','dialog','accept','--text','answered-'+spec.id,'--page',r.page.id]);
  row.pointer=await pointerPromise;
  if(spec.id==='helper-mousedown-paired-up')row.up=await cli('mouseup-'+row.id,['browser','mouse','up','--button','left','--page',r.page.id]);
  row.followup=await cli('find-followup-'+row.id,['browser','find','--locator','testid','--value','followup','--action','click','--page',r.page.id]);
  row.pointerState=await pageRead('pointer-state-'+row.id,'({events:window.p070Pointer.events.filter(e=>e.caseId==='+JSON.stringify(row.id)+'),counts:window.p070Pointer.counts['+JSON.stringify(row.id)+']})',r.page.id);
  row.finishedAtMs=Date.now();await resources();await persist();
 }
 r.stage='compat-create-independent-page';r.compatCreated=await call({command:'create-compat-page'});r.compatPageId=r.compatCreated.pageId;await poll(()=>fixture.ready('compat'),10000);r.compatColdBefore=r.compatCreated.state.pages.find(x=>x.id===r.compatPageId);assert.equal(r.compatColdBefore.helperDaemonPid,null);assert.equal(r.compatColdBefore.helperActivePid,null);
 const positive=[{id:'exec-accept-text',kind:'prompt',action:'accept',text:'compat-中文',exec:'dialog accept "compat-中文"',expected:'compat-中文'},{id:'exec-dismiss',kind:'prompt',action:'dismiss',exec:'dialog dismiss',expected:null},{id:'dedicated-empty',kind:'prompt',action:'accept',text:'',expected:''},{id:'dedicated-default',kind:'prompt',action:'accept',omitted:true,expectedFromOpening:true}];
 for(const spec of positive){
  r.stage='compat-'+spec.id;const before=await call({command:'dialog-state'}),row={...spec,id:'p0703a-'+spec.id,message:'M12 compat '+spec.id,beforeEventCount:before.dialogs.length,queueObservations:[],startedAtMs:Date.now()};r.compatScenarios.push(row);await persist();fixture.trigger({channel:'compat',id:row.id,kind:spec.kind,message:row.message,defaultValue:'compat-default'});row.opening=await openingFor(row,r.compatPageId);
  const args=spec.exec?['browser','exec','--command',spec.exec,'--page',r.compatPageId]:['browser','dialog',spec.action,...(spec.omitted?[]:['--text',spec.text]),'--page',r.compatPageId];await completeAnswer(row,r.compatPageId,args);row.finishedAtMs=Date.now();await persist();
 }
 for(const mode of['dedicated','exec'])for(const action of['accept','dismiss']){
  r.stage='no-pending-'+mode+'-'+action;const row={id:'no-pending-'+mode+'-'+action,negative:true,mode,action,before:await call({command:'dialog-state'}),startedAtMs:Date.now()};r.compatScenarios.push(row);await persist();const args=mode==='exec'?['browser','exec','--command','dialog '+action,'--page',r.compatPageId]:['browser','dialog',action,'--page',r.compatPageId];row.response=await cli(row.id,args);row.after=await call({command:'dialog-state'});row.finishedAtMs=Date.now();await persist();
 }
 r.after=await call({command:'dialog-state'});r.status='executed-unjudged';
'''
s=s[:start]+body+s[end:]
s=s.replace("r.siteResults=fixture.results;r.knownPids", "r.siteResults=fixture.results;r.sitePointerEvents=fixture.events;r.knownPids")
s=s.replace("r.knownPageIds=r.page?[r.page.id]:[]", "r.knownPageIds=[r.page?.id,r.compatPageId].filter(Boolean)")
p.write_text(s)
