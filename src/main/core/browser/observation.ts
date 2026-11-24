import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {BrowserArtifacts} from './artifacts';
import {BrowserError} from './errors';
import {awaitBrowserNavigation} from './navigation-wait';
import type {BrowserPage} from './page-registry';
import type {BrowserConditionWait} from './wait';

const selector=z.string().trim().min(1).max(512);
const optionsSchema=z.strictObject({
  container:selector.optional(),
  selector:selector.optional(),
  text:z.string().min(1).max(512).optional(),
  timeout:z.number().int().min(1).max(15000).default(3000),
});

export type BrowserObservationOptions=z.output<typeof optionsSchema>;
export function browserObservationOptions(value:unknown):BrowserObservationOptions|undefined{
  if(value===undefined)return;
  const parsed=optionsSchema.safeParse(value);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT','后置观察需要有效的容器、就绪条件及 1–15000 毫秒时限');
  return parsed.data;
}

export async function observeBrowserPage(input:{
  page:BrowserPage;
  options:BrowserObservationOptions;
  signal:AbortSignal;
  authorize:()=>void;
  condition:BrowserConditionWait;
  artifacts:BrowserArtifacts;
  artifactTaskId:string;
}){
  const {page,options,signal,authorize}=input;
  const deadline=new AbortController();
  const timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT','页面观察超时')),options.timeout);
  const observationSignal=AbortSignal.any([signal,deadline.signal]);
  const unavailable={state:'unavailable' as const,pageId:page.id};
  const assertReadable=()=>{
    observationSignal.throwIfAborted();
    authorize();
    if(page.closed||page.importPaused||!/^https?:\/\//.test(page.contents.getURL()))
      throw new BrowserError('BROWSER_UNAVAILABLE','原网页当前无法观察');
  };
  let generation:string|undefined;
  try{
    assertReadable();
    const expectedOrigin=new URL(page.contents.getURL()).origin;
    const assertSameOrigin=()=>{
      assertReadable();
      if(new URL(page.contents.getURL()).origin!==expectedOrigin)
        throw new BrowserError('BROWSER_TAB_CHANGED','观察期间网页来源已变化');
    };
    await awaitBrowserNavigation(input.condition.run({...options,load:'domcontentloaded'},observationSignal,assertSameOrigin),observationSignal);
    assertSameOrigin();
    generation=page.references.documentGeneration;
    const url=page.contents.getURL();
    const snapshot=await awaitBrowserNavigation(page.references.snapshot(page.helper,observationSignal,options.container),observationSignal);
    const assertCurrent=()=>{
      assertSameOrigin();
      if(generation!==page.references.documentGeneration||url!==page.contents.getURL())
        throw new BrowserError('BROWSER_TAB_CHANGED','观察期间网页已被替换');
    };
    assertCurrent();
    const data=await awaitBrowserNavigation(input.artifacts.result(input.artifactTaskId,'snapshot',snapshot),observationSignal);
    assertCurrent();
    return{state:'ready' as const,pageId:page.id,generation,url,data};
  }catch(error){
    if(signal.aborted)return unavailable;
    const partial={pageId:page.id,...(generation===undefined?{}:{generation})};
    if(error instanceof BrowserError&&error.code==='BROWSER_TAB_CHANGED')
      return{state:'changed' as const,...partial};
    if(deadline.signal.aborted||error instanceof BrowserError&&error.code==='BROWSER_TIMEOUT')
      return{state:'timed-out' as const,...partial};
    return unavailable;
  }finally{clearTimeout(timer);}
}
