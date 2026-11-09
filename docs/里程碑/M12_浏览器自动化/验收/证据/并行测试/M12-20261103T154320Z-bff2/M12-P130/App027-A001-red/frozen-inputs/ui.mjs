// Real UI only. Bounded readiness and three animation-frame geometry stability.
import assert from 'node:assert/strict';
export function ui(app,record){
 const descriptor=(selector,text)=>app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':'e.textContent.trim()==='+JSON.stringify(text)});if(!e)return{missing:true};const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:e.textContent.trim(),disabled:Boolean(e.disabled),x,y,width:r.width,height:r.height,unblocked:e.contains(document.elementFromPoint(x,y))}})()`);
 async function click(selector,text){
  await app.checkInputFocus('M12.T132.Coexistence');const end=Date.now()+5000;let prior,stable=0,state;
  while(Date.now()<end){state=await descriptor(selector,text);if(!state.missing&&!state.disabled&&state.unblocked){const key=JSON.stringify([state.x,state.y,state.width,state.height]);stable=key===prior?stable+1:0;prior=key;if(stable>=3)break}else{stable=0;prior=undefined}await app.evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');}
  assert(stable>=3,'Trusted UI control not ready with stable geometry');await app.checkInputFocus('M12.T132.Coexistence');const current=await descriptor(selector,text);assert(!current.missing&&!current.disabled&&current.unblocked);assert.deepEqual([current.x,current.y,current.width,current.height],[state.x,state.y,state.width,state.height]);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:state.x,y:state.y,...(type==='mouseMoved'?{buttons:0}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})});
  await record({kind:'trusted-ui-click',selector,text,descriptor:state});
 }
 return{click,descriptor};
}
