import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteFilePath, beginFileDrag, resolveFileDrag, endFileDrag, buildFilePathInsertion } from '../src/file-drag-model.mjs';
const terminal={taskId:'t',ptyId:'p',owners:new Map([['p','t']]),running:new Set(['t'])};
test('file drag resolves a complete path preserving Chinese, spaces, quotes and image extension',()=>{
 assert.deepEqual(absoluteFilePath('/workspace/中文 项目/','docs/空 格 "图".png'),{ok:true,path:'/workspace/中文 项目/docs/空 格 "图".png'});
 assert.equal(absoluteFilePath('/','a.txt').path,'/a.txt');
 assert.equal(absoluteFilePath('C:/项目','docs/a.txt').path,'C:/项目/docs/a.txt');
});
test('file drag rejects control/bidi/lone surrogate paths rather than sanitising another file',()=>{
 for(const value of ['a\nb','a\rb','a\tb','a\u001bb','a\u202eb','a\ud800b']){
  assert.equal(absoluteFilePath('/work',value).error,'unsafe-path');
  assert.equal(buildFilePathInsertion({...terminal,path:'/work/'+value}).error,'unsafe-path');
 }
});
test('file drag rejects missing or ambiguous roots, traversal and foreign absolute paths',()=>{
 for(const [root,file] of [['work','a'],['/work','../a'],['/work','a/../b'],['/work','/elsewhere'],['/work','C:/x'],['/work','a\\b'],['/work',''],['/work/../other','a']])assert.equal(absoluteFilePath(root,file).ok,false);
});
test('drag payload is an ephemeral catalog token and cannot be replayed or moved to another task',()=>{
 const drag=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'a.png'});
 assert.equal(resolveFileDrag('forged','t').ok,false); assert.equal(resolveFileDrag(drag.token,'other').error,'foreign-task');
 assert.equal(resolveFileDrag(drag.token,'t').path,'/work/a.png');endFileDrag();assert.equal(resolveFileDrag(drag.token,'t').ok,false);
});
test('path insertion preserves input, separates successive paths, leaves space for typing and never Enter',()=>{
 const first=buildFilePathInsertion({...terminal,path:'/work/中文 空格.txt',existingInput:'请查看'});
 assert.equal(first.data,' /work/中文 空格.txt ');assert.ok(!/[\r\n\u001b]/.test(first.data));
 const existing='请查看'+first.data,second=buildFilePathInsertion({...terminal,path:'/work/image.png',existingInput:existing});
 assert.equal(existing+second.data,'请查看 /work/中文 空格.txt /work/image.png ');
 const trailing=buildFilePathInsertion({...terminal,path:'/work/file with trailing space ',existingInput:''});
 assert.equal(trailing.data,'/work/file with trailing space  '); // one real filename space plus one separator
});
test('path insertion refuses stopped or unrelated terminals without starting a task',()=>{
 assert.equal(buildFilePathInsertion({...terminal,path:'/'+'x'.repeat(7998)}).data.length,8000);
 assert.equal(buildFilePathInsertion({...terminal,path:'/'+'x'.repeat(7999)}).error,'too-large');
 assert.equal(buildFilePathInsertion({...terminal,path:'/work/a',running:new Set()}).error,'task-not-running');
 assert.equal(buildFilePathInsertion({...terminal,path:'/work/a',taskId:'other'}).error,'pty-not-owned-by-task');
});

test('a successful drop consumes its token and a newer drag invalidates the previous token',()=>{
 const old=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'old'});
 const current=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'new'});
 assert.equal(resolveFileDrag(old.token,'t').ok,false);assert.equal(resolveFileDrag(current.token,'t').path,'/work/new');
 assert.equal(resolveFileDrag(current.token,'t').error,'unknown-drag');
});
