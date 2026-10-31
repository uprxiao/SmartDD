// PZ/T22: shared read-only body geometry/paint with actual native size and wheel input.
import assert from 'node:assert/strict';
import {join} from 'node:path';
const properties=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','whiteSpace','overflowWrap','marginTop','marginBottom'];
export async function captureBodyVisual({app,result,root,userData,label,html=false}){
 const record=result.bodyVisual??={scopes:[],failures:[],boundary:'Native resize/wheel and read-only DOM paint;not whole-window pixel equality'};
 for(const size of ['regular','minimum']){
  const native=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own PZ U required');const ws=E.BrowserWindow.getAllWindows();if(ws.length!==1)throw Error('One PZ window required');const w=ws[0];if(${JSON.stringify(size)}==='minimum')w.setSize(700,500,false);else w.setContentSize(1400,900,false);return{bounds:w.getBounds(),content:w.getContentSize(),minimum:w.getMinimumSize()}})()`);
  await app.waitFor(`innerWidth===${size==='minimum'?700:1400}&&innerHeight===${size==='minimum'?500:900}&&document.fonts.status==='loaded'`);
  const scope=await app.evaluate(`(()=>{const d=document.querySelector('dialog[open]'),c=getComputedStyle(d),dr=d.getBoundingClientRect(),pres=[...d.querySelectorAll('.m10-review>pre,.m10-review>.m10-resource-view>pre,.m10-html-preview pre,.m10-attachment-preview pre')];return{label:${JSON.stringify(label)},size:${JSON.stringify(size)},width:innerWidth,height:innerHeight,maxHeight:parseFloat(c.maxHeight),expectedMaxHeight:innerHeight-60,dialog:{x:dr.x,y:dr.y,width:dr.width,height:dr.height,clientWidth:d.clientWidth,scrollWidth:d.scrollWidth,scrollHeight:d.scrollHeight,scrollTop:d.scrollTop},pres:pres.map(p=>({kind:p.closest('.m10-html-preview')?'html':p.closest('.m10-attachment-preview')?'attachment':'body',characters:p.textContent.length,childElements:p.children.length,style:Object.fromEntries(${JSON.stringify(properties)}.map(k=>[k,getComputedStyle(p)[k]]))})),activeTags:[...d.querySelectorAll('.m10-html-preview,.m10-attachment-preview')].flatMap(p=>[...p.querySelectorAll('script,style,img,iframe,object,embed,form,a,link')].map(e=>e.tagName))}})()`);scope.native=native;record.scopes.push(scope);
  if(scope.maxHeight!==scope.expectedMaxHeight)record.failures.push(scope.label+'-'+size+' wide max-height '+scope.maxHeight+' != prototype '+scope.expectedMaxHeight);
  assert(scope.pres.length>0&&scope.pres.every(p=>p.childElements===0),'Body and HTML must remain inert text');assert.deepEqual(scope.activeTags,[]);assert(scope.dialog.scrollWidth<=scope.dialog.clientWidth+1,'No dialog horizontal overflow');
  for(const p of scope.pres)if(p.style.fontSize!=='12px'||p.style.lineHeight!=='22px'||!p.style.fontFamily.includes('system-ui'))record.failures.push(scope.label+'-'+size+' '+p.kind+' prose typography differs from the approved 12px/22px system font');
  if(html)assert(scope.pres.some(p=>p.kind==='html'));
  if(scope.dialog.scrollHeight>scope.dialog.height+4){
   const wheel=await app.evaluate("(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+Math.min(100,r.height/2);if(!d.contains(document.elementFromPoint(x,y)))throw Error('Wheel must hit own dialog');return{x,y,before:d.scrollTop,deltaY:d.scrollTop>0?-180:180}})()");
   await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:wheel.x,y:wheel.y});await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:wheel.x,y:wheel.y,deltaX:0,deltaY:wheel.deltaY});await app.waitFor('document.querySelector("dialog").scrollTop!=='+wheel.before,3000);scope.wheel={...wheel,after:await app.evaluate('document.querySelector("dialog").scrollTop')};
  }
  await app.screenshot(join(root,label+'-'+size+'-body-layout.png'));
 }
}
