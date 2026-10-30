import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace,openFile,fileKey,setFileScenario,fileScenario,completeSyntheticFileRestores,serializeWorkspaceStore} from '../src/file-workspace-model.mjs';
test('D17 labelled synthetic background completion keeps the user C route and its exact draft',()=>{
 let s={...initialWorkspace(),tabs:[],active:null};for(const name of['A.txt','B.txt']){s=openFile(s,'main',name,true);s=setFileScenario(s,s.active,'loading')}
 s=openFile(s,'main','C.txt',true);s={...s,drafts:{[s.active]:{text:'Retained C',base:'C'}}};const active=s.active,drafts=s.drafts,tabs=s.tabs;const next=completeSyntheticFileRestores(s);
 assert.equal(next.active,active);assert.equal(next.tabs,tabs);assert.equal(next.drafts,drafts);assert.equal(fileScenario(next,fileKey('main','A.txt')),'ready');assert.equal(fileScenario(next,fileKey('main','B.txt')),'ready');
});
test('D15 prototype checkpoint keeps directory visibility/order/active while omitting previews',()=>{
 let s={...initialWorkspace(),tabs:[],active:null};for(const name of['A.txt','B.txt'])s=openFile(s,'main',name,true);s=openFile(s,'main','C.txt',false);s={...s,active:fileKey('main','B.txt'),tree:false};const saved=serializeWorkspaceStore({scope:s}).scope;
 assert.equal(saved.tree,false);assert.equal(saved.active,fileKey('main','B.txt'));assert.deepEqual(saved.tabs.map(t=>t.path),['A.txt','B.txt']);
});
