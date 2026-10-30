// SQ: original packaged resource handler; own negative/held reply, real UI continuation.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function checkResourceContinuation({app,result,root,userData,click,theme,resource}) {
 const record=result.resourceContinuation??={contexts:[],checks:[],boundary:'I original resource reply followed by an own failure/hold; A actual Continue and inert text; no provider/system/Agent claim'};
 const context={theme,resourceId:resource.id,frames:[]};record.contexts.push(context);
 await app.mainEvaluate(`(()=>{
  const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
  if(E.app.getPath('userData')!==${JSON.stringify(userData)}||globalThis.__sqResource)throw Error('Fresh own SQ resource guard required');
  const map=E.ipcMain._invokeHandlers,original=map.get('applications.resource');
  const g={records:[],mode:'fail',pending:[],resourceId:${JSON.stringify(resource.id)}};
  map.set('applications.resource',async function(event,...args){
   const reply=await original.call(this,event,...args);
   if(args[1]?.resource?.id!==g.resourceId||!args[1]?.offset)return reply;
   const row={offset:args[1].offset,mode:g.mode,originalOk:reply.ok,at:Date.now()};g.records.push(row);
   if(!reply.ok)return reply;
   if(g.mode==='fail'){g.mode='pass';row.injected=true;return{ok:false,code:'RESOURCE_STATE_CHANGED',message:'SQ isolated next-chunk reply unavailable'};}
   if(g.mode==='hold'){await new Promise(resolve=>g.pending.push(resolve));row.releasedAt=Date.now();}
   return reply;
  });
  g.restore=()=>{for(const resolve of g.pending)resolve();g.pending=[];map.set('applications.resource',original);};
  globalThis.__sqResource=g;return true;
 })()`);
 const observe=()=>app.mainEvaluate('({records:globalThis.__sqResource.records,pending:globalThis.__sqResource.pending.length})');
 const frame=async name=>{const file=theme+'-sq-'+name+'.png';await app.screenshot(join(root,file));context.frames.push(file);};
 try {
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const w=E.BrowserWindow.getAllWindows()[0];w.setContentSize(${theme==='dark'?'700,500':'1400,900'},false);return true})()`);
  await app.waitFor(`innerWidth===${theme==='dark'?700:1400}&&document.fonts.status==='loaded'`);
  await app.evaluate("document.title='A · SQ · 隔离资源续读恢复';true");
  await app.waitFor('document.querySelector(".m10-html-preview")?.textContent.includes("内容尚未全部显示")');
  const partial=await app.evaluate('document.querySelector(".m10-html-preview pre").textContent');
  assert(partial.includes('OQ 分块起点')&&!partial.includes('OQ 分块终点'));
  await click('.m10-html-preview button','继续读取内容');
  await app.waitFor('document.querySelector(".m10-html-preview")?.textContent.includes("SQ isolated next-chunk reply unavailable")');
  assert.equal(await app.evaluate('document.querySelector(".m10-html-preview pre").textContent'),partial);
  await frame('failed');record.checks.push(theme+' next chunk explicit failure preserves only this opening partial text');
  await app.mainEvaluate('globalThis.__sqResource.mode="hold";true');
  await click('.m10-html-preview button','继续读取内容');
  const deadline=Date.now()+5000;
  while((await observe()).pending!==1){assert(Date.now()<deadline,'Original next-chunk reply did not reach own hold');await new Promise(resolve=>setTimeout(resolve,30));}
  await app.waitFor('[...document.querySelectorAll(".m10-html-preview button")].some(e=>e.textContent.trim()==="继续读取内容"&&e.disabled)');
  const busy=await app.evaluate(`(()=>{const p=document.querySelector('.m10-html-preview');return{text:p.querySelector('pre')?.textContent,error:p.textContent.includes('SQ isolated next-chunk reply unavailable'),retry:[...p.querySelectorAll('button')].some(e=>e.textContent.trim()==='重试'),active:p.querySelectorAll('script,style,img,svg,iframe,object,embed,form,a,link').length}})()`);
  context.busy=busy;await frame('continuing');
  assert.equal(busy.error,false,'In-flight continuation must hide the stale error');
  assert.equal(busy.retry,false,'In-flight continuation must not offer a conflicting refetch');
  assert.equal(busy.text,partial);assert.equal(busy.active,0);
  record.checks.push(theme+' original continuation pending hides stale failure/refetch;keeps partial text and disables Continue');
  await app.mainEvaluate('(()=>{const g=globalThis.__sqResource;g.mode="pass";for(const resolve of g.pending)resolve();g.pending=[];return true})()');
  await app.waitFor('document.querySelector(".m10-html-preview pre")?.textContent.includes("OQ 分块终点")');
  assert.equal(await app.evaluate('document.querySelector(".m10-html-preview pre").textContent'),'OQ 分块起点 '+('中文🙂'.repeat(8500))+' OQ 分块终点');
  assert(!await app.evaluate('[...document.querySelectorAll(".m10-html-preview button")].some(e=>["继续读取内容","重试"].includes(e.textContent.trim()))'));
  context.observation=await observe();assert.deepEqual(context.observation.records.map(row=>row.offset),[65536,65536]);
  assert(context.observation.records.every(row=>row.originalOk===true));
  await frame('complete');record.checks.push(theme+' exact original UTF-8 completion without replacement or a new first-page request');
 } finally {
  context.finalObservation=await observe();
  await app.mainEvaluate('globalThis.__sqResource.restore();delete globalThis.__sqResource;true');
  context.restored=true;
 }
}
