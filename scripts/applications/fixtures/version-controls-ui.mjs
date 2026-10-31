import assert from 'node:assert/strict';
import {join} from 'node:path';
import {measureActivityControl} from './activity-controls-ui.mjs';

// SV: existing version driver owns state transitions; observe original controls.
export async function checkVersionControls({app,result,root,context,state,key}){
 const dialog=state==='default-refs',scope=dialog?'dialog[open]':'.m10-versions';
 const selectors=dialog?{headerClose:scope+' [aria-label="关闭弹窗"]',close:scope+' footer button:last-child'}:{check:scope+' .m10-section-heading button',...(state==='error'?{retry:scope+' .m10-empty button'}:{}),...(state==='ready'?{references:scope+' .m10-version-row:has(.m10-inline-label) .m10-version-actions button:first-child'}:{})};
 const d=result.versionControls??={contexts:[],boundary:'Actual pointer/Tab/disabled click only; original SH driver owns version transitions, no effective control activation by observer.'};
 const record={context,state,controls:{},disabledClicks:[]};d.contexts.push(record);
 const fingerprint=()=>app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(scope)});return JSON.stringify({text:e.innerText,buttons:[...e.querySelectorAll('button')].map(b=>[b.textContent,b.disabled]),dialog:!!document.querySelector('dialog[open]')})})()`);
 const before=await fingerprint();
 async function point(selector,click=false){
  const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('SV original control missing');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(!r.width||!r.height||!(h===e||e.contains(h)))throw Error('SV original control obscured');return{x,y}})()`);
  for(const type of click?['mouseMoved','mousePressed','mouseReleased']:['mouseMoved'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 }
 const neutral=scope+(dialog?' h2': ' .m10-section-heading h2');
 for(const [name,selector] of Object.entries(selectors)){
  const expression='document.querySelector('+JSON.stringify(selector)+')';
  assert.equal(await app.evaluate('document.querySelectorAll('+JSON.stringify(selector)+').length'),1,'SV unique semantic control');
  await point(neutral,true);await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  const disabled=await app.evaluate(expression+'.disabled'),entry=record.controls[name]={selector,disabled};
  await point(selector);await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});entry.normal=await measureActivityControl(app,expression);
  await point(selector);await app.waitFor(expression+".matches(':hover')",5000);entry.hover=await measureActivityControl(app,expression);assert(entry.hover.hover&&entry.hover.visible,'SV actual hover visible');
  if(disabled){await point(selector,true);record.disabledClicks.push(name);assert.equal(await fingerprint(),before);}
  else{
   await point(neutral,true);let reachable=false;
   for(let n=0;n<180;n++){await key('Tab','Tab',9);if(await app.evaluate('document.activeElement==='+expression)){reachable=true;break;}}
   assert(reachable,'SV original control Tab reachable: '+name);entry.focus=await measureActivityControl(app,expression);
   assert(entry.focus.focusVisible&&entry.focus.visible&&entry.focus.outlineVisible,'SV focus paint and outline visible: '+name+' '+JSON.stringify(entry.focus));
  }
  await app.screenshot(join(root,'sv-'+context+'-'+state+'-'+name+'.png'));
 }
 assert.equal(await fingerprint(),before,'SV observer preserves original business view');record.statePreserved=true;
}
