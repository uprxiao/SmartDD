// PK / original T22 time display: synthetic persisted prerequisites,actual UI reads only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const activityTimeFixtures=[
 {n:201,start:'2026-01-01T00:05:59.987Z',end:'2026-01-01T01:05:10.000Z',kind:'normal'},
 {n:202,start:'2024-02-29T23:59:00.000Z',end:'2024-03-01T00:01:00.000Z',kind:'leap'},
 {n:203,start:'2026-02-30T00:00:00Z',end:'not-a-time',kind:'invalid'},
 {n:204,start:'',end:null,kind:'missing'},
 {n:205,start:'2026-01-01T08:05:59.987+08:00',end:'2026-01-01T09:05:10.000+08:00',kind:'same-instant-offset'},
];
export function seedActivityTimeRows({root,sql,quote,uid,hash}){
 assert(root.startsWith('/private/tmp/willyou-m10-activity-ui-'));
 for(const f of activityTimeFixtures)sql(`INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,app_id,package_hash,data_api,action,semantics,scope_hash,targets_json,state,attempt_count,started_at,ended_at) VALUES(${[uid(f.n),'ui','connection-management','mail',hash,1,'ui.mail.read','read','a'.repeat(64),'[]','succeeded',1,f.start,f.end].map(quote).join(',')})`);
 return activityTimeFixtures.map(f=>({...f,id:uid(f.n)}));
}
export async function checkActivityTimes({app,result,root,theme,open,close,check,sql}){
 const e=result.activityTime??={checks:[],receipts:[],fixtureSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),boundary:'Five private synthetic operation dates;actual P08 UI/list/detail;no production timestamp updates or timezone changes'};
 e.environment??=await app.evaluate('({zone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:Intl.DateTimeFormat().resolvedOptions().locale,offset:new Date().getTimezoneOffset()})');
 const format=value=>localMinute(value,e.environment.zone);
 const ids=result.timePrerequisites.map(f=>"'"+f.id+"'").join(',');const raw=()=>sql('SELECT operation_id,started_at,ended_at,state,attempt_count FROM application_data_operations WHERE operation_id IN ('+ids+') ORDER BY operation_id');e.before??=raw();
 for(const f of result.timePrerequisites){
  const expected=f.kind==='invalid'?'时间不可用':f.kind==='missing'?'未记录':format(f.start),end=f.kind==='invalid'?'时间不可用':f.end?format(f.end):'原记录尚无结束回执';await open(f.id);const rowSelector=result.lastAction.selector;const line=await app.evaluate('Array.from(document.querySelectorAll("dialog .m10-activity-detail>p")).find(p=>p.textContent.startsWith("开始："))?.innerText');assert.equal(line,'开始：'+expected+'\n结束：'+end);assert(!/Invalid Date|AM|PM/.test(line));assert(await app.evaluate('document.querySelector("dialog .m10-activity-detail").scrollWidth<=document.querySelector("dialog .m10-activity-detail").clientWidth+1'));if(['normal','invalid','missing'].includes(f.kind))await app.screenshot(join(root,theme+'-time-'+f.kind+'-detail.png'));await close();await app.waitFor('!document.querySelector("dialog")&&document.activeElement?.matches('+JSON.stringify(rowSelector)+')');const row=await app.evaluate('document.querySelector('+JSON.stringify(rowSelector)+').querySelector(".m10-activity-copy>small:last-child").innerText');assert(row.startsWith(expected+' · 1 次尝试'));if(['normal','invalid','missing'].includes(f.kind))await app.screenshot(join(root,theme+'-time-'+f.kind+'-row.png'));e.receipts.push({theme,id:f.id,kind:f.kind,sourceStart:f.start,sourceEnd:f.end,expectedStart:expected,displayedDetail:line,displayedRow:row,returnFocus:true});
 }
 const normal=e.receipts.find(r=>r.theme===theme&&r.kind==='normal'),offset=e.receipts.find(r=>r.theme===theme&&r.kind==='same-instant-offset');assert.equal(normal.expectedStart,offset.expectedStart);assert.deepEqual(raw(),e.before);e.checks.push({theme,records:5,rawTimestampsPreserved:true});check('PK '+theme+' five actual UI date records have padded local minute format,leap/offset equivalence and distinct invalid/missing states;raw timestamps preserved');
}

export function assertMailTimeLines(text){
 const lines=text.split('\n').filter(line=>/^(最近检查|最近完整更新)：/.test(line));
 for(const line of lines)assert.match(line,/^(最近检查|最近完整更新)：(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}|尚未检查|时间不可用)$/);
 return lines;
}

function localMinute(value,zone){const parts=new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)),part=k=>parts.find(p=>p.type===k).value;return`${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;}
export async function checkImpactTimes({app,result,root,click,check,sql}){
 const e=result.impactTime={receipts:[],boundary:'Real remove preview/cancel only;original IPC impact timestamp and raw dateTime;no removal/disconnect/provider/credential operation'};
 const policy=async()=>{const c=await app.invoke('applications.catalog');assert(c.ok);return c.value.map(a=>({appId:a.appId,added:a.added,enabled:a.enabled,revision:a.revision}));};
 const facts=()=>Object.fromEntries(['application_connections','application_project_settings','application_project_bindings','capability_active_packages'].map(n=>[n,sql('SELECT * FROM '+n+' ORDER BY rowid')]));e.before={policy:await policy(),facts:facts()};const settings=await app.invoke('applications.projectSettings',result.prerequisites.projects[0].id,'zentao');assert(settings.ok&&!settings.value.enabled);e.zenTaoProjectNotEnabled=true;
 for(const theme of ['ylight','ydark']){
  await app.invoke('appSettings.update','theme',theme);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+origin+'&&!!document.querySelector("[data-testid=nav-apps]")&&document.documentElement.classList.contains('+JSON.stringify(theme)+')',15000,{navigation:true});await app.evaluate("document.title='A · PK · isolated impact time preview';true");await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar")');await click('.m10-sidebar .installed','禅道');await app.waitFor('document.querySelector(".m10-app-heading h1")?.textContent.includes("禅道")');await click('[aria-label="应用更多操作"]');await app.waitFor('!!document.querySelector(".m10-menu")');await click('.m10-menu button','移除应用');await app.waitFor('!!document.querySelector("dialog .m10-impact time")');const v=await app.evaluate('(()=>{const t=document.querySelector("dialog .m10-impact time");return{source:t.dateTime,text:t.innerText,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,theme:document.documentElement.className}})()');assert.equal(v.text,localMinute(v.source,v.zone));assert(!/AM|PM|Invalid Date/.test(v.text));await app.screenshot(join(root,theme+'-time-impact-preview.png'));await click('dialog footer button','取消');await app.waitFor('!document.querySelector("dialog")');assert.deepEqual(await policy(),e.before.policy);assert.deepEqual(facts(),e.before.facts);e.receipts.push(v);check('PK '+theme+' original impact checkedAt uses shared minute format/raw dateTime and real preview cancel preserves app/project/connection/default policy');
 }
 e.after={policy:await policy(),facts:facts()};assert.deepEqual(e.after,e.before);
}
