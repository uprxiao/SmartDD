import assert from 'node:assert/strict';
import {pause} from './electron-harness.mjs';

// Original drag data comes from Chromium's actual pointer-triggered dragstart.
// CDP only delivers that captured payload to the target; no UUID/store state or
// application handler is manufactured. This is browser DnD, not physical OS DnD.
// Protocol source: https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl
export async function dragElectronElement(app,source,target){
 const point=async selector=>app.evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing actual drag control');e.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(requestAnimationFrame);const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Actual drag control occluded');return{x,y}})()`);
 const from=await point(source),to=await point(target);let intercepted;
 const off=app.onCDP('Input.dragIntercepted',event=>{intercepted=event.data});
 await app.cdp('Input.setInterceptDrags',{enabled:true});
 try{
  await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...from,buttons:0});
  await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=12&&!intercepted;i++){await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,button:'left',buttons:1});await pause(15)}
  const deadline=Date.now()+3000;while(!intercepted&&Date.now()<deadline)await pause(20);
  assert(intercepted,'Chromium did not report a real intercepted drag');
  for(const type of['dragEnter','dragOver','drop'])await app.cdp('Input.dispatchDragEvent',{type,...to,data:intercepted});
  await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  return{from,to,data:intercepted};
 }finally{off();await app.cdp('Input.cancelDragging').catch(()=>{});await app.cdp('Input.setInterceptDrags',{enabled:false})}
}
