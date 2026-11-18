import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const output=process.argv[2];
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
  await nav('project/archive-review');
  await click(find('删除项目'));
  await wait(contains('想保留记录'));
  assert(await evaluate(`Boolean(document.querySelector('input[name="deleteSecrets"]')) && ${contains('1 个 Agent 任务')}`));
  await shot('G1-删除确认');
  await nav('project/ais');
  await click(find('删除项目'));
  await wait(contains('项目暂时无法删除'));
  assert.equal(await evaluate(`[...document.querySelectorAll('.m14-project-delete button')].some(e=>e.innerText==='删除项目')`),false);
  await shot('G1-拒绝删除');
  await nav('task/build','team');
  await click("document.querySelector('.m14-lineage-btn')");
  await wait(contains('共用目录 · 写入队列'));
  await shot('G3-共用目录');
  await nav('task/build','team-worktree');
  await click("document.querySelector('.m14-lineage-btn')");
  await wait(contains('工作副本 · Git'));
  await shot('G3-独立工作副本');
  await nav('settings/archived-tasks');
  await wait(contains('整理启动检查结果'));
  assert(await evaluate(`!!document.querySelector('.m14-archive-settings') && ${contains('已归档项目')}`));
  await shot('G5-归档列表');
  await click("document.querySelector('.m14-archive-open')");
  await wait("document.querySelector('.m14-archive-readonly') !== null");
  assert(await evaluate(`document.querySelector('.m14-archive-composer textarea').disabled`));
  await shot('G5-只读任务');
  await click("document.querySelector('.m14-archive-readonly button')");
  await wait("document.querySelector('.m14-archive-readonly') === null && !!document.querySelector('.m14-demobar')");
  await nav('task/build','diff-history');
  const historyCard=(round,text)=>`[...document.querySelectorAll('.m14-turn')].find(e=>e.innerText.includes('更新第 '+${round}+' 轮的检查记录')).querySelector(${JSON.stringify(text)})`;
  await click(historyCard(1,'.m14-changes-actions button'));
  await wait(`document.querySelector('select[aria-label="差异轮次"]')?.value==='history-1' && ${contains('notes/round-1.md')}`);
  assert.equal(await evaluate(`document.querySelector('select[aria-label="差异轮次"]').options.length`),54);
  await shot('G2-较早轮次');
  await click(historyCard(2,'button.text-button'));
  await wait(`document.querySelector('select[aria-label="差异轮次"]')?.value==='history-2' && document.querySelector('.m14-diff-empty-state')?.innerText.includes('快照已清理（空间回收）')`);
  await click(historyCard(3,'button.text-button'));
  await wait(`document.querySelector('select[aria-label="差异轮次"]')?.value==='history-3' && document.querySelector('.m14-diff-empty-state')?.innerText.includes('影子库空间已满')`);
  console.log(view, '7 screenshots, archive restoration and exact diff selection passed');
}
assert.deepEqual(issues,[]);
}finally{ws.close();}
