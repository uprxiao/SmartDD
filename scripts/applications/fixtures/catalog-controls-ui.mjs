import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const catalogBaseControls={refresh:'.m10-head-actions [aria-label="刷新应用"]',add:'.m10-head-actions .m10-menu-wrap>button',search:'.m10-search input',all:'.m10-tabs button:first-child',added:'.m10-tabs button:last-child',retry:'.m10-empty button'};
const props=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','opacity','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderTopStyle','borderTopColor','borderRadius','boxShadow','outlineWidth','outlineStyle','outlineColor','outlineOffset','cursor','pointerEvents','whiteSpace','overflow','display','alignItems','justifyContent','gap','width','height'];
export async function checkCatalogControls({app,result,root,userData,theme,state,controlSelectors=catalogBaseControls,resultKey='catalogControls',allowMissing=false,requiredKeys=[],overlay=false,neutralSelector='.m10-page-head h1',fingerprintSource}){
 const selectors=controlSelectors,record=result[resultKey]??={contexts:[],boundary:'A/P actual pointer,Tab and disabled clicks; read-only paint/geometry; original driver owns catalog states'};
 const fingerprint=()=>app.evaluate(fingerprintSource??"JSON.stringify({search:document.querySelector('.m10-search input').value,tabs:[...document.querySelectorAll('.m10-tabs button')].map(e=>[e.textContent,e.getAttribute('aria-selected')]),cards:document.querySelectorAll('.m10-catalog-item').length,state:document.querySelector('.m10-empty')?.innerText,menu:!!document.querySelector('.m10-menu')})");
 const measure=selector=>app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e),svg=[...e.querySelectorAll('svg')],block=e.closest('.m10-app-heading,.m10-connection,.m10-section-heading,.m10-unconnected,.m10-sender-row,.m10-package-section')??document.querySelector('.m10-content'),br=block.getBoundingClientRect(),icon=block.matches('.m10-unconnected')?block.querySelector(':scope>svg'):null,ir=icon?.getBoundingClientRect();return{owner:{className:block.className,x:br.x,y:br.y,width:br.width,height:br.height,icon:icon?{display:getComputedStyle(icon).display,verticalAlign:getComputedStyle(icon).verticalAlign,centerOffset:ir.x+ir.width/2-br.x-br.width/2}:null},relative:{x:r.x-br.x+block.scrollLeft,y:r.y-br.y+block.scrollTop},text:e.textContent.trim(),disabled:!!e.disabled,focused:document.activeElement===e,focusVisible:e.matches(':focus-visible'),hover:e.matches(':hover'),rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},style:Object.fromEntries(${JSON.stringify(props)}.map(k=>[k,s[k]])),svg:svg.map(v=>({attributes:Object.fromEntries([...v.attributes].map(a=>[a.name,a.value])),children:[...v.children].map(c=>({tag:c.tagName,attributes:Object.fromEntries([...c.attributes].map(a=>[a.name,a.value]))}))})),searchWrapper:e.closest('.m10-search')?Object.fromEntries(['borderTopWidth','borderTopColor','backgroundColor','borderRadius','boxShadow','outlineWidth','outlineColor'].map(k=>[k,getComputedStyle(e.closest('.m10-search'))[k]])):null}})()`);
 async function point(selector,click,edge=false){
  const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('SS control missing');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+(${edge}?2:r.height/2),hit=document.elementFromPoint(x,y),other=hit?.closest('button,input,select,a');if(!r.width||!r.height||!document.querySelector('.m10-content').contains(hit)||other&&other!==e&&!e.contains(other))throw Error('SS control obscured');return{x,y}})()`);
  for(const type of click?['mouseMoved','mousePressed','mouseReleased']:['mouseMoved'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 }
 const sizeBefore=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own SS instance');return E.BrowserWindow.getAllWindows()[0].getContentSize()})()`);
 try{
  for(const size of ['regular','minimum']){
   const width=size==='regular'?1400:700,height=size==='regular'?900:500;
   await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');E.BrowserWindow.getAllWindows()[0].setContentSize(${width},${height},false);return true})()`);
   await app.waitFor(`innerWidth===${width}&&innerHeight===${height}&&document.fonts.status==='loaded'`);
   await point(overlay?'.m10-menu':neutralSelector,!overlay,overlay);
   const roster=await app.evaluate(`(()=>{const pairs=Object.entries(${JSON.stringify(selectors)}).map(([id,s])=>[id,[...document.querySelectorAll(s)]]);return{counts:Object.fromEntries(pairs.map(([id,nodes])=>[id,nodes.length])),aliases:pairs.flatMap(([id,nodes],i)=>pairs.slice(i+1).filter(([,other])=>nodes[0]&&nodes[0]===other[0]).map(([other])=>[id,other]))}})()`);assert.deepEqual(roster.aliases,[],'Each semantic control must resolve to a different element');assert(Object.entries(roster.counts).every(([id,n])=>allowMissing?(n<=1&&(!requiredKeys.includes(id)||n===1)):(id==='retry'?n<=1:n===1)),'Unique semantic catalog controls required');
   const before=await fingerprint(),context={theme,state,size,controls:{},focusOrder:[],focusMethod:overlay?'ArrowDown':'Tab',disabledClicks:[],frames:[]};record.contexts.push(context);
   for(const [id,selector] of Object.entries(selectors)){
    await point(overlay?'.m10-menu':neutralSelector,!overlay,overlay);const normal=await measure(selector);if(!normal)continue;
    await point(selector,false);await app.waitFor("document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");
    context.controls[id]={normal,hover:await measure(selector)};
    if(normal.disabled){await point(selector,true);assert.equal(await fingerprint(),before);context.disabledClicks.push(id);}
   }
   await point(overlay?'.m10-menu':neutralSelector,!overlay,overlay);const enabled=Object.keys(context.controls).filter(id=>!context.controls[id].normal.disabled),seen=new Set();
   for(let n=0;n<160&&seen.size<enabled.length;n++){
    for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:overlay?'ArrowDown':'Tab',code:overlay?'ArrowDown':'Tab',windowsVirtualKeyCode:overlay?40:9,nativeVirtualKeyCode:overlay?125:48});
    const id=await app.evaluate(`(()=>{const e=document.activeElement;return Object.entries(${JSON.stringify(selectors)}).find(([,s])=>e===document.querySelector(s))?.[0]??null})()`);
    if(id){assert(!context.controls[id].normal.disabled,'Disabled catalog control received Tab focus');if(!seen.has(id)){seen.add(id);context.focusOrder.push(id);context.controls[id].focus=await measure(selectors[id]);}}
   }
   assert.deepEqual([...seen].sort(),enabled.sort(),'Every enabled catalog control is keyboard reachable');assert.equal(await fingerprint(),before);
   context.statePreserved=true;context.width=width;context.height=height;
   const file=`ss-${theme}-${state}-${size}.png`,shot=await app.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,file),Buffer.from(shot.data,'base64'));context.frames.push(file);
   if(overlay){
    for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
    await app.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    context.tabExit=await app.evaluate("({closed:!document.querySelector('.m10-menu'),focus:{tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.textContent.trim().slice(0,80)}})");
    if(!context.tabExit.closed){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});await app.waitFor('!document.querySelector(".m10-menu")');}
    await point('.m10-head-actions .m10-menu-wrap>button',true);await app.waitFor('document.querySelectorAll(".m10-menu [role=menuitem]").length===2');
    assert.equal(await fingerprint(),before);
   }
   if(!overlay&&await app.evaluate("document.querySelector('.m10-content').scrollTop>0")){const p=await app.evaluate("(()=>{const r=document.querySelector('.m10-content').getBoundingClientRect();return{x:r.right-20,y:Math.min(r.bottom-30,innerHeight-30)}})()");await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:-10000});await app.waitFor("document.querySelector('.m10-content').scrollTop===0");}
  }
 }finally{
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');E.BrowserWindow.getAllWindows()[0].setContentSize(${sizeBefore[0]},${sizeBefore[1]},false);return true})()`);
  await app.waitFor(`innerWidth===${sizeBefore[0]}&&innerHeight===${sizeBefore[1]}`);
 }
}
