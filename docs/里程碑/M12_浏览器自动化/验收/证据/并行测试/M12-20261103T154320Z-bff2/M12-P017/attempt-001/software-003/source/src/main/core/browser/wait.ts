import {setTimeout as delay} from 'node:timers/promises';
import picomatch from 'picomatch';
import type {BrowserPage} from './page-registry';
import {BrowserError} from './errors';

export const BROWSER_WAIT_OBSERVER=`function(selector,text,hidden){
  const element=selector===null?null:document.querySelector(selector);
  let visible=false;
  if(element){const style=getComputedStyle(element),rect=element.getBoundingClientRect();visible=!!(rect.width&&rect.height)&&style.visibility!=='hidden'&&style.display!=='none';}
  const found=text===null?true:(document.body?.innerText??'').includes(text);
  return {selector:selector===null?true:hidden?!visible:visible,text:text===null?true:hidden&&selector===null?!found:found,ready:document.readyState};
}`;

/** For conditions the pinned native CLI drops (--state and combined flags).
 * Only this fixed observer runs in an isolated world; user scripts use wait fn. */
export class BrowserConditionWait {
  private readonly requests=new Set<string>();
  private lastNetwork=Date.now();
  private readonly ready:Promise<unknown>;
  private readonly off:()=>void;
  constructor(private readonly page:BrowserPage){
    this.off=page.proxy.onEvent(event=>{
      const id=event.params.requestId,key=(event.sessionId??'')+'\0'+id;
      if(event.method==='Network.requestWillBeSent'&&typeof id==='string'){this.requests.add(key);this.lastNetwork=Date.now();}
      if((event.method==='Network.loadingFinished'||event.method==='Network.loadingFailed')&&typeof id==='string'){this.requests.delete(key);this.lastNetwork=Date.now();}
    });
    this.ready=page.proxy.send('Network.enable');void this.ready.catch(()=>{});
    page.abort.signal.addEventListener('abort',()=>this.off(),{once:true});
  }
  async run(args:Record<string,unknown>,signal:AbortSignal):Promise<{waited:true}>{
    await this.ready;
    const timeout=Number(args.timeout??25000),until=Date.now()+timeout,selector=args.selector===undefined?null:String(args.selector),text=args.text===undefined?null:String(args.text),hidden=args.state==='hidden';
    const url=args.url===undefined?null:picomatch(String(args.url),{dot:true});
    while(true){
      if(signal.aborted)throw signal.reason;
      try{
        const tree=await this.page.proxy.send<{frameTree:{frame:{id:string}}}>('Page.getFrameTree');
        const world=await this.page.proxy.send<{executionContextId:number}>('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'willyou-browser-observer-v1'});
        const observed=await this.page.proxy.send<{result:{value?:{selector:boolean;text:boolean;ready:string}};exceptionDetails?:unknown}>('Runtime.callFunctionOn',{executionContextId:world.executionContextId,functionDeclaration:BROWSER_WAIT_OBSERVER,arguments:[{value:selector},{value:text},{value:hidden}],returnByValue:true});
        if(observed.exceptionDetails)throw new BrowserError('BROWSER_ERROR','等待条件的选择器无效');
        const value=observed.result.value,load=args.load,loaded=load===undefined||load==='domcontentloaded'&&value?.ready!=='loading'||load==='load'&&value?.ready==='complete'||load==='networkidle'&&value?.ready==='complete'&&this.requests.size===0&&Date.now()-this.lastNetwork>=500;
        if(value?.selector&&value.text&&(!url||url(this.page.contents.getURL()))&&loaded)return{waited:true};
      }catch(error){
        // A navigation can replace the observer world while waiting for its URL.
        if(!(error instanceof Error&&/execution context.*(?:destroyed|not found)|cannot find context|inspected target navigated/i.test(error.message)))throw error;
      }
      const remaining=until-Date.now();if(remaining<=0)throw new BrowserError('BROWSER_TIMEOUT',`Wait timed out after ${timeout}ms`);
      try{await delay(Math.min(50,remaining),undefined,{signal});}catch{if(signal.aborted)throw signal.reason;}
    }
  }
}
