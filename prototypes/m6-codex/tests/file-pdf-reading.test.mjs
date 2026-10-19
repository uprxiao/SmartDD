import assert from 'node:assert/strict';
import {test} from 'node:test';
import {closeFile,fileKey,initialWorkspace,openFile,restoreFile,serializeWorkspaceStore,updatePdfReading} from '../src/file-workspace-model.mjs';
test('prototype PDF reading hints survive close/restore and serialization, while invalid hints and callback attachments stay bounded',()=>{
 const key=fileKey('main','docs/验收.pdf');let s=openFile(initialWorkspace(),'main','docs/验收.pdf',true);
 s=updatePdfReading(s,key,{page:3,zoom:150,password:'never persist'});
 assert.deepEqual(s.tabs.find(t=>t.path.endsWith('.pdf')).pdf,{page:3,zoom:150});
 for(const value of [{page:0,zoom:100},{page:1,zoom:Infinity},{page:1,zoom:801}])assert.equal(updatePdfReading(s,key,value),s);
 const restored=restoreFile(closeFile(s,key));assert.deepEqual(restored.tabs.find(t=>t.path.endsWith('.pdf')).pdf,{page:3,zoom:150});
 const serialized=serializeWorkspaceStore({fixture:restored});assert.deepEqual(serialized.fixture.tabs.find(t=>t.path.endsWith('.pdf')).pdf,{page:3,zoom:150});assert(!JSON.stringify(serialized).includes('password'));
 const attachment={...restored,tabs:[{root:'main',path:'callback.pdf',attachment:{key:'host'},pdf:{page:3,zoom:150}}],active:fileKey('main','callback.pdf'),closed:[]};
 assert(!JSON.stringify(serializeWorkspaceStore({fixture:attachment})).includes('callback.pdf'));
});
