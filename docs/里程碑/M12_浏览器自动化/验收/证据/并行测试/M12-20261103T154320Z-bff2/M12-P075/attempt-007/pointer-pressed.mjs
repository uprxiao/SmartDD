import assert from'node:assert/strict';import{press}from'./driver-source/scripts/files/keyboard-ax-lib.mjs';
import{toolbarInventory}from'./ui-cases.mjs';import{tabState}from'./affected-tabs.mjs';
export async function runPointerPressed(c,theme){
 await c.setThemeThroughUI(theme);await c.prepareToolbarHistoryThroughUI();
 const result={case:'M12-T147',segment:'pure-pointer-pressed',theme,buttons:[],missing:[],inventory:await c.app.evaluate('('+toolbarInventory.toString()+')()'),boundary:'Onlyaffectedactivebuttons: actualUIblur, pointerhoverbefore andheldmousepress; no keyboardoutline counted aspressedfeedback.'};
 const state=selector=>c.app.evaluate('('+tabState.toString()+')('+JSON.stringify(selector)+')');
 const settle=selector=>c.poll(async()=>await c.app.evaluate('document.querySelector('+JSON.stringify(selector)+').getAnimations({subtree:true}).every(a=>a.playState!=="running")'),2000);
 async function one(key,selector){
  const row={key,selector};result.buttons.push(row);await c.recordPartial(result);
  if(['pause','resume'].includes(key)){await c.click('[aria-label="网页地址"]');await c.moveOutsideToolbar();await settle(selector);row.baseline=await state(selector);await c.shot('T147-'+theme+'-pointer-'+key+'-baseline.png');row.keyboardTrace=[];await c.recordPartial(result);for(let step=0;step<40;step++){await press(c.app,'Tab');const focused=await state(selector);row.keyboardTrace.push({step,key:'Tab',targetFocused:focused.focused,focusVisible:focused.focusVisible});await c.recordPartial(result);if(focused.focused)break;}await settle(selector);row.focused=await state(selector);await c.shot('T147-'+theme+'-pointer-'+key+'-focus.png');await c.recordPartial(result);assert(row.keyboardTrace.length>0&&row.focused.focused&&row.focused.focusVisible,'Newconditionalpillrequiresactualkeyboardfocusproof');}
  await c.click('[aria-label="网页地址"]');const before=await c.workspace(),point=await c.hover(selector);await settle(selector);row.before=await state(selector);await c.shot('T147-'+theme+'-pointer-'+key+'-before.png');await c.recordPartial(result);assert(row.before.hover&&!row.before.focused&&!row.before.focusVisible,'Pointerbeforecannotretainkeyboardfocus');
  try{await c.app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await settle(selector);row.pressed=await state(selector);await c.shot('T147-'+theme+'-pointer-'+key+'-pressed.png');await c.recordPartial(result);assert(row.pressed.active&&!row.pressed.focusVisible,'Purepointerpressmustnotborrowkeyboardoutline');}
  finally{const out=await c.moveOutsideToolbar();await c.app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...out,button:'left',clickCount:1})}
  const after=await c.workspace();assert.deepEqual(after.tabs.map(x=>x.id),before.tabs.map(x=>x.id));assert.equal(after.activeId,before.activeId);row.pageIdentityPreserved=true;await c.recordPartial(result);
 }
 for(const [key,label]of[['newtab','新建网页标签'],['back','后退'],['forward','前进'],['reload','刷新网页'],['download','下载'],['menu','浏览器菜单']]){
  const item=result.inventory.find(x=>x.tag==='BUTTON'&&x.label===label&&!x.disabled);if(!item){result.missing.push({key,label,reason:'Actualenabledcontrolnotpresent; notreplacedbymock'});await c.recordPartial(result);continue;}await one(key,item.selector);
 }
 result.loadingPreparation=await c.prepareLoadingStateThroughUI();await one('stop','[aria-label="停止加载"]');await c.finishLoadingStateThroughUI();await c.prepareToolbarHistoryThroughUI();
 // Genuine read-only native CLI creates production activity; no store/RPC setter.
 const workspace=await c.workspace();result.activityCli=await c.actualSnapshotForActivity(theme,workspace.activeId);await c.poll(async()=>await c.app.evaluate('Boolean(document.querySelector(".bw-toolbar .bw-pause"))'),5000);
 await one('pause','.bw-toolbar .bw-pause');await c.click('.bw-toolbar .bw-pause');await c.poll(async()=>await c.app.evaluate('Boolean(document.querySelector(".bw-toolbar .bw-resume"))'),5000);result.actualUiPause=(await c.workspace()).paused;assert.equal(result.actualUiPause,true);
 await one('resume','.bw-toolbar .bw-resume');await c.click('.bw-toolbar .bw-resume');await c.poll(async()=>!(await c.workspace()).paused,5000);result.actualUiRestored=true;
 await c.record(result);return result;
}
