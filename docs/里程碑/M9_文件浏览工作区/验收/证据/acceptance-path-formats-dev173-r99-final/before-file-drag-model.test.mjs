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

test('cancelled prototype drop gives one re-drag reason; newer input clears old cancellation',()=>{const old=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'old'});endFileDrag();assert.equal(resolveFileDrag(old.token,'t').error,'cancelled-drag');assert.equal(resolveFileDrag(old.token,'t').error,'unknown-drag');const abandoned=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'abandoned'});endFileDrag();const next=beginFileDrag({taskId:'t',rootPath:'/work',relativePath:'next'});assert.equal(resolveFileDrag(next.token,'t').path,'/work/next');assert.equal(resolveFileDrag(abandoned.token,'t').error,'unknown-drag');});

test('same task with a rebuilt PTY cannot consume an old captured drag',()=>{const old=beginFileDrag({taskId:'t',ptyId:'old-pty',rootPath:'/work',relativePath:'a'});assert.equal(resolveFileDrag(old.token,'t','new-pty').error,'foreign-task');endFileDrag();const next=beginFileDrag({taskId:'t',ptyId:'new-pty',rootPath:'/work',relativePath:'b'});assert.equal(resolveFileDrag(next.token,'t','new-pty').path,'/work/b');});

test('Y39 forged DataTransfer path/root/file/task or URL never becomes or consumes a catalog source',()=>{
 const valid=beginFileDrag({taskId:'t',rootPath:'/synthetic/local',relativePath:'picture.png'});
 for(const forged of[JSON.stringify({path:'/synthetic/local/picture.png',rootId:'main',fileId:'picture.png',taskId:'t'}),'picture.png','/synthetic/local/picture.png','https://invalid.example/p.png','data:image/png;base64,AA==','blob:synthetic'])assert.equal(resolveFileDrag(forged,'t').error,'unknown-drag');
 assert.equal(resolveFileDrag(valid.token,'t').path,'/synthetic/local/picture.png');endFileDrag();
 for(const rootPath of['ssh://other/same','https://invalid.example','blob:synthetic','data:image/png;base64,AA=='])assert.equal(beginFileDrag({taskId:'t',rootPath,relativePath:'picture.png'}).ok,false);
});

test('Y35 all legal filename classes preserve exact catalog paths; all control bytes reject whole identity',()=>{
 for(const name of['中文.txt','with space.txt','emoji🙂.txt',"single'quote.txt",'double"quote.txt','paren().txt','semi;.txt','grave`.txt','cash$().txt',"中文 空格🙂'\"();`$().txt"]){const path='/synthetic/'+name;assert.equal(absoluteFilePath('/synthetic',name).path,path);assert.equal(buildFilePathInsertion({...terminal,path}).data,path+' ');}
 for(const code of[...Array.from({length:32},(_,i)=>i),...Array.from({length:33},(_,i)=>127+i)]){const name='a'+String.fromCharCode(code)+'b';assert.equal(beginFileDrag({taskId:'t',rootPath:'/synthetic',relativePath:name}).ok,false);assert.equal(buildFilePathInsertion({...terminal,path:'/synthetic/'+name}).error,'unsafe-path');}endFileDrag();
});
test('Y35 exactly L-1/L/L+1 count the final separator and never truncate an over-limit file identity',()=>{
 for(const total of[7999,8000,8001]){const path='/'+'x'.repeat(total-2),result=buildFilePathInsertion({...terminal,path});if(total<=8000){assert.equal(result.data,path+' ');assert.equal(result.data.length,total);}else{assert.equal(result.error,'too-large');assert.equal(result.data,undefined);}}
});
