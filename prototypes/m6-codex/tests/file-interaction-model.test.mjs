import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureFileProvider, directoryIndex, largeDirectoryFixture, latestRequestGate, loadedTreeRows, nearestTreeScroll, stickyTreeAncestors, virtualTreeWindow, waitForFixture } from '../src/file-interaction-model.mjs';
import { rankedTreeRows } from '../src/file-workspace-model.mjs';

test('directory queries expose only immediate children including stable sorted empty folders',()=>{
  const index=directoryIndex([{path:'z.txt'},{path:'a/deep/file.txt'},{path:'.hidden'}],['empty']);
  assert.deepEqual(index.get('').map(x=>[x.path,x.folder]),[['a',true],['empty',true],['.hidden',false],['z.txt',false]]);
  assert.deepEqual(index.get('a').map(x=>x.path),['a/deep']);assert.deepEqual(index.get('empty'),[]);
});
test('unexpanded directories never trigger recursive list calls',async()=>{
  const provider=createFixtureFileProvider(largeDirectoryFixture(),{delay:0});
  const root=await provider.list('');assert.equal(root.length,1);
  assert.deepEqual(provider.requests,[{type:'list',path:''}]);
  const group=await provider.list('大目录');assert.equal(group.length,24);assert.equal(provider.requests.length,2);
});
test('loaded rows preserve distinct loading, rejected and empty child states',()=>{
  const entries=['a','b','c'].map(path=>({path,name:path,folder:true}));
  const rows=loadedTreeRows({'':{state:'ready',entries},b:{state:'error'},c:{state:'ready',entries:[]}},['a','b','c']);
  assert.deepEqual(rows.filter(r=>r.status).map(r=>r.status),['loading','error','empty']);
  assert.equal(loadedTreeRows({'':{state:'ready',entries}},[]).length,3);
});
test('a directory error can be retried without substituting an empty result',async()=>{
  const provider=createFixtureFileProvider([],{delay:0,emptyDirs:['denied'],failDirectories:['denied']});
  await assert.rejects(provider.list('denied'),/读取被拒绝/);
  assert.deepEqual(await provider.list('denied'),[]);
});
test('6,000 rows keep the rendered window bounded and retain full scroll extent',()=>{
  const rows=largeDirectoryFixture().map(file=>({...file,name:file.path,depth:0}));
  const atStart=virtualTreeWindow(rows,0,560),atEnd=virtualTreeWindow(rows,167440,560);
  assert.ok(atStart.rows.length<=24);assert.ok(atEnd.rows.length<=28);assert.equal(atEnd.end,6000);assert.equal(atStart.total,168000);
});
test('sticky ancestry follows path boundaries rather than similar folder prefixes',()=>{
  const rows=[{path:'foo',folder:true},{path:'foo/a',folder:true},{path:'foo/a/x'}, {path:'foobar',folder:true},{path:'foobar/y'}];
  assert.deepEqual(stickyTreeAncestors(rows,60).map(r=>r.path),['foo','foo/a']);
  assert.deepEqual(stickyTreeAncestors(rows,113).map(r=>r.path),['foobar']);
});
test('nearest reveal preserves visible position and avoids the sticky overlay',()=>{
  assert.equal(nearestTreeScroll(10,200,300,28),200);
  assert.equal(nearestTreeScroll(5,200,300,28),112);
  assert.equal(nearestTreeScroll(30,200,300,28),568);
});
test('superseding query and root identities abort and reject old completion tokens',()=>{
  const gate=latestRequestGate(),old=gate.start('rootA:q1'),next=gate.start('rootA:q2');
  assert.equal(old.signal.aborted,true);assert.equal(gate.accepts(old),false);assert.equal(gate.accepts(next),true);
  const switched=gate.start('rootB:q2');assert.equal(next.signal.aborted,true);gate.cancel();assert.equal(gate.accepts(switched),false);
});
test('abort cancels a pending fixture callback rather than delivering a late result',async()=>{
  const controller=new AbortController(),pending=waitForFixture(1000,controller.signal);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
});
test('async candidates cover unopened descendants and omit excluded path segments',async()=>{
  const provider=createFixtureFileProvider([{path:'unopened/deep/main.ts'},{path:'node_modules/main.ts'},{path:'.main.ts'}],{delay:0});
  const result=await provider.names('main');assert.deepEqual(new Set(result.map(f=>f.path)),new Set(['unopened/deep/main.ts','.main.ts']));
  assert.equal(provider.requests.filter(r=>r.type==='list').length,0);
});
test('candidate cancellation is observed during a multi-batch large scan',async()=>{
  const provider=createFixtureFileProvider(largeDirectoryFixture(),{delay:0}),controller=new AbortController();
  const pending=provider.names('文件',{signal:controller.signal});setTimeout(()=>controller.abort(),2);
  await assert.rejects(pending,{name:'AbortError'});
});
test('fulltext streams bounded batches and preserves UTF-16 editor columns',async()=>{
  const files=Array.from({length:230},(_,i)=>({path:`docs/f${i}.ts`,text:'中文😀 needle'}));
  const chunks=[],provider=createFixtureFileProvider(files,{delay:0});
  const result=await provider.content('needle','*.ts',{onChunk:chunk=>chunks.push(chunk)});
  assert.equal(result.hits.length,100);assert.equal(result.capped,true);assert.equal(result.hits[0].column,6);
  assert.equal(chunks.flat().length,100);assert.ok(chunks.every(c=>c.length<=100));
});
test('exactly 100 matches are not falsely labelled truncated and glob negation excludes',async()=>{
  const files=Array.from({length:100},(_,i)=>({path:`f${i}.ts`,text:'hit'}));files.push({path:'skip.md',text:'hit'});
  const result=await createFixtureFileProvider(files,{delay:0}).content('hit','!*.md');
  assert.equal(result.hits.length,100);assert.equal(result.capped,false);
});
test('ranked search rows preserve compact ancestor and collapsed hierarchy for large candidates',()=>{
  const candidates=largeDirectoryFixture(2,250);
  const rows=rankedTreeRows(candidates);assert.equal(rows.filter(r=>!r.folder).length,500);
  assert.equal(rows.find(r=>r.path==='大目录/模块-01').depth,1);
  assert.equal(rankedTreeRows(candidates,['大目录/模块-01']).filter(r=>!r.folder).length,250);
});
