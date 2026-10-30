import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace,openFile,closeFile,editDraft,fileKey,setFileScenario,fileScenario,prototypeCloseContext,prototypeCloseIsCurrent,completeSyntheticWorkspaceRestores} from '../src/file-workspace-model.mjs';
const fixture=()=>{let s={...initialWorkspace(),tabs:[],active:null};s=openFile(s,'main','A.txt',true);return editDraft(s,s.active,'OLD draft','Original')};
test('D11 an unchanged close context belongs to its original task/tab/draft only',()=>{
 const state=fixture(),context=prototypeCloseContext(state,state.active,'T1');assert.equal(prototypeCloseIsCurrent(state,context,'T1'),true);assert.equal(prototypeCloseIsCurrent(state,context,'T2'),false);
});
test('D11 reopening the same route invalidates its old close confirmation',()=>{
 const state=fixture(),context=prototypeCloseContext(state,state.active,'T1');const next=openFile(closeFile(state,state.active),'main','A.txt',true);assert.equal(prototypeCloseIsCurrent(next,context,'T1'),false);assert.equal(next.drafts[next.active].text,'OLD draft');
});
test('D11 a newer draft cannot be discarded by an older confirmation',()=>{
 const state=fixture(),context=prototypeCloseContext(state,state.active,'T1'),next=editDraft(state,state.active,'NEW draft','Original');assert.equal(prototypeCloseIsCurrent(next,context,'T1'),false);assert.equal(next.drafts[next.active].text,'NEW draft');
});
test('D18 background restore completes T1 without changing T2 route or draft',()=>{
 let one=fixture();one=setFileScenario(one,one.active,'loading');let two=fixture();two=editDraft(two,two.active,'Task2 draft','Original');const before={saved:{sentinel:'keep'},T1:one,T2:two},after=completeSyntheticWorkspaceRestores(before);assert.equal(after.T2,two);assert.equal(after.saved,before.saved);assert.equal(after.T1.active,fileKey('main','A.txt'));assert.equal(fileScenario(after.T1,after.T1.active),'ready');assert.equal(after.T2.drafts[after.T2.active].text,'Task2 draft');
});
