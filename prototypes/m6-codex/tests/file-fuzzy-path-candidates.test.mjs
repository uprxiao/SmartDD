import test from 'node:test';
import assert from 'node:assert/strict';
import {searchFiles} from '../src/file-workspace-model.mjs';
const files=['src/foo.ts','src/xfoo.ts','src/foo/child.txt'].map(path=>({path,kind:'code',text:'Synthetic '+path}));
for(const query of['src/foo','src\\foo'])test('mock candidate path separators preserve basename ranking: '+query,()=>{
 const result=searchFiles(files,query);assert.deepEqual(result.map(x=>x.path),['src/foo.ts','src/foo/child.txt','src/xfoo.ts']);assert.equal(result[0].score,110024);assert.equal(result.at(-1).score,0);assert.equal(result[0].matchMode,'path-basename-fallback');
});
for(const query of['src/foo/','src\\foo\\','src/foo\\','src\\foo/'])test('trailing separators do not become basename matches: '+query,()=>{
 const result=searchFiles(files,query);assert.deepEqual(result.map(x=>x.path),['src/foo/child.txt']);assert(result.every(x=>!x.matched&&x.score===0&&x.indices.length===0));
});
