import assert from'node:assert/strict';
import{join}from'node:path';
import{measureActivityControl}from'./activity-controls-ui.mjs';

export async function checkManagementMenus({app,result,root,userData,layer,fixtures,openApp,click,nativeSize,database}){
 const d=result.managementMenus={menus:[],confirmations:[],violations:[],boundary:'Existing PB public fixture only; UI opens/cancels original confirmations, no disconnect/remove/auth/save/secret action.'};
 const snapshot=()=>layer==='A'?database():app.evaluate("localStorage.getItem('willyou-m10-prototype-v2')");
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('SW own App');const m=E.ipcMain._invokeHandlers,g={blocked:[],originals:[]};for(const k of ['applications.disconnect','applications.setAdded']){const f=m.get(k);if(!f)throw Error('SW missing guard '+k);g.originals.push([k,f]);m.set(k,()=>{g.blocked.push(k);throw Error('SW never confirm business mutation')})}g.restore=()=>{for(const[k,f]of g.originals)m.set(k,f);return{blocked:g.blocked,restored:g.originals.every(([k,f])=>m.get(k)===f)}};globalThis.__swMenus=g;return true})()`);
 const press=async key=>{for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:({Tab:9,Escape:27,ArrowDown:40,ArrowUp:38,Home:36,End:35})[key],nativeVirtualKeyCode:({Tab:48,Escape:53,ArrowDown:125,ArrowUp:126,Home:115,End:119})[key]})};
 const active=()=>app.evaluate("({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.textContent.trim().slice(0,150)})");
 async function move(selector){const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(!(h===e||e.contains(h)))throw Error('SW target covered');return{x,y}})()`);await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await app.waitFor('document.querySelector('+JSON.stringify(selector)+").matches(':hover')");}
 async function menu(context,trigger,kind){
  const before=await snapshot(),r={context,kind,trigger,keys:[],items:[]};d.menus.push(r);
  await click(trigger);await app.waitFor('!!document.querySelector("[role=menu]")');const items=await app.evaluate('[...document.querySelectorAll("[role=menu] button")].map(e=>e.textContent.trim())');r.labels=items;
  assert.equal(await app.evaluate('document.activeElement===document.querySelector("[role=menu] button")'),true);
  for(const key of['End','Home','ArrowUp','ArrowDown']){await press(key);const index=key==='Home'||key==='ArrowDown'?0:items.length-1;assert.equal(await app.evaluate('[...document.querySelectorAll("[role=menu] button")].indexOf(document.activeElement)'),index);r.keys.push({key,index,active:await active()});}
  for(let i=0;i<items.length;i++){await press('Home');for(let n=0;n<i;n++)await press('ArrowDown');const selector='[role=menu] button:nth-child('+(i+1)+')',e={text:items[i],focus:await measureActivityControl(app,'document.querySelector('+JSON.stringify(selector)+')')};assert(e.focus.focusVisible&&e.focus.visible&&e.focus.outlineVisible);await move(selector);e.hover=await measureActivityControl(app,'document.querySelector('+JSON.stringify(selector)+')');r.items.push(e);}
  await app.screenshot(join(root,'sw-'+context+'-'+kind+'-menu.png'));await press('Escape');await app.waitFor('!document.querySelector("[role=menu]")');await app.waitFor('document.activeElement===document.querySelector('+JSON.stringify(trigger)+')',2000);assert(await app.evaluate('document.activeElement===document.querySelector('+JSON.stringify(trigger)+')'),'SW Escape returns exact trigger');r.escapeRestored=true;
  await click(trigger);await app.waitFor('!!document.querySelector("[role=menu]")');await press('Tab');await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');r.tab={closed:!await app.evaluate('!!document.querySelector("[role=menu]")'),active:await active()};
  if(!r.tab.closed){d.violations.push({context,kind,type:'Tab menu did not close'});await app.screenshot(join(root,'sw-'+context+'-'+kind+'-tab-open.png'));await press('Escape');await app.waitFor('!document.querySelector("[role=menu]")');}
  assert.deepEqual(await snapshot(),before);r.statePreserved=true;
 }
 async function confirmation(context,trigger,kind){
  const before=await snapshot(),r={context,kind,trigger,controls:[],returns:[]};d.confirmations.push(r);
  for(const method of['Escape','cancel','X']){
   await click(trigger);await app.waitFor('!!document.querySelector("[role=menu]")');await click('[role=menuitem]',kind==='remove'?'移除应用':'断开连接');await app.waitFor('!!document.querySelector("dialog[open]")&&!document.querySelector("dialog footer button.primary").disabled');
   if(method==='Escape')for(const[name,sel]of[['header','dialog header button'],['cancel','dialog footer button:first-child'],['confirm','dialog footer button:last-child']]){
    await click('dialog h2');await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});let found=false;for(let n=0;n<100;n++){await press('Tab');if(await app.evaluate('document.activeElement===document.querySelector('+JSON.stringify(sel)+')')){found=true;break;}}assert(found,'SW confirmation control Tab reachable');const e={name,focus:await measureActivityControl(app,'document.querySelector('+JSON.stringify(sel)+')')};assert(e.focus.focusVisible&&e.focus.visible&&e.focus.outlineVisible,'SW confirmation focus unclipped '+name);await move(sel);e.hover=await measureActivityControl(app,'document.querySelector('+JSON.stringify(sel)+')');r.controls.push(e);await app.screenshot(join(root,'sw-'+context+'-'+kind+'-'+name+'.png'));
   }
   if(method==='Escape')await press('Escape');else await click(method==='cancel'?'dialog footer button:first-child':'dialog header button');await app.waitFor('!document.querySelector("dialog[open]")');const restored=await app.evaluate('document.activeElement===document.querySelector('+JSON.stringify(trigger)+')');r.returns.push({method,restored,active:await active()});if(!restored)d.violations.push({context,kind,type:'Confirmation return focus lost',method});assert.deepEqual(await snapshot(),before);
  }
  r.statePreserved=true;
 }
 try{
  for(const theme of['light','dark']){
   if(layer==='A'){await app.invoke('appSettings.update','theme','y'+theme);const t=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+t+'&&!!document.querySelector("[data-testid=nav-apps]")',15000,{navigation:true});}
   else if(await app.evaluate('document.documentElement.dataset.theme')!==theme)await click('[aria-label="切换'+(theme==='dark'?'深':'浅')+'色主题"]');
   if(d.menus.length===0){await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('SW own initial focus');const w=E.BrowserWindow.getAllWindows()[0];w.show();E.app.focus({steal:false});w.focus();w.webContents.focus();return true})()`);await app.waitFor('document.hasFocus()');}
   for(const size of['wide','minimum']){
    await nativeSize(size);for(const id of['zentao','mail']){
     await openApp(id);await app.evaluate('document.title='+JSON.stringify(layer+' · SW · 仅连接管理菜单与取消确认')+';true');const context=theme+'-'+size+'-'+id;
     await menu(context,'[aria-label="应用更多操作"]','app');await confirmation(context,'[aria-label="应用更多操作"]','remove');
     if(id==='mail')await menu(context,'.m10-app-heading button.primary','add');
     for(const f of fixtures.filter(f=>f.app===id)){const trigger='[aria-label='+JSON.stringify('管理'+f.name)+']';await menu(context,trigger,f.id);await confirmation(context,trigger,'disconnect-'+f.id);}
    }
   }
  }
  assert.deepEqual(d.violations,[],'SW management keyboard/return-focus violations');
 }finally{d.guard=await app.mainEvaluate('globalThis.__swMenus.restore()');assert(d.guard.restored);assert.deepEqual(d.guard.blocked,[]);}
}
