import test from 'node:test';
import assert from 'node:assert/strict';
import {prototypeAttachmentFile,attachmentExamples} from '../src/file-attachment-presentation.mjs';
test('prototype shares attachment suffix/MIME policy while keeping ordinary and binary/artifact kinds',()=>{
 const mdx={path:'example.mdx',kind:'markdown',text:'# source'};assert.equal(prototypeAttachmentFile(mdx,undefined),mdx);assert.equal(prototypeAttachmentFile(mdx,{mimeType:'text/markdown'}).kind,'code');
 assert.equal(prototypeAttachmentFile({path:'sample.md',kind:'markdown'},{mimeType:'text/html'}).kind,'markdown');assert.equal(prototypeAttachmentFile({path:'sample.unknown',kind:'code'},{mimeType:'text/markdown'}).kind,'code');
 for(const mimeType of ['application/markdown','application/x-markdown','text/markdown','text/x-markdown']){assert.equal(prototypeAttachmentFile({path:'no-extension',kind:'code'},{mimeType}).kind,'markdown');assert.equal(prototypeAttachmentFile({path:'sample.unknown',kind:'code'},{mimeType}).kind,'code')}assert.equal(prototypeAttachmentFile({path:'no-extension',kind:'code'},{mimeType:'text/html'}).kind,'html');
 for(const kind of ['image','pdf','ipynb','xlsx','pptx','binary']){const file={path:'no-extension',kind};assert.equal(prototypeAttachmentFile(file,{mimeType:'text/html'}),file)}
 assert.equal(attachmentExamples.length,7);assert.equal(new Set(attachmentExamples.map(i=>i.path)).size,7);
});
