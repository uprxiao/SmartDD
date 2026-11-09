import assert from 'node:assert/strict';

export const badgeSelector=taskId=>'.bw-workspace[data-browser-task="'+taskId+'"] .bw-profile';
export const badgeExpression=selector=>`(()=>{const xs=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}),e=xs[0],r=e?.getBoundingClientRect(),x=r?r.x+r.width/2:0,y=r?r.y+r.height/2:0,hit=r?document.elementFromPoint(x,y):null,input=e?.closest('.bw-workspace')?.querySelector('[aria-label="网页地址"]'),svg=e?.querySelector('svg');return{uniqueVisible:xs.length,tag:e?.tagName??null,ariaBusy:e?.getAttribute('aria-busy')??null,text:e?.textContent.trim()??null,title:e?.getAttribute('title')??null,disabled:e?!!e.disabled||e.getAttribute('aria-disabled')==='true':true,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,inViewport:!!r&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,centerOwned:!!e&&!!hit&&e.contains(hit),hit:hit?{tag:hit.tagName,className:String(hit.className??'')}:null,svg:svg?{width:svg.getAttribute('width'),height:svg.getAttribute('height'),html:svg.outerHTML}:null,address:input?{placeholder:input.getAttribute('placeholder'),spellCheck:input.spellcheck}:null}})()`;

export function profileBadgeRejectReasons(actual,expected,{interactive=true}={}){
 const reasons=[];
 if(!expected?.profileId||expected.pageProfileId!==expected.profileId)reasons.push('profile-id-not-exact-current-page');
 if(!expected?.label||!['project','isolated','imported'].includes(expected.scope))reasons.push('profile-metadata-not-ready');
 if(actual?.uniqueVisible!==1||actual.tag!=='BUTTON')reasons.push('badge-not-unique-visible-button');
 if(actual?.ariaBusy!=='false')reasons.push('badge-metadata-still-loading');
 if(actual?.text!==(expected.scope==='project'?'项目登录态':'独立登录态'))reasons.push('badge-scope-text-not-ready');
 if(actual?.title!=='当前页面的登录态：'+expected.label)reasons.push('badge-title-not-exact-profile-label');
 if(actual?.svg?.width!=='12'||actual?.svg?.height!=='12'||!actual?.svg?.html.includes('lucide-user-round'))reasons.push('badge-user-round12-not-ready');
 if(actual?.address?.placeholder!=='输入网址或搜索内容'||actual.address.spellCheck!==false)reasons.push('address-P-placeholder-spellcheck-not-ready');
 if(interactive&&(actual?.disabled||!actual?.inViewport||!actual?.centerOwned))reasons.push('badge-not-interactive');
 return reasons;
}

export async function waitForProfileBadge({app,poll,taskId,expected,record,interactive=true}){
 let lastKey,stableAt;
 return poll(async()=>{
  const actual=await app.evaluate(badgeExpression(badgeSelector(taskId))),rejectReasons=profileBadgeRejectReasons(actual,expected,{interactive});
  const sample={at:new Date().toISOString(),kind:'profile-badge-readiness',taskId,expected,interactive,actual,rejectReasons};await record(sample);
  if(rejectReasons.length){lastKey=null;stableAt=null;return null;}
  const key=JSON.stringify([actual.rect,actual.text,actual.title]);
  if(key===lastKey)stableAt??=Date.now();else stableAt=null;lastKey=key;
  return stableAt&&Date.now()-stableAt>=120?sample:null;
 },15000);
}

export function assertSameProfileRecord(records,current,{taskId,pageId}){
 assert.equal(current.taskId,taskId);assert.equal(current.activeId,pageId);assert.equal(current.tabs.length,1);
 const tab=current.tabs[0],matches=records.filter(x=>x.profile.id===tab.profileId);assert.equal(matches.length,1,'Exactly current page profile metadata, not first profile');
 const p=matches[0].profile;assert(p.id&&p.label);
 return{taskId,pageId,profileId:p.id,pageProfileId:tab.profileId,label:p.label,scope:p.scope};
}
