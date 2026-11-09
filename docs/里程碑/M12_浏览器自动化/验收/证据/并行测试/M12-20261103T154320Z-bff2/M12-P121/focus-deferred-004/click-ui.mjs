// The original003 geometry/click path only. No text, key or terminal sender API.
import assert from 'node:assert/strict';
export function makeClickUI(app,record){
 const geometry=(selector)=>app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!e)throw Error('Own UI control missing');e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('OwnUI control blocked');return{x,y}})()`);
 return async selector=>{await app.checkInputFocus('T125.ReadinessOnlyUI');const p=await geometry(selector);await app.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');assert.deepEqual(await geometry(selector),p);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await record({kind:'click',selector,point:p});};
}
