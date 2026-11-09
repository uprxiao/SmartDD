// Actual native-page UI through its existing Electron debugger transport. We do
// not attach another debugger or replace the production per-page proxy.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {press} from '../files/keyboard-ax-lib.mjs';
export async function browserPageUI(app,url,userData){
 assert(userData.startsWith('/private/tmp/willyou-m12-')&&typeof app.checkInputFocus==='function');
 // Restored tab metadata precedes lazy native-view creation/navigation. A saved
 // address and loading=false alone do not establish that the page is ready.
 let id;const deadline=Date.now()+15000;
 do{const ids=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App required');return E.webContents.getAllWebContents().filter(w=>w.getURL()===${JSON.stringify(url)}).map(w=>w.id)})()`);assert(ids.length<=1,'Exactly one expected fixture page required');if(ids.length){id=ids[0];break;}await new Promise(r=>setTimeout(r,40));}while(Date.now()<deadline);
 assert(id,'Expected native page did not finish lazy restoration');
 const cdp=async(method,params={})=>{
  assert(/^(?:Runtime\.|DOM\.|Input\.|Page\.|Network\.)/.test(method));
  const input=method.startsWith('Input.')||method==='Page.bringToFront';if(input)await app.checkInputFocus(method);
  return app.mainEvaluate(`(async()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App required');const w=E.webContents.fromId(${id});if(!w||w.isDestroyed())throw Error('Own page closed');if(!w.debugger.isAttached())throw Error('Production page proxy must remain attached');if(${input}){const visible=E.BaseWindow.getAllWindows().some(win=>!win.isDestroyed()&&win.isVisible()&&win.getOpacity()>0&&win.contentView.children.some(view=>view.webContents?.id===w.id));if(!visible)throw Error('UI input requires a visible own native view');}return w.debugger.sendCommand(${JSON.stringify(method)},${JSON.stringify(params)})})()`);
 };
 const evaluate=async(expression)=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Own native page expression failed');return r.result.value;};
 const waitFor=async(expression,timeout=10000)=>{const end=Date.now()+timeout;do{const value=await evaluate(expression);if(value)return value;await new Promise(r=>setTimeout(r,40));}while(Date.now()<end);throw Error('Own native page condition timed out');};
 async function click(selector){const geometry=()=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing page control');e.scrollIntoView({behavior:'instant',block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!r.width||!r.height||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked page control');return{x,y}})()`);const p=await geometry();await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.deepEqual(await geometry(),p);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
 async function field(selector,text){await click(selector);for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});await cdp('Input.insertText',{text});await waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`);}
 return{id,cdp,evaluate,waitFor,click,field,key:(key,options)=>press({cdp,evaluate},key,options),screenshot:async(path)=>{const r=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'));}};
}
