import {contextBridge,webFrame} from 'electron';

// Electron replaces prompt in the main world. Chromium's native implementation
// remains available in a separate world without Node or application APIs.
const worldId=1007;
webFrame.setIsolatedWorldInfo(worldId,{name:'WillYou native prompt'});
contextBridge.exposeInMainWorld('__willyouNativePrompt',(message:unknown,initial:unknown):string|null=>{
  if(typeof message!=='string'||typeof initial!=='string')throw new TypeError('Prompt arguments must be strings');
  let completed=false,value:unknown=null,failure:Error|undefined;
  const evaluation=webFrame.executeJavaScriptInIsolatedWorld(worldId,[{code:
    '(()=>{if(typeof process!=="undefined"||typeof require!=="undefined")throw Error("Unexpected Node in prompt world");return window.prompt('+JSON.stringify(message)+','+JSON.stringify(initial)+');})()',
  }],false,(result,error)=>{completed=true;value=result;failure=error;});
  // The callback is synchronous for a live frame; the returned promise is not.
  // Consume its rejection without turning a synchronous prompt into a promise.
  void evaluation.catch(()=>{});
  if(failure)throw failure;
  if(!completed)throw new Error('Native prompt did not settle synchronously');
  if(value!==null&&typeof value!=='string')throw new TypeError('Invalid native prompt result');
  return value;
});
contextBridge.executeInMainWorld({func:()=>{
  const bridge=(window as typeof window&{__willyouNativePrompt:(message:string,initial:string)=>string|null}).__willyouNativePrompt;
  window.prompt=function(message='',initial=''){return bridge(String(message),String(initial));};
}});
