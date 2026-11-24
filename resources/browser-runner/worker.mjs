import {registerHooks} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const send=process.send?.bind(process);
if(!send)throw new Error('WillYou runner requires a private host channel');
const root=process.argv[2];
const read=async file=>JSON.parse(await readFile(join(root,file),'utf8'));
const url=file=>pathToFileURL(join(root,file)).href;
const endpoint='http://willyou-runner.invalid';
const socketUrl='ws://willyou-runner.invalid/owned-page';
const sockets=new Set();

class HostSocket extends EventTarget {
  static OPEN=1;
  static CLOSED=3;
  readyState=HostSocket.OPEN;
  constructor(address){
    super();
    if(address!==socketUrl)throw new Error('Only the current WillYou page may be connected');
    sockets.add(this);
    queueMicrotask(()=>this.dispatchEvent(new Event('open')));
  }
  send(data){
    if(this.readyState!==HostSocket.OPEN)throw new Error('WillYou page connection closed');
    send({kind:'cdp',call:JSON.parse(data)});
  }
  receive(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  close(){
    if(this.readyState===HostSocket.CLOSED)return;
    this.readyState=HostSocket.CLOSED;
    sockets.delete(this);
    this.dispatchEvent(new Event('close'));
  }
}

const controller=new AbortController();
const stop=()=>{controller.abort();for(const socket of sockets)socket.close();};
process.once('disconnect',stop);
process.on('message',message=>{
  if(message?.kind==='revoke')stop();
  if(message?.kind==='cdp')for(const socket of sockets)socket.receive(message.value);
});

// Preserve the sealed driver and its geometry, actionability and timing logic.
// Supply only its connection dependency inside this dedicated worker.
const adapter='willyou:owned-page';
registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL===url('runtime/cdp.mjs')&&specifier==='./browser.mjs')
      return{url:adapter,shortCircuit:true};
    return next(specifier,context);
  },
  load(address,context,next){
    if(address===adapter)return{format:'module',shortCircuit:true,source:
      `export const validateSession=()=>({endpoint:${JSON.stringify(endpoint)},targetId:'owned-page'});`};
    return next(address,context);
  },
});
globalThis.WebSocket=HostSocket;
globalThis.fetch=async address=>{
  if(address!==endpoint+'/json/list')throw new Error('Direct HTTP is unavailable in the WillYou runner');
  return Response.json([{id:'owned-page',type:'page',webSocketDebuggerUrl:socketUrl}]);
};

function at(value,pointer){
  if(typeof pointer!=='string'||!pointer.startsWith('/'))throw new Error('Invalid assertion reference');
  for(const key of pointer.slice(1).split('/')){
    const name=key.replaceAll('~1','/').replaceAll('~0','~');
    if(!value||!Object.hasOwn(value,name))throw new Error('Unknown assertion reference');
    value=value[name];
  }
  return value;
}

const init=await new Promise(resolve=>process.once('message',resolve));
try{
  if(init?.kind!=='start'||!Array.isArray(init.selected))throw new Error('Invalid runner start');
  const {connectSession}=await import(url('runtime/cdp.mjs'));
  const {criterionResults}=await import(url('runtime/acceptance-contract.mjs'));
  const {businessAcceptance}=await import(url('runtime/business-contract.mjs'));
  const {controlAcceptance}=await import(url('runtime/ui-contract.mjs'));
  const {redact}=await import(url('runtime/common.mjs'));
  const {cases}=await read('cases.json');
  const suite=await import(url(init.suite));
  const driver=await connectSession();
  const context={...driver,signal:controller.signal,pages:suite.pages,runnableCaseIds:Object.freeze(init.selected.map(row=>row.id))};
  // Hosted evidence is created and attributed by the main process.
  context.screenshot=label=>driver.cdp('WillYou.screenshot',{label:String(label??'page').slice(0,128)}).then(row=>row.path);
  context.captureJson=(label,value)=>driver.cdp('WillYou.evidence',{label:String(label).slice(0,128),value}).then(row=>row.path);
  context.waitForLogin=()=>driver.cdp('WillYou.waitForLogin');
  context.captureDownload=async(action,options={})=>{
    await driver.cdp('WillYou.downloadArm',{expectedFilename:options.expectedFilename});
    try{
      await action();
      return await driver.cdp('WillYou.downloadResult',{},options.timeoutMs);
    }catch(error){await driver.cdp('WillYou.downloadCancel').catch(()=>{});throw error;}
  };
  const continuation=init.continuation;
  if(!continuation)await suite.setup?.(context);
  for(const mapping of init.selected){
    controller.signal.throwIfAborted();
    const test=cases.find(row=>row.id===mapping.id);
    if(!test||!Object.hasOwn(suite.handlers,mapping.handler))throw new Error('Unknown frozen test entry');
    const assertions=[],operations=[],startedAt=Date.now();
    const assertion=(id,actual,compare)=>{
      const spec=test.assertions?.find(row=>row.id===id);
      if(!spec||assertions.some(row=>row.id===id))throw new Error('Assertion is undeclared or duplicated');
      const expected=at(test.expected,spec.expectedRef);
      const status=compare(actual,expected)?'passed':'failed';
      const summarize=value=>JSON.stringify(redact(value))?.slice(0,400)??'undefined';
      assertions.push({id,status,passed:status==='passed',
        ...(status==='failed'?{expected:summarize(expected),actual:summarize(actual)}:{})});
      if(status==='failed')throw new Error('Frozen assertion failed: '+id);
    };
    context.caseId=test.id;
    context.equal=(id,actual)=>assertion(id,actual,isDeepStrictEqual);
    context.contains=(id,actual)=>assertion(id,actual,(a,b)=>typeof a==='string'?a.includes(String(b)):Array.isArray(a)&&a.some(value=>isDeepStrictEqual(value,b)));
    context.recordComponent=event=>{
      if(event?.status==='completed'&&typeof event.operation==='string')operations.push({operation:event.operation,status:'completed'});
    };
    context.recordCheckpoint=entry=>{
      const stepId=typeof entry==='string'?entry:entry?.willyouNextStep;
      return typeof stepId==='string'?driver.cdp('WillYou.checkpoint',{stepId}):undefined;
    };
    send({kind:'case-start',id:test.id});
    let result;
    try{
      const resuming=continuation?.caseId===test.id;
      if(!resuming){
        const page=suite.pages?.[test.page?.key];
        if(!page)throw new Error('Missing frozen page adapter');
        await page.open?.(context);
        if(typeof page.ready==='function'){
          if(!await page.ready(context))throw new Error('Frozen page is not ready');
        }else if(page.ready)await context.waitFor(page.ready);
        await page.reset?.(context);
        if(page.verify&&!await page.verify(context))throw new Error('Frozen page identity could not be verified');
      }
      const handler=resuming?suite.resumeHandlers?.[continuation.handler]:suite.handlers[mapping.handler];
      if(typeof handler!=='function')throw new Error('Frozen continuation entry is not callable');
      const outcome=await handler(context,test);
      const criteria=criterionResults(test,assertions);
      const status=outcome?.status==='passed'&&assertions.length===(test.assertions?.length??0)
        &&assertions.length>0&&criteria.every(row=>row.status==='passed')
        &&mapping.operations.every(expected=>operations.some(row=>row.operation===expected))?'passed':'failed';
      result={id:test.id,status,assertions,criteria,componentOperations:operations};
      const originalAcceptance=test.originalExpectations?controlAcceptance(test,result):undefined;
      const business=test.business?businessAcceptance(test,{...result,originalAcceptance}):undefined;
      if(originalAcceptance?.originalAccepted===false||business?.accepted===false)result.status='failed';
    }catch(error){
      result={id:test.id,status:'failed',assertions,reason:error instanceof Error?error.message.slice(0,512):'Case execution failed'};
    }
    const checked=new Set(assertions.map(row=>row.id));
    result.unexecutedAssertions=(test.assertions??[]).filter(row=>!checked.has(row.id)).map(row=>row.id);
    await context.screenshot(result.status).catch(()=>{});
    send({kind:'case-result',result:{...result,durationMs:Date.now()-startedAt}});
  }
  await suite.teardown?.(context);
  driver.disconnect();
  send({kind:'finished'});
}catch{
  send({kind:'failed'});
}finally{process.disconnect();}
