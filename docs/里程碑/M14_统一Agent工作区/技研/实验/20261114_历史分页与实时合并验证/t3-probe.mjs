import { build } from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='/Users/hx/projects/t3code', out=new URL('./t3-merge.mjs',import.meta.url).pathname;
const built=await build({entryPoints:[root+'/packages/client-runtime/src/state/threadHistoryMerge.ts'],bundle:true,format:'esm',platform:'node',outfile:out,metafile:true,alias:{'@t3tools/shared/orchestrationV2Timeline':root+'/packages/shared/src/orchestrationV2Timeline.ts'}});
const {mergeOlderHistoryIntoProjection:merge,isActiveHistoryRequestCursor:active,clearActiveHistoryLoading:clear}=await import(out);
const row=(id,source='t',output='old',type='command_execution')=>({position:0,visibility:source==='t'?'local':'inherited',sourceThreadId:source,sourceItemId:id,item:{id,threadId:source,type,runId:null,nodeId:null,ordinal:Number(id.slice(1)),status:'completed',output}});
const proj=(visible,items=visible.map(r=>r.item))=>({thread:{id:'t'},visibleTurnItems:visible,turnItems:items,runs:[],attempts:[]});
const results=[];function test(id,f){f();results.push({id,passed:true});}
test('T01-current-content-wins-and-source-identities-distinct',()=>{const current=row('i2','t','new');const p=merge(proj([current]),[row('i1'),row('i2'),row('i2','parent')]);assert.equal(p.visibleTurnItems.length,3);assert.equal(p.visibleTurnItems.find(r=>r.sourceThreadId==='t'&&r.sourceItemId==='i2').item.output,'new');assert.equal(p.turnItems.length,2);});
test('T02-hidden-local-item-does-not-reappear',()=>{const p=proj([],[row('i1','t','new').item]);assert.equal(merge(p,[row('i1')]),p);});
test('T03-page-deduplication-and-live-tail-retained',()=>{const p=merge(proj([row('i3')]),[row('i1'),row('i1'),row('i2')]);assert.deepEqual(p.visibleTurnItems.map(r=>r.sourceItemId),['i1','i2','i3']);assert.deepEqual(p.visibleTurnItems.map(r=>r.position),[0,1,2]);});
test('T04-hidden-state-removal-is-a-negative-control-not-a-complete-client-test',()=>{const p=proj([],[]);assert.equal(merge(p,[row('i1')]).visibleTurnItems.length,1);});
test('T05-old-cursor-cannot-clear-new-loading',()=>{const h={historyCursor:'new',loading:true};assert.equal(active('old',h),false);assert.equal(clear('old',h),h);assert.equal(clear('new',h).loading,false);});
test('T06-retained-pending-request-uses-current-item',()=>{const i=row('i1','t','new','approval_request').item;const p=merge(proj([],[i]),[row('i1','t','old','approval_request')]);assert.equal(p.visibleTurnItems[0].item,i);});
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(new URL('./t3-result.json',import.meta.url),JSON.stringify({scope:'Unmodified actual merge/helper modules bundled with actual visibility dependency; synthetic projections. No complete T3 client/server/UI run.',results,inputs:Object.keys(built.metafile.inputs).map(p=>({path:p,sha256:sha(p)})),bundleSha256:sha(out)},null,2));
console.log(JSON.stringify({passed:results.length,scope:'actual T3 merge module only'}));
