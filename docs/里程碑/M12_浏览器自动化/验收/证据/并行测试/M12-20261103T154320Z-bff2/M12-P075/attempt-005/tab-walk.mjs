import assert from'node:assert/strict';
import{press}from'./driver-source/scripts/files/keyboard-ax-lib.mjs';
export function tabDescriptor(inventory){
 const e=document.activeElement,r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null,workspace=document.querySelector('[data-testid=file-workspace]');
 const matches=inventory.filter(x=>document.querySelector(x.selector)===e).map(x=>x.selector),label=e?.getAttribute('aria-label')||e?.title||e?.textContent?.trim()||'';
 const m9Labels=['查找并打开文件','文件全屏','退出文件全屏','隐藏文件区域'];
 return{tag:e?.tagName??null,label,role:e?.getAttribute('role'),tabIndex:e?.tabIndex,disabled:Boolean(e?.disabled),connected:Boolean(e?.isConnected),hiddenAncestor:Boolean(e?.closest('[hidden],[inert],[aria-hidden="true"]')),style:s?{display:s.display,visibility:s.visibility,opacity:s.opacity}:null,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,visible:Boolean(r?.width&&r?.height&&s?.display!=='none'&&s?.visibility==='visible'&&Number(s.opacity)>0&&!e?.closest('[hidden],[inert],[aria-hidden="true"]')),inWorkspace:Boolean(workspace?.contains(e)),matches,allowedM9Interleaving:Boolean(e?.tagName==='BUTTON'&&e?.parentElement?.matches('.fw-tabs')&&m9Labels.includes(label))};
}
export async function walkRealTabs(app,inventory,{click,recordAction,theme,scenario}){
 const enabled=inventory.filter(x=>!x.disabled),first=enabled[0];assert(first?.tag==='BUTTON');await click(first.selector);const browserStops=[],allStops=[];
 for(let step=0;step<60;step++){
  const active=await app.evaluate('('+tabDescriptor.toString()+')('+JSON.stringify(inventory)+')');
  const row={kind:'T147-actual-tab-stop',theme,scenario,step,active};allStops.push(row);await recordAction(row);
  // Every actual stop is persisted before these assertions, including failure.
  assert(active.connected&&active.visible&&!active.hiddenAncestor&&!active.disabled,'Hidden/disconnected/disabled Tab focus');
  assert(active.matches.length===1||active.matches.length===0&&active.allowedM9Interleaving,'Unexpected Tab focus outside browser inventory and explicit visible M9 controls');
  if(active.matches.length){const item=enabled.find(x=>x.selector===active.matches[0]);assert(item,'Disabled inventory item received Tab focus');assert(!browserStops.some(x=>x.selector===item.selector),'Browser Tab repeated before complete sequence');browserStops.push({selector:item.selector,...active});if(browserStops.length===enabled.length)break;}
  await press(app,'Tab');
 }
 assert.equal(browserStops.length,enabled.length,'All original B01/B02/address stops required');
 const expected=enabled.slice().sort((a,b)=>Math.abs(a.rect.y-b.rect.y)>8?a.rect.y-b.rect.y:a.rect.x-b.rect.x).map(x=>x.selector);
 assert.deepEqual(browserStops.map(x=>x.selector),expected,'Browser relative Tab sequence must match visual order');
 return{browserStops,allStops,expected,disabledInventory:inventory.filter(x=>x.disabled),allowedM9Interleavings:allStops.filter(x=>x.active.allowedM9Interleaving)};
}
