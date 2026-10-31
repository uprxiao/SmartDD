import {checkCatalogControls} from './catalog-controls-ui.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkDetailControls({app,result,root,userData,theme,applicationId,state,layer}){
 if(layer==='P'){
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own SU prototype fixture only');return true})()`);
  const selector='[aria-label="当前应用项目"]';
  if(await app.evaluate('document.querySelector('+JSON.stringify(selector)+')?.value')){
   for(let i=0;i<160&&!await app.evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')');i++)for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
   if(!await app.evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'))throw Error('Own prototype project picker not keyboard reachable');
   await app.cdp('Input.dispatchKeyEvent',{type:'char',key:'选',text:'选'});
   for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
   await app.waitFor('document.querySelector('+JSON.stringify(selector)+')?.value===""');
   (result.detailControlPreparation??=[]).push({theme,applicationId,state,selectedProject:'',method:'Native picker matches the real App no-project prerequisite'});
  }
 }
 await app.evaluate('document.title='+JSON.stringify(layer+' · SU · 隔离应用详情控件')+';true');
 const emptyIcon=await app.evaluate("(()=>{const block=document.querySelector('.m10-unconnected'),icon=block?.querySelector(':scope>svg');if(!icon)return null;block.scrollIntoView({block:'center',behavior:'instant'});const r=block.getBoundingClientRect(),i=icon.getBoundingClientRect();return{centerOffset:i.x+i.width/2-r.x-r.width/2,display:getComputedStyle(icon).display,verticalAlign:getComputedStyle(icon).verticalAlign}})()");
 if(emptyIcon){
  const file=`su-${layer}-${theme}-${applicationId}-${state}-empty-icon.png`,shot=await app.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,file),Buffer.from(shot.data,'base64'));
  (result.detailEmptyIcons??=[]).push({theme,applicationId,state,...emptyIcon,file});
  assert(Math.abs(emptyIcon.centerOffset)<=1,'Empty connection icon must be horizontally centered');
 }
 const selectors={back:'.m10-back',primary:'.m10-app-heading button.primary',more:'.m10-app-heading [aria-label="应用更多操作"]',enable:'.m10-content [role=switch][aria-label^="全局启用"]',disclosure:'.m10-package-disclosure',configure:'.m10-unconnected button',connectionToggle:'.m10-connection [role=switch]',connectionMore:'.m10-connection [aria-label^="管理"]',senderConfigure:'.m10-sender-row button'};
 const fingerprintSource="JSON.stringify({heading:document.querySelector('.m10-app-heading').innerText,connections:[...document.querySelectorAll('.m10-connection')].map(e=>e.innerText),switches:[...document.querySelectorAll('.m10-content [role=switch]')].map(e=>[e.getAttribute('aria-label'),e.getAttribute('aria-checked')]),disclosure:document.querySelector('.m10-package-disclosure')?.getAttribute('aria-expanded'),dialog:!!document.querySelector('dialog[open]'),menu:!!document.querySelector('.m10-menu')})";
 await checkCatalogControls({app,result,root,userData,theme,state:applicationId+'-'+state,controlSelectors:selectors,resultKey:'detailControls',allowMissing:true,requiredKeys:['back','primary','disclosure'],neutralSelector:'.m10-app-heading h1',fingerprintSource});
 for(const context of result.detailControls.contexts.slice(-2))for(const control of Object.values(context.controls))if(control.normal.owner.icon)assert(Math.abs(control.normal.owner.icon.centerOffset)<=1,'Empty connection icon centered in each native size');
}
