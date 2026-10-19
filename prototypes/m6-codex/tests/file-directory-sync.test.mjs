import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace,openFile,closeFile,fileKey,setFileScenario,editDraft,commitDraft,documentKey,prototypeDirectoryFiles,queueSyntheticDirectoryChanges,refreshSyntheticDirectoryStore,retrySyntheticFile } from '../src/file-workspace-model.mjs';
test('a deleted dirty prototype document cannot save into a same-name replacement, even with conflict override',()=>{
 const roots=[{id:'main',hostId:'local',path:'/synthetic/root'}];let state=openFile(initialWorkspace(),'main','external-sync/dirty.txt',true);state=editDraft(state,state.active,'Retained local draft','Original bytes');state=setFileScenario(state,state.active,'missing');
 const store={task:state,saved:{[documentKey(roots,fileKey('main','external-sync/dirty.txt'))]:'Original bytes'}};
 for(const override of [false,true]){const result=commitDraft(store,'task',roots,state.active,{override});assert.notEqual(result.result,'saved');assert.equal(result.store,store);assert.equal(result.store.task.drafts[state.active].text,'Retained local draft');}
});
const roots=[{id:'main',hostId:'local',path:'/synthetic/root'},{id:'extra',hostId:'local',path:'/synthetic/extra'}],files=[{path:'a.txt',kind:'code',text:'A'},{path:'b.txt',kind:'code',text:'B'},{path:'dirty.txt',kind:'code',text:'Original bytes'}];
function fixture(active='b.txt'){let state={...initialWorkspace(),tabs:[],active:null,syntheticFiles:{main:files,extra:files}};state=openFile(state,'main',active,true);return{task:state,saved:{}}}
const flush=store=>refreshSyntheticDirectoryStore(store,'task',roots,'main',[]);
test('external add/delete/rename is staged per root and applied as one refresh, old tab becomes missing',()=>{
 const original=fixture(),changes=[{type:'create',file:{path:'new.txt',kind:'code',text:'NEW'}},{type:'delete',path:'a.txt'},{type:'rename',from:'b.txt',to:'c.txt'}],queued={...original,task:queueSyntheticDirectoryChanges(original.task,'main',changes)};
 assert.deepEqual(prototypeDirectoryFiles(queued.task,'main',[]).map(x=>x.path),['a.txt','b.txt','dirty.txt']);const after=flush(queued);
 assert.deepEqual(new Set(prototypeDirectoryFiles(after.task,'main',[]).map(x=>x.path)),new Set(['dirty.txt','new.txt','c.txt']));assert.equal(after.task.fileStates[fileKey('main','b.txt')].scenario,'missing');assert.equal(after.task.retiredFiles[fileKey('main','b.txt')].text,'B');
 assert.deepEqual(after.task.syntheticFiles.extra,files);assert.deepEqual(after.task.pendingDirectoryChanges.main,[]);assert.equal(after.saved[documentKey(roots,fileKey('main','c.txt'))],'B');assert.equal(original.task.syntheticFiles.main[1].path,'b.txt');
});
test('dirty deletion and same-bytes recreation retains the old draft and blocks retry/save until explicit close',()=>{
 let store=fixture('dirty.txt'),key=store.task.active;store.task=editDraft(store.task,key,'Retained local draft','Original bytes');store=flush({...store,task:queueSyntheticDirectoryChanges(store.task,'main',[{type:'delete',path:'dirty.txt'}])});
 const retiredId=store.task.retiredFiles[key].syntheticId;store=flush({...store,task:queueSyntheticDirectoryChanges(store.task,'main',[{type:'create',file:{path:'dirty.txt',kind:'code',text:'Original bytes'}}])});
 const replacement=prototypeDirectoryFiles(store.task,'main',[]).find(x=>x.path==='dirty.txt');assert.notEqual(replacement.syntheticId,retiredId);assert.equal(retrySyntheticFile(store.task,'main','dirty.txt',[]).result,'changed-file');
 assert.equal(commitDraft(store,'task',roots,key,{override:true}).result,'missing');assert.equal(store.task.drafts[key].text,'Retained local draft');assert.equal(store.saved[documentKey(roots,key)],'Original bytes');
 store.task=closeFile({...store.task,drafts:{}},key);store.task=openFile(store.task,'main','dirty.txt',true);assert.equal(store.task.retiredFiles[key],undefined);assert.equal(store.task.fileStates[key],undefined);
});
test('restoring the same synthetic identity permits retry and keeps an independent manual draft',()=>{
 let store=fixture('dirty.txt'),key=store.task.active;store.task=editDraft(store.task,key,'Draft','Original bytes');store=flush({...store,task:queueSyntheticDirectoryChanges(store.task,'main',[{type:'delete',path:'dirty.txt'}])});const original=store.task.retiredFiles[key];
 assert.equal(retrySyntheticFile(store.task,'main','dirty.txt',[]).result,'missing');store=flush({...store,task:queueSyntheticDirectoryChanges(store.task,'main',[{type:'restore',file:original}])});assert.equal(store.task.retiredFiles[key],undefined);assert.equal(store.task.drafts[key].text,'Draft');assert.equal(commitDraft(store,'task',roots,key).result,'saved');
});
test('deletion tombstones default fixtures and no-op refresh cannot resurrect them or undo saved edits',()=>{
 let store=fixture('a.txt');store.saved[documentKey(roots,fileKey('main','dirty.txt'))]='Previously saved edit';store.task=queueSyntheticDirectoryChanges(store.task,'main',[{type:'delete',path:'a.txt'}]);store=refreshSyntheticDirectoryStore(store,'task',roots,'main',files);assert(!prototypeDirectoryFiles(store.task,'main',files).some(x=>x.path==='a.txt'));
 store=refreshSyntheticDirectoryStore(store,'task',roots,'main',files);assert(!prototypeDirectoryFiles(store.task,'main',files).some(x=>x.path==='a.txt'));assert.equal(store.saved[documentKey(roots,fileKey('main','dirty.txt'))],'Previously saved edit');assert.equal(store.task.directoryRevisions.main,2);
});
