// Pure driver helper until explicitly called with this run's packaged App.
// Derived from sealed C5 T33: UI -> original prepare/review/authorize/execute.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function observePageSend(app,userData){
 await app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json'),E=req('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own T25 App only');if(globalThis.__t25PageAudit)throw Error('T25 observer already installed');const map=E.ipcMain._invokeHandlers,g={records:[],originals:[]};for(const name of ['prepareSend','reviewSend','authorizeSend','executeSend']){const key='applications.'+name,original=map.get(key);if(typeof original!=='function')throw Error('Missing original '+key);g.originals.push({key,original});map.set(key,async(event,...args)=>{const row={name,args,at:new Date().toISOString()};g.records.push(row);try{row.reply=await original(event,...args);row.returnedAt=new Date().toISOString();return row.reply}catch(error){row.error=String(error);throw error}})}globalThis.__t25PageAudit=g;return true})()`);
 return{
  records:()=>app.mainEvaluate('globalThis.__t25PageAudit.records'),
  restore:()=>app.mainEvaluate('(()=>{const g=globalThis.__t25PageAudit;if(g){for(const {key,original}of g.originals)process.getBuiltinModule("module").createRequire(process.resourcesPath+"/app.asar/package.json")("electron").ipcMain._invokeHandlers.set(key,original);delete globalThis.__t25PageAudit;}return true})()'),
 };
}

export async function pageAuthorizeAndSendOnce({app,ui,project,draft,body,from,to,sink,audit,root,readOnlySql}){
 assert.equal(sink.state.dataAttempts,0);assert.equal(sink.state.messages.length,0);
 assert.deepEqual(await readOnlySql('SELECT id FROM mail_send_intents'),[],'Do not transplant an Agent-origin intent into page execution');
 await ui.project(project);await app.waitFor(`['needs-confirmation','confirmed','automatic'].includes(document.querySelector('.m10-sender-identity')?.dataset.status)`);
 const status=await app.evaluate('document.querySelector(".m10-sender-identity")?.dataset.status');
 if(status==='needs-confirmation'){
  await ui.click('.m10-sender-identity button','确认这是我的发件身份');
  await app.waitFor('document.querySelector(".m10-sender-identity")?.dataset.status==="confirmed"');
 }
 await ui.click('.m10-sidebar .installed','邮件');await app.waitFor('!!document.querySelector(".m10-drafts")');
 await app.waitFor('Array.from(document.querySelectorAll(".m10-drafts button")).some(b=>b.textContent.trim()==="刷新草稿"&&!b.disabled)');
 await ui.click('.m10-drafts button','刷新草稿');
 await app.waitFor('Array.from(document.querySelectorAll(".m10-draft-row")).some(e=>e.textContent.includes('+JSON.stringify(draft.content.subject)+'))');
 await ui.click('.m10-draft-row',draft.content.subject,true);
 await app.waitFor('document.querySelector("dialog")?.textContent.includes('+JSON.stringify('修订 r'+draft.revision)+')');
 await ui.click('dialog button','审阅发送内容');
 await app.waitFor('document.querySelector("dialog")?.textContent.includes("本次发送内容")||!!document.querySelector("dialog [role=alert]")');
 const text=await app.evaluate('document.querySelector("dialog").innerText');
 assert(text.includes(from)&&text.includes(to)&&text.includes(body));assert.equal(sink.state.dataAttempts,0);
 const before=await audit.records(),prepare=before.filter(r=>r.name==='prepareSend').at(-1),review=before.filter(r=>r.name==='reviewSend').at(-1);
 assert(prepare?.reply?.ok&&review?.reply?.ok,'Original real UI must prepare and display a review');
 const shown=review.reply.value;assert.equal(shown.review.draftId,draft.id);assert.equal(shown.review.draftRevision,draft.revision);assert.equal(shown.review.draftContentHash,draft.contentHash);
 assert.equal(shown.review.sourceTaskId,null);assert.equal(shown.review.sourceRunId,null);
 assert(text.includes('点击发送明确授权本次目标与内容。'));
 await app.screenshot(join(root,'t25-page-review-before-mail-authorization.png'));
 // This is the actual mail authorization/execute click. Native client Allow
 // above only allowed local draft creation and is never treated as this grant.
 await ui.click('dialog button','发送此修订');
 await app.waitFor('document.querySelector("dialog")?.textContent.includes("服务器已接受")',15000);
 const after=await audit.records();for(const name of ['prepareSend','reviewSend','authorizeSend','executeSend'])assert.equal(after.filter(r=>r.name===name&&r.reply?.ok).length,1,name+' must complete exactly once');
 assert.equal(sink.state.dataAttempts,1);assert.equal(sink.state.messages.length,1);assert.deepEqual(sink.state.errors,[]);
 const grant=await readOnlySql('SELECT source,state FROM mail_send_grants');assert.equal(grant.length,1);assert.equal(grant[0].source,'renderer-confirmation');
 const intents=await readOnlySql('SELECT id,source_task_id,source_run_id,state FROM mail_send_intents');assert.equal(intents.length,1);assert.equal(intents[0].source_task_id,null);assert.equal(intents[0].source_run_id,null);assert.equal(intents[0].state,'server-accepted');
 const executions=await readOnlySql('SELECT id,state FROM mail_send_executions');assert.equal(executions.length,1);assert.equal(executions[0].state,'server-accepted');
 await app.screenshot(join(root,'t25-page-authorized-single-250.png'));
 const result={beforeReviewNoSmtpData:true,review:shown,pageRecords:after,grant,intents,executions,smtp:sink.state,mailAuthorization:'Actual page reviewed fixed revision then clicked 发送此修订; renderer-confirmation only, L3 remains closed'};
 await writeFile(join(root,'t25-page-send.json'),JSON.stringify(result,null,2)+'\n');await ui.click('dialog button','关闭');await app.waitFor('!document.querySelector("dialog")');return result;
}
