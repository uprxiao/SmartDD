// PL / T22: synthetic persisted history prerequisites; all browsing uses real UI input.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function checkActivityPagination({app,result,root,click,choose,key,check,sql,quote,uid,hash,projects}){
 assert.match(root,/^\/private\/tmp\/willyou-m10-activity-ui-[A-Za-z0-9]+$/);
 const e=result.pagination={layer:'A browsing, I synthetic SQL history prerequisites; no actual provider/Agent operation',records:123,receipts:[],at:'2026-10-28T00:00:00.000Z'};
 for(let n=1;n<=123;n++){
  const mail=n%2===1,project=projects[n%3===0?1:0].id;
  sql(`INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,app_id,package_hash,data_api,action,semantics,scope_hash,targets_json,state,attempt_count,started_at,ended_at) VALUES(${[uid(1000+n),'ui','project',project,mail?'mail':'zentao',hash,1,'PL_PAGE_'+String(n).padStart(4,'0'),'read','b'.repeat(64),JSON.stringify([{id:uid(mail?13:11)}]),'succeeded',1,e.at,e.at].map(quote).join(',')})`);
 }
 const facts=()=>sql("SELECT * FROM application_data_operations WHERE action LIKE 'PL_PAGE_%' ORDER BY operation_id");e.before=facts();assert.equal(e.before.length,123);
 const expected=filter=>e.before.filter(filter).sort((a,b)=>b.operation_id.localeCompare(a.operation_id)).map(x=>x.action);
 const current=()=>app.evaluate("[...document.querySelectorAll('.m10-activity-row')].map(e=>e.innerText.match(/PL_PAGE_\\d{4}/)?.[0]).filter(Boolean)");
 const ready=()=>app.waitFor("!!document.querySelector('.m10-activity-list')&&!document.querySelector('.m10-page-head button').disabled",12000);
 async function walk(name,filter){
  await ready();let pages=0;
  while(await app.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='读取更早记录')")){
   assert(pages++<10,'bounded page count');const count=await app.evaluate("document.querySelectorAll('.m10-activity-row').length");
   await click('.m10-button','读取更早记录');
   await app.waitFor(`document.querySelectorAll('.m10-activity-row').length>${count}&&![...document.querySelectorAll('button')].some(b=>b.textContent==='读取更早记录'&&b.disabled)`,12000);
  }
  const markers=await current(),want=expected(filter);assert.equal(new Set(markers).size,markers.length);assert.deepEqual(markers,want,name);
  const receipt={name,olderClicks:pages,markers,totalRows:await app.evaluate("document.querySelectorAll('.m10-activity-row').length")};e.receipts.push(receipt);return receipt;
 }
 for(const theme of ['ylight','ydark']){
  await app.invoke('appSettings.update','theme',theme);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')&&document.documentElement.classList.contains('${theme}')`,15000,{navigation:true});
  await app.evaluate("document.title='A · PL · isolated 123-record pagination';true");
  await click('[data-testid=nav-apps]');await app.waitFor('document.querySelectorAll(".m10-nav.installed").length===2&&!!document.querySelector(".m10-catalog-item")');await click('.m10-sidebar > button','调用记录');await ready();
  assert.equal(await app.evaluate("document.querySelectorAll('.m10-activity-row').length"),50);
  const all=await walk(theme+' global',()=>true);assert(all.olderClicks>=2);await app.screenshot(join(root,theme+'-pagination-tail.png'));
  const row=await app.evaluate("(()=>{const es=[...document.querySelectorAll('.m10-activity-row')],i=es.findIndex(e=>e.innerText.includes('PL_PAGE_0001'));return{index:i,selector:'.m10-activity-row:nth-child('+(i+1)+')'}})()");assert(row.index>=100);
  await click(row.selector);await app.waitFor("document.querySelector('dialog .m10-activity-detail h2')?.textContent==='PL_PAGE_0001'");await click('dialog summary','追溯标识');
  const text=await app.evaluate('document.querySelector("dialog .m10-activity-detail").innerText');assert(text.includes(uid(1001))&&text.includes(projects[0].name)&&text.includes('T36 本地来源 A'));await app.screenshot(join(root,theme+'-pagination-old-detail.png'));
  await key('Escape','Escape',27);await app.waitFor(`!document.querySelector('dialog')&&document.activeElement?.matches(${JSON.stringify(row.selector)})`);assert.deepEqual(await current(),all.markers);
  check('PL '+theme+' real multi-page history has 123 unique ordered same-time records and old-page detail/Escape returns to exact row without losing pages');
  await choose('按应用筛选记录','mail');const mail=await walk(theme+' mail',r=>r.app_id==='mail');assert(mail.olderClicks>=1);
  await choose('按连接筛选记录',uid(13));await ready();await walk(theme+' mail connection',r=>r.app_id==='mail');
  await choose('按项目筛选记录',projects[1].id);await ready();await walk(theme+' mail connection project',r=>r.app_id==='mail'&&r.project_id===projects[1].id);
  await choose('按应用筛选记录','zentao');await ready();assert.equal(await app.evaluate("document.querySelector('[aria-label=\"按连接筛选记录\"]').value"),'');await walk(theme+' zentao project',r=>r.app_id==='zentao'&&r.project_id===projects[1].id);
  await choose('按应用筛选记录','');await choose('按项目筛选记录','');await ready();await walk(theme+' reset global',()=>true);
  await click('.m10-page-head button','刷新记录');await ready();await walk(theme+' refreshed global',()=>true);assert.deepEqual(facts(),e.before);
  check('PL '+theme+' multi-page app/connection/project filters,reset and real refresh preserve exact intersection/order and never rewrite original history');
  const original=e.before.find(r=>r.operation_id===uid(1001));
  const injection={theme,id:original.operation_id,field:'targets_json',original:original.targets_json,injected:'{PL-corrupt-source',restored:false};(e.faults??=[]).push(injection);
  try{
   sql(`UPDATE application_data_operations SET targets_json=${quote(injection.injected)} WHERE operation_id=${quote(original.operation_id)}`);
   await click('.m10-page-head button','刷新记录');
   await app.waitFor("document.body.innerText.includes('调用记录读取未完成')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='重试读取'&&!b.disabled)",12000);
   injection.displayed=await app.evaluate('document.querySelector(".m10-main").innerText');
   assert(injection.displayed.includes('缺失或损坏')&&!injection.displayed.includes('当前筛选没有调用记录'));
   assert.equal(await app.evaluate("document.querySelectorAll('.m10-activity-row').length"),0);
   await app.screenshot(join(root,theme+'-pagination-source-error.png'));
  }finally{
   sql(`UPDATE application_data_operations SET targets_json=${quote(original.targets_json)} WHERE operation_id=${quote(original.operation_id)}`);injection.restored=true;assert.deepEqual(facts(),e.before);
  }
  await click('.m10-button','重试读取');await ready();const recovered=await walk(theme+' original-source repaired retry',()=>true);assert.deepEqual(recovered.markers,all.markers);await app.screenshot(join(root,theme+'-pagination-recovered.png'));
  check('PL '+theme+' original last-page corrupt-source rejection shows explicit list failure;exact source restoration and real retry recover all history without replay');
 }
 e.after=facts();assert.deepEqual(e.after,e.before);
}
