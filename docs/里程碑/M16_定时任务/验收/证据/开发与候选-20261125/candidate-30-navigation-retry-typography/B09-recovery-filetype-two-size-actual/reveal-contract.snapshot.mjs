import assert from 'node:assert/strict';
const matching=(tab,t)=>tab.id===t.page.id&&tab.url===t.url&&tab.profileId===t.page.profile&&tab.importState==='needs-attention';
export function exactBlockedOriginal(s,t,{auxiliaryIds=[],activeId=t.page.id}={}){
 assert(s.taskId===t.taskId&&s.projectId===t.projectId);
 assert(auxiliaryIds.length<=2&&new Set(auxiliaryIds).size===auxiliaryIds.length&&!auxiliaryIds.includes(t.page.id));
 assert.equal(s.tabs.length,1+auxiliaryIds.length);assert.equal(s.tabs.filter(x=>matching(x,t)).length,1);
 assert.equal(s.tabs[0].id,t.page.id);assert.deepEqual(s.tabs.slice(1).map(x=>x.id),auxiliaryIds);
 for(const blank of s.tabs.slice(1))assert(blank.url==='about:blank'&&blank.title==='新标签页'&&blank.profileId===t.page.profile&&blank.importState==='needs-attention'&&!blank.loading&&!blank.failure);
 assert([t.page.id,...auxiliaryIds].includes(activeId));assert.equal(s.activeId,activeId);assert(!s.permission&&!s.auth&&!s.external);return true;
}
export function chooseReveal(ui,legacy){
 assert(ui?.currentTask&&Number.isInteger(ui.originalTabCount)&&ui.originalTabCount>=0&&ui.originalTabCount<=1);
 if(ui.originalWorkspace&&ui.originalSelected&&ui.addressMatches&&ui.banner)return 'already-real-browser-visible';
 if(ui.originalTabCount===1)return 'click-exact-original-tab';
 if(legacy&&ui.fileVisible&&!ui.originalWorkspace&&!ui.banner)return 'legacy-open-and-close-auxiliary-blank';
 return 'wait-existing-restored-tab';
}
// The old *pinned* renderer has no data-browser-page. Its missing optional
// attribute is never sufficient by itself: require the exact selected URL
// button, matching task, address and visible banner, and independent exact
// logical snapshot. The C30 attribute is mandatory and must equal the page.
export function originalUiIdentity(ui,t,legacy){
 return ui.currentTask&&ui.originalTabCount===1&&ui.originalSelected&&ui.originalWorkspace&&ui.addressMatches&&ui.banner&&(legacy?ui.pageAttribute===null:ui.pageAttribute===t.page.id);
}
export function urlSelector(url){return 'button[role=tab][title='+JSON.stringify(url)+'],button[role=tab][data-browser-url='+JSON.stringify(url)+']';}
export const blankCloseSelector='.agent-surface-tab:has(button[role=tab][title="about:blank"],button[role=tab][data-browser-url="about:blank"]) button[aria-label="关闭网页 新标签页"]';
export const selectedBlankCloseSelector='.agent-surface-tab:has(button[role=tab][aria-selected="true"][title="about:blank"],button[role=tab][aria-selected="true"][data-browser-url="about:blank"]) button[aria-label="关闭网页 新标签页"]';
