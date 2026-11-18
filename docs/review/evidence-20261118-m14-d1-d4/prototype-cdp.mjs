import { mkdirSync, writeFileSync } from 'node:fs';
import { SCENARIOS } from '../../../prototypes/m6-codex/src/m14-model.mjs';
import assert from 'node:assert/strict';
const output=process.argv[2];
mkdirSync(output,{recursive:true});
const results=[];
const {webSocketDebuggerUrl}=await (await fetch('http://127.0.0.1:9227/json/new?about:blank',{method:'PUT'})).json();
const ws=new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let id=0;
const pending=new Map();
let issues=[];
ws.addEventListener('message',({data})=>{
  const m=JSON.parse(data);
  if(m.id){const [resolve,reject]=pending.get(m.id)||[];pending.delete(m.id);m.error?reject?.(Error(m.error.message)):resolve?.(m.result);}
  if(m.method==='Runtime.exceptionThrown') issues.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error') issues.push(m.params.args.map(a=>a.value ?? a.description).join(' '));
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const i=++id; pending.set(i,[resolve,reject]);ws.send(JSON.stringify({id:i,method,params})); setTimeout(()=>{if(pending.delete(i)) reject(Error(method));},5000).unref();
});
await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true}); await send('Runtime.enable');
const evaluate=async expression=>{
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
};
const wait=async (expr)=>{
  for(let i=0;i<50;i++){if(await evaluate(expr).catch(()=>false))return; await new Promise(r=>setTimeout(r,100));}
  throw Error(expr+'\n'+(await evaluate('document.body.innerText').catch(()=>'' )).slice(0,850)+'\n'+issues.join('\n'));
};
const find=(t,s='button')=>`[...document.querySelectorAll(${JSON.stringify(s)})].find(e=>e.innerText.trim()===${JSON.stringify(t)})`;
const click=async elem=>{
  await wait(`Boolean(${elem})`);
  const point=await evaluate(`(()=>{const e=${elem};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('control is obscured '+e.innerText);return {x,y}})()`);
  for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
};
const contains=t=>`document.body.innerText.includes(${JSON.stringify(t)})`;
try{
for(const [view,theme,width,height] of [['light','light',1440,900],['dark','dark',1440,900],['narrow','light',950,780]]) {
  const nav=async(hash,scene='done')=>{
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:4179/?preview=m14&theme=${theme}&m14=${scene}#${hash}`});
    await wait(`location.hash===${JSON.stringify('#'+hash)} && document.querySelector('main') !== null`);
  };
  const shot=async name=>{
    await evaluate('document.fonts.ready.then(()=>true)');
    const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
    writeFileSync(`${output}/${view}-${name}.png`,Buffer.from(data,'base64'));
  };
  const capture=async name=>{
    await wait("!document.getAnimations().some(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity)");
    await shot(name);
    const viewport=await evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})');
    results.push({view,name,...viewport,text:await evaluate('document.querySelector("main").innerText.slice(-2600)')});
  };
  for(const scene of SCENARIOS.filter(s=>['running','approval','stopping','done','failed'].includes(s.id))){
    await nav('task/build',scene.id);
    await wait(`location.search.includes('m14='+${JSON.stringify(scene.id)}) && Boolean(document.querySelector('.m14-demobar'))`);
    const selected=await evaluate('document.querySelector(".m14-demobar")?.innerText');
    assert(selected?.includes(scene.name), scene.id+' prototype did not select its requested scenario: '+selected);
    if(scene.id==='done'){
      await click("document.querySelector('.m14-working.fold[aria-expanded=false]')");
      await wait("document.querySelector('.m14-turn')?.innerText.includes('我先看一下现有的打包目标和发布测试')");
    }
    await capture(scene.id);
  }
  console.log(view, '5 screenshots');
}
assert.deepEqual(issues,[]);
}finally{
 writeFileSync(`${output}/prototype.json`,JSON.stringify({results,issues},null,2)+'\n');
 ws.close();
}
