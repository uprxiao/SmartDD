import assert from 'node:assert/strict';
const matching=(tab,t)=>tab.id===t.page.id&&tab.url===t.url&&tab.profileId===t.page.profile&&tab.importState==='needs-attention';
export function exactBlockedOriginal(s,t,{allowTemporaryId=null,activeOriginal=true}={}){
 assert(s.taskId===t.taskId&&s.projectId===t.projectId);
 assert.equal(s.tabs.length,allowTemporaryId?2:1);assert.equal(s.tabs.filter(x=>matching(x,t)).length,1);
 if(allowTemporaryId){const blank=s.tabs.find(x=>x.id===allowTemporaryId);assert(blank&&blank.id!==t.page.id&&blank.url==='about:blank'&&blank.title==='新标签页'&&blank.profileId===t.page.profile&&blank.importState==='needs-attention'&&!blank.loading&&!blank.failure);}
 assert.equal(s.activeId,activeOriginal?t.page.id:allowTemporaryId);
 assert(!s.permission&&!s.auth&&!s.external);return true;
}
export function chooseReveal(ui,legacy){
 assert(ui?.currentTask&&Number.isInteger(ui.originalTabCount)&&ui.originalTabCount>=0&&ui.originalTabCount<=1);
 if(ui.originalWorkspace&&ui.banner)return 'already-real-browser-visible';
 if(ui.originalTabCount===1)return 'click-exact-original-tab';
 if(legacy&&ui.fileVisible&&!ui.originalWorkspace&&!ui.banner)return 'legacy-open-and-close-auxiliary-blank';
 return 'wait-existing-restored-tab';
}
export function urlSelector(url){return 'button[role=tab][title='+JSON.stringify(url)+'],button[role=tab][data-browser-url='+JSON.stringify(url)+']';}
export const blankCloseSelector='.agent-surface-tab:has(button[role=tab][title="about:blank"],button[role=tab][data-browser-url="about:blank"]) button[aria-label="关闭网页 新标签页"]';
