import test from 'node:test';
import assert from 'node:assert/strict';
import {BUGS,STORIES,demoZentaoPage} from '../src/zentao-prototype-model.mjs';
import {referenceText} from '../src/integration-model.mjs';
test('type and numeric identity stay distinct for colliding demo objects and references',()=>{
 const bug=demoZentaoPage('bug','812',1,'long').items[0],story=demoZentaoPage('story','812',1,'long').items[0];
 assert.equal(bug.id,story.id);assert.notEqual(bug.type,story.type);assert.match(bug.detail,/重现步骤/);assert.match(story.detail,/验收标准/);
 assert.match(referenceText(bug.type,bug.id),/\/bug\/812/);assert.match(referenceText(story.type,story.id),/\/story\/812/);
});
test('bounded paging and filtered empty results never borrow another object type',()=>{
 const first=demoZentaoPage('bug'),last=demoZentaoPage('bug','',999);assert.equal(first.items.length,2);assert.equal(last.page,2);assert.equal(last.items.length,1);assert.notEqual(first.items[0].id,last.items[0].id);
 assert.equal(demoZentaoPage('bug','目录').total,1);assert.equal(demoZentaoPage('story','no-such-object').total,0);assert.equal(demoZentaoPage('bug','',-1).page,1);assert.throws(()=>demoZentaoPage('task'));
});
test('long/missing attachment fixtures do not mutate original object data',()=>{
 const before=JSON.stringify({BUGS,STORIES});const long=demoZentaoPage('story','',1,'long').items[0];assert(long.detail.length>500);assert(long.history.length>300);assert.equal(long.attachmentMissing,true);assert.equal(demoZentaoPage('bug').items[0].attachmentMissing,false);assert.equal(JSON.stringify({BUGS,STORIES}),before);
});
