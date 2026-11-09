import assert from'node:assert/strict';
const objects=x=>assert(x&&typeof x==='object'&&!Array.isArray(x),'Exact object required'),string=x=>assert.equal(typeof x,'string');
const commandIds={'browser identity get':'browser.identity.get','browser tab create':'browser.tab.create','browser tab profile show':'browser.profile.show','browser tab profile list':'browser.profile.list','browser tab profile create':'browser.profile.create','browser tab profile set':'browser.profile.set','browser snapshot':'browser.nav.snapshot','browser fill':'browser.interact.fill','browser click':'browser.interact.click','browser reload':'browser.nav.reload'};
const readonly=new Set(['browser.identity.get','browser.profile.show','browser.profile.list','browser.nav.snapshot']);
export function idFor(argv){const tokens=[];for(const x of argv){if(x.startsWith('--'))break;tokens.push(x)}const id=commandIds[tokens.join(' ')];assert(id,'No unreviewed command extractor');return id}
function profile(p){objects(p);for(const key of['id','scope','label','partition'])string(p[key]);objects(p.owner);assert(['task','project'].includes(p.owner.kind));string(p.owner.id);return p}
export function extractOutput(argv,value){
 const id=idFor(argv);objects(value);assert.equal(value.schema,'willyou-app-result-v2');assert.equal(value.status,'ok','Error envelopes must stop dependencies');assert.equal(value.capabilityId,id);assert.equal(value.operation.origin,'cli');assert.equal(value.operation.effectState,readonly.has(id)?'read-only':'completed','Unknown result must never advance');assert.equal(value.source.appId,'browser');assert.equal(value.source.packageHash,'d160b699f23c03712297ec6a2025e8898abacc36a4febf6d6229e8beea2b3fd6');objects(value.data);assert(!Object.hasOwn(value.data,'operation'),'Operation receipt is not a successful business result');const d=value.data;
 switch(id){
  case'browser.tab.create':assert(!Object.hasOwn(d,'result'));string(d.pageId);string(d.url);return d;
  case'browser.identity.get':assert(!Object.hasOwn(d,'mode'));objects(d.result);assert(['clean','native'].includes(d.result.mode));assert(d.result.pendingMode===null||['clean','native'].includes(d.result.pendingMode));assert.equal(typeof d.result.restartRequired,'boolean');return d.result;
  case'browser.profile.show':assert(!Object.hasOwn(d,'profileId'));objects(d.result);for(const k of['browserPageId','profileId','profileLabel'])string(d.result[k]);return d.result;
  case'browser.profile.list':assert(!Object.hasOwn(d,'profiles'));objects(d.result);assert(Array.isArray(d.result.profiles));d.result.profiles.forEach(profile);return d.result.profiles;
  case'browser.profile.create':assert(!Object.hasOwn(d,'profile'));objects(d.result);return profile(d.result.profile);
  case'browser.profile.set':assert(!Object.hasOwn(d,'profileId'));objects(d.result);string(d.result.profileId);assert(Array.isArray(d.result.pages));d.result.pages.forEach(string);return d.result;
  case'browser.nav.snapshot':assert(!Object.hasOwn(d,'result'));for(const k of['snapshot','browserPageId','url','title'])string(d[k]);assert(Array.isArray(d.refs));for(const ref of d.refs){for(const k of['ref','role','name'])string(ref[k]);assert.equal(typeof ref.available,'boolean')}return d;
  case'browser.interact.fill':assert(!Object.hasOwn(d,'result'));string(d.filled);return d;
  case'browser.interact.click':assert(!Object.hasOwn(d,'result'));string(d.clicked);return d;
  case'browser.nav.reload':assert(!Object.hasOwn(d,'url'));objects(d.result);string(d.result.url);string(d.result.title);return d.result;
 }
 throw Error('Missing exact extractor '+id);
}
