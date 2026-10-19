import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/file-workspace-model.mjs';
import {createFixtureFileProvider} from '../src/file-interaction-model.mjs';
const roots=[{id:'main',hostId:'local',path:'/synthetic/root'}];
const files=[{path:'a.txt',kind:'code',text:'A'},{path:'b.txt',kind:'code',text:'B'}];
for(const action of ['delete','rename'])test('C15 stale '+action+' result revalidates against pending external data without refreshing the visible tree',()=>{
 let state={...model.initialWorkspace(),tabs:[],active:null,syntheticFiles:{main:files}};
 state=model.openFile(state,'main','a.txt',true);
 state=model.queueSyntheticDirectoryChanges(state,'main',[action==='delete'?{type:'delete',path:'a.txt'}:{type:'rename',from:'a.txt',to:'renamed.txt'}]);
 const next=model.openVerifiedDocument(state,roots,'main','a.txt',true,[]);
 assert.equal(next.active,model.fileKey('main','a.txt'));
 assert.equal(model.fileScenario(next,next.active),'missing');
 assert.deepEqual(model.prototypeDirectoryFiles(next,'main',[]).map(f=>f.path),['a.txt','b.txt']);
 assert.equal(next.pendingDirectoryChanges.main.length,1);
 assert(!next.tabs.some(tab=>tab.path==='b.txt'||tab.path==='renamed.txt'));
});
for(const mode of ['permission','timeout'])test('C12 synthetic '+mode+' remains a distinct rejected search instead of empty success',async()=>{
 const provider=createFixtureFileProvider(files,{delay:0});
 await assert.rejects(provider.names('a',{mode}),mode==='permission'?/权限|PERMISSION/:/超时|TIMEOUT/);
 assert.equal((await provider.names('a',{mode:'ready'})).some(x=>x.path==='a.txt'),true);
});
test('C12 genuine empty synthetic candidate list completes successfully',async()=>{
 assert.deepEqual(await createFixtureFileProvider(files,{delay:0}).names('NO_MATCH_987'),[]);
});
