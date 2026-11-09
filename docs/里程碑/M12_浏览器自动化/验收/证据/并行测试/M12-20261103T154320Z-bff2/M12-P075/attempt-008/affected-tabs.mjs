import assert from'node:assert/strict';
import{press}from'./driver-source/scripts/files/keyboard-ax-lib.mjs';
import{toolbarInventory,visualProperties}from'./ui-cases.mjs';
export function tabState(selector){const e=document.querySelector(selector);if(!e)throw Error('Affectedtabmissing');const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{ariaSelected:e.getAttribute('aria-selected'),parentSelected:e.parentElement.classList.contains('selected'),active:e.matches(':active'),focused:document.activeElement===e,focusVisible:e.matches(':focus-visible'),hover:e.matches(':hover'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},css:{background:s.backgroundColor,color:s.color,border:s.borderColor,outline:s.outline,outlineOffset:s.outlineOffset,shadow:s.boxShadow,opacity:s.opacity,transform:s.transform,filter:s.filter,parentBackground:getComputedStyle(e.parentElement).backgroundColor},text:e.textContent,ariaLabel:e.getAttribute('aria-label'),title:e.title};}
export async function runAffectedTabs(c,theme){
 await c.setThemeThroughUI(theme);await c.prepareToolbarHistoryThroughUI();
 const inventory=await c.app.evaluate('('+toolbarInventory.toString()+')()'),items=inventory.filter(x=>x.webTab&&x.tag==='BUTTON'&&!x.disabled);assert.equal(items.length,4);assert.equal(items.filter(x=>x.role==='tab').length,2);
 const result={case:'M12-T147',segment:'affected-tabs',theme,inventory,buttons:[],boundary:'App019 actualonly. Four affectedtabbuttons, allfourstates; real ShiftTab before focus proof. Old B02/Tab evidence separate by hash, noT146nativeTooltippass.'};
 const state=selector=>c.app.evaluate('('+tabState.toString()+')('+JSON.stringify(selector)+')');
 const settle=selector=>c.poll(async()=>await c.app.evaluate('document.querySelector('+JSON.stringify(selector)+').getAnimations({subtree:true}).every(a=>a.playState!=="running")'),2000);
 for(const item of items){
  const row={item};result.buttons.push(row);const prefix='T147-'+theme+'-affected-'+item.index;
  await c.click('[aria-label="网页地址"]');await c.moveOutsideToolbar();await settle(item.selector);row.baseline=await state(item.selector);await c.shot(prefix+'-baseline.png');await c.recordPartial(result);
  await c.hover(item.selector);await settle(item.selector);row.hovered=await state(item.selector);await c.shot(prefix+'-hover.png');await c.recordPartial(result);
  await c.moveOutsideToolbar();row.keyboardTrace=[];
  // Always dispatch at least one actual keyboard Tab; never accept mouse focus.
  for(let step=0;step<80;step++){await press(c.app,'Tab',{shift:true});const target=await state(item.selector),active=await c.app.evaluate('(()=>{const e=document.activeElement;return{tag:e.tagName,label:e.getAttribute("aria-label")||e.title||e.textContent.trim(),focusVisible:e.matches(":focus-visible")}})()');row.keyboardTrace.push({step,key:'Shift+Tab',active,targetFocused:target.focused});await c.recordPartial(result);if(target.focused)break;}
  await settle(item.selector);row.focused=await state(item.selector);await c.shot(prefix+'-focus.png');await c.recordPartial(result);assert(row.keyboardTrace.length>0&&row.focused.focused&&row.focused.focusVisible,'Actual keyboard focus-visible required on every affectedtabbutton');
  await c.click('[aria-label="网页地址"]');const before=await c.workspace(),point=await c.hover(item.selector);await settle(item.selector);row.pressedBefore=await state(item.selector);await c.recordPartial(result);assert(!row.pressedBefore.focused&&!row.pressedBefore.focusVisible,'Purepointerprepressmustnotretainkeyboardfocus');try{await c.app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await settle(item.selector);row.pressed=await state(item.selector);await c.shot(prefix+'-pressed.png');await c.recordPartial(result);assert(row.pressed.active&&!row.pressed.focusVisible,'Purepointerheldpressmustnotborrowkeyboardoutline');}finally{const outside=await c.moveOutsideToolbar();await c.app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...outside,button:'left',clickCount:1})}
  const after=await c.workspace();assert.deepEqual(after.tabs.map(x=>x.id),before.tabs.map(x=>x.id));assert.equal(after.activeId,before.activeId,'Outside release must not activate/close selectedor inactive tab');
 }
 await c.record(result);return result;
}
