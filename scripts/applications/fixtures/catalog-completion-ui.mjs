// QN: missing P01 search/filter/add return states; native small-window long names.
// Read-only capture; original drivers own every tested action. No style/store writes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {checkCatalogControls,catalogBaseControls} from './catalog-controls-ui.mjs';
const readyControls=process.env.WILLYOU_CATALOG_READY_CONTROLS_UI==='1';
const catalogControls=process.env.WILLYOU_CATALOG_CONTROLS_UI==='1';
export async function captureCatalogCompletion({app,result,root,theme,state,minimum=false}){
 const rows=result.catalogCompletion??=[];
 let original;
 if(minimum){
  original=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(join(root,'userdata'))})throw Error('Own QN instance');const ws=E.BrowserWindow.getAllWindows();if(ws.length!==1)throw Error('One QN window');const w=ws[0],s=w.getContentSize();if(w.getMinimumSize().join()!=='700,500')throw Error('Native minimum');w.setSize(700,500,false);return s})()`);
  await app.waitFor('innerWidth===700&&innerHeight===500');
 }
 try{
  await app.waitFor("![...document.querySelectorAll('.m10-toast,[data-sonner-toast]')].some(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height)",6000);
  await app.waitFor("document.fonts.status==='loaded'&&document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");
  const observation=await app.evaluate(`(()=>{const paint=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent.trim(),rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},style:Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','overflowX','textOverflow','whiteSpace'].map(k=>[k,s[k]])),disabled:e.disabled,selected:e.getAttribute('aria-selected')}};return{theme:document.documentElement.dataset.theme==='dark'||document.documentElement.classList.contains('ydark')?'dark':'light',width:innerWidth,height:innerHeight,search:document.querySelector('.m10-search input').value,selected:[...document.querySelectorAll('.m10-tabs button')].filter(e=>e.getAttribute('aria-selected')==='true').map(e=>e.textContent.trim()),head:[...document.querySelectorAll('.m10-head-actions button')].map(paint),cards:[...document.querySelectorAll('.m10-catalog-item')].map(paint),empty:document.querySelector('.m10-empty')?.textContent.trim(),tabs:[...document.querySelectorAll('.m10-tabs button')].map(paint)}})()`);
  if(state.endsWith('-controls')){
   result.lastCatalogControlObservation={theme,state,observation};
   assert.deepEqual(observation.head.map(h=>h.disabled),state==='loading-controls'?[true,true]:[false,true],'QO refresh/add availability matches actual catalog phase');
  }
  assert.equal(observation.theme,theme,'Actual theme must match the scope');
  assert(observation.cards.every(c=>c.rect.x>=0&&c.rect.right<=observation.width+1),'Catalog cards stay within the actual native viewport');
  const file='qn-'+theme+'-'+state+(minimum?'-minimum':'')+'.png';
  // Existing visual probe is intentionally fixed at 1400x900. Small native shots
  // use only the read-only capture command, without relaxing its original contract.
  if(minimum){const shot=await app.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,file),Buffer.from(shot.data,'base64'));}
  else await app.screenshot(join(root,file));
  const sample={theme,state,minimum,observation,file};rows.push(sample);
  if(minimum){
   const seen=new Set();sample.scrollFrames=[];
   for(let step=0;step<18;step++){
    const frame=await app.evaluate(`(()=>{const c=document.querySelector('.m10-content'),cr=c.getBoundingClientRect(),targets=[...document.querySelectorAll('.m10-catalog-open strong,.m10-later button')];return{top:c.scrollTop,max:c.scrollHeight-c.clientHeight,point:{x:Math.min(cr.right-20,innerWidth-20),y:Math.min(cr.bottom-40,innerHeight-40)},targets:targets.map((e,i)=>{const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;return{i,text:e.textContent,visible:r.top>=Math.max(0,cr.top)&&r.bottom<=Math.min(innerHeight,cr.bottom)&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(x,y))}})}})()`);
    const newTargets=frame.targets.filter(t=>t.visible&&!seen.has(t.i));for(const t of newTargets)seen.add(t.i);
    if(newTargets.length){const shot=await app.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});frame.file=file.replace('.png','-scroll-'+step+'.png');await writeFile(join(root,frame.file),Buffer.from(shot.data,'base64'));}
    sample.scrollFrames.push(frame);
    if(seen.size===3)break;
    assert(frame.top<frame.max-1,'Reached scroll end before every long name and footer');
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...frame.point,deltaX:0,deltaY:180});await app.waitFor(`document.querySelector('.m10-content').scrollTop>${frame.top}`,2500);
   }
   assert.equal(seen.size,3,'Both full long names and the footer are reachable without overlay');sample.allLongNamesAndFooterReached=true;
   const last=sample.scrollFrames.at(-1);await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...last.point,deltaX:0,deltaY:-10000});await app.waitFor("document.querySelector('.m10-content').scrollTop===0",3000);
  }
  if(catalogControls&&state.endsWith('-controls'))await checkCatalogControls({app,result,root,userData:join(root,'userdata'),theme,state});
  if(readyControls&&['search-match','search-empty','added-empty','ready','menu'].includes(state)){
   const overlay=state==='menu',controlSelectors=overlay?{menu0:'.m10-menu [role=menuitem]:nth-child(1)',menu1:'.m10-menu [role=menuitem]:nth-child(2)'}:{...catalogBaseControls,card0open:'.m10-catalog-item:nth-child(1) .m10-catalog-open',card0action:'.m10-catalog-item:nth-child(1)>button:last-child',card1open:'.m10-catalog-item:nth-child(2) .m10-catalog-open',card1action:'.m10-catalog-item:nth-child(2)>button:last-child',onboarding:'.m10-onboarding button',later:'.m10-later button'};
   await checkCatalogControls({app,result,root,userData:join(root,'userdata'),theme,state,controlSelectors,resultKey:'catalogReadyControls',allowMissing:true,requiredKeys:overlay?['menu0','menu1']:['refresh','add','search','all','added'],overlay});
  }
  return observation;
 }finally{if(original){await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(join(root,'userdata'))})throw Error('Own QN restore');E.BrowserWindow.getAllWindows()[0].setContentSize(${original[0]},${original[1]},false);return true})()`);await app.waitFor(`innerWidth===${original[0]}&&innerHeight===${original[1]}`);}}
}
