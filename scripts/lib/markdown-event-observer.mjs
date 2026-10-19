// Passive own-document listener observation. Native calls and callback identities
// are forwarded unchanged; this observer never creates UI events.
function install() {
 const proto=EventTarget.prototype,add=proto.addEventListener,remove=proto.removeEventListener;
 const capture=options=>typeof options==='boolean'?options:Boolean(options?.capture);
 const s={proto,add,remove,rows:[],functions:[]};globalThis.__mdEvents=s;
 proto.addEventListener=function(type,listener,options){
  if(this===document&&type==='mouseup'){
   s.rows.push({ordinal:s.rows.length,at:Date.now(),removed:0,capture:capture(options),signature:typeof listener==='function'?Function.prototype.toString.call(listener).slice(0,320):String(listener),stack:new Error().stack.split('\n').slice(1,4)});s.functions.push(listener);
  }
  return add.call(this,type,listener,options);
 };
 proto.removeEventListener=function(type,listener,options){
  if(this===document&&type==='mouseup')for(let i=0;i<s.functions.length;i++)if(s.functions[i]===listener&&s.rows[i].capture===capture(options))s.rows[i].removed++;
  return remove.call(this,type,listener,options);
 };
 return true;
}
export const installMarkdownEventObserver=app=>app.evaluate('('+install.toString()+')()');
export const observeMarkdownEvents=app=>app.evaluate('globalThis.__mdEvents.rows');
export const restoreMarkdownEventObserver=app=>app.evaluate('(()=>{const s=globalThis.__mdEvents;s.proto.addEventListener=s.add;s.proto.removeEventListener=s.remove;const result={add:s.proto.addEventListener===s.add,remove:s.proto.removeEventListener===s.remove};delete globalThis.__mdEvents;return result})()');
export async function focusWithTab(app,selector){for(let i=0;i<70;i++){if(await app.evaluate(`Boolean(document.activeElement?.matches(${JSON.stringify(selector)}))`))return i;for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});}throw Error('Actual keyboard Tab did not reach requested control');}
export async function pressEnter(app){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});}
// Native once/signal removal does not call JS removeEventListener. Audit the
// browser registry and original function identity instead of inferring a leak.
export async function inspectNativeMarkdownMouseups(app) {
 const group='md-events-audit-'+Date.now(),rows=[];
 try {
  const ref=await app.cdp('Runtime.evaluate',{expression:'document',returnByValue:false,objectGroup:group});
  const result=await app.cdp('DOMDebugger.getEventListeners',{objectId:ref.result.objectId});
  for(const listener of result.listeners.filter(x=>x.type==='mouseup')){
   const handler=listener.originalHandler??listener.handler;
   const match=handler?.objectId?await app.cdp('Runtime.callFunctionOn',{objectId:handler.objectId,functionDeclaration:'function(){return globalThis.__mdEvents.functions.indexOf(this)}',returnByValue:true}):null;
   rows.push({ordinal:match?.result?.value??-1,type:listener.type,useCapture:listener.useCapture,once:listener.once,passive:listener.passive,scriptId:listener.scriptId,line:listener.lineNumber,column:listener.columnNumber});
  }
  return rows;
 } finally {await app.cdp('Runtime.releaseObjectGroup',{objectGroup:group});}
}
