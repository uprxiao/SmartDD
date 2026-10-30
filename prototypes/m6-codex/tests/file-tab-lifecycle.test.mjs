import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace,openFile,closeFile,restoreFile,fileKey,editDraft} from '../src/file-workspace-model.mjs';
const names=s=>s.tabs.map(t=>t.path);
function fixture(){return{...initialWorkspace(),tabs:[],active:null}}
test('D12 undo uses reverse close order and original indices',()=>{
 let s=fixture();for(const n of ['a','b','c','d'])s=openFile(s,'main',n,true);s=closeFile(s,fileKey('main','b'));s=closeFile(s,fileKey('main','c'));s=restoreFile(s);assert.deepEqual(names(s),['a','c','d']);s=restoreFile(s);assert.deepEqual(names(s),['a','b','c','d']);assert.equal(s.active,fileKey('main','b'));
});
test('D12 undo keeps an already open file in its existing position without duplicates',()=>{
 let s=fixture();for(const n of ['a','b','c'])s=openFile(s,'main',n,true);s=closeFile(s,fileKey('main','b'));s=openFile(s,'main','b',true);const order=names(s);s=restoreFile(s);assert.deepEqual(names(s),order);assert.equal(s.closed.length,0);assert.equal(s.tabs.length,3);
});
test('D13 exactly the latest25 of26 closed fixed files can restore',()=>{
 let s=fixture();const files=Array.from({length:26},(_,i)=>'file-'+i);for(const n of files)s=openFile(s,'main',n,true);for(const n of files)s=closeFile(s,fileKey('main',n));const restored=[];while(s.closed.length){s=restoreFile(s);restored.push(s.active)}assert.deepEqual(restored,files.slice(1).reverse().map(n=>fileKey('main',n)));assert.equal(s.tabs.length,25);
});
test('D06 editing a preview pins it before opening another preview',()=>{
 let s=openFile(fixture(),'main','a',false);s=editDraft(s,s.active,'Local','Base');s=openFile(s,'main','b',false);assert.deepEqual(names(s),['a','b']);assert.equal(s.tabs[0].preview,false);assert.equal(s.drafts[fileKey('main','a')].text,'Local');
});
test('D04 roots with the same basename retain separate tabs and drafts',()=>{
 let s=openFile(fixture(),'main','same.txt',true);s=editDraft(s,s.active,'Local A','Base A');s=openFile(s,'extra','same.txt',true);s=editDraft(s,s.active,'Local B','Base B');assert.equal(s.tabs.length,2);assert.equal(s.drafts[fileKey('main','same.txt')].text,'Local A');assert.equal(s.drafts[fileKey('extra','same.txt')].text,'Local B');
});
