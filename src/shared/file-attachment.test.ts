import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {attachmentTextKind,fileTextPresentation} from './file-attachment.mjs';
import {fileOpenSchema} from './files';
describe('Source-aware readonly text presentation',()=>{
 it('keeps workspace MDX Markdown while attachment MDX stays source, independent of MIME',()=>{
  for(const extension of ['md','markdown','mdown','mkd']){expect(attachmentTextKind('file.'+extension,'text/html')).toBe('markdown');expect(fileTextPresentation('file.'+extension,{textKind:'markdown'})).toBe('markdown')}
  expect(fileTextPresentation('file.mdx')).toBe('markdown');expect(attachmentTextKind('file.mdx','text/markdown')).toBeNull();expect(fileTextPresentation('file.mdx',{textKind:null,mimeType:'text/markdown'})).toBe('source');
 });
 it('uses explicitly supported MIME aliases only when no extension is present',()=>{
  for(const [mime,kind] of [['text/html','html'],['application/markdown','markdown'],['application/x-markdown','markdown'],['text/markdown','markdown'],['text/x-markdown','markdown'],['text/plain','text']] as const){expect(attachmentTextKind('parent.with-dot/file',mime)).toBe(kind);expect(attachmentTextKind('file.unknown',mime)).toBeNull()}
  for(const mime of [' Application/Markdown; charset=UTF-8 ',' APPLICATION/X-MARKDOWN; charset=utf-8 '])expect(attachmentTextKind('file',mime)).toBe('markdown');
  expect(attachmentTextKind('file',' Text/Markdown; charset=utf-8 ')).toBe('markdown');expect(attachmentTextKind('file','application/octet-stream')).toBeNull();expect(attachmentTextKind('file')).toBeNull();expect(attachmentTextKind('file.txt','text/html')).toBe('text');
 });
 it('preserves explicit CSV/TeX presentation and keeps ordinary unknown text source',()=>{
  for(const attachment of [undefined,{textKind:null} as const]){expect(fileTextPresentation('x.csv',attachment)).toBe('csv');expect(fileTextPresentation('x.tsv',attachment)).toBe('csv');expect(fileTextPresentation('x.tex',attachment)).toBe('tex');expect(fileTextPresentation('x.unknown',attachment)).toBe('source')}
  expect(fileTextPresentation('no-extension',{textKind:'html'})).toBe('html');expect(fileTextPresentation('no-extension',{textKind:'markdown'})).toBe('markdown');
 });
 it('accepts attachment hints only on narrowed capabilities and rejects unknown/control/oversize metadata',()=>{
  const path={lease:randomUUID(),generation:1,relativePath:'file'};expect(fileOpenSchema.safeParse({...path,attachment:{}}).success).toBe(false);expect(fileOpenSchema.safeParse({...path,readOnly:false,attachment:{}}).success).toBe(false);expect(fileOpenSchema.safeParse({...path,readOnly:true,attachment:{mimeType:'text/html'}}).success).toBe(true);
  for(const attachment of [{mimeType:'text/html\n'}, {mimeType:'x'.repeat(257)}, {mimeType:1}, {mimeType:'text/html',writable:true}])expect(fileOpenSchema.safeParse({...path,readOnly:true,attachment}).success).toBe(false);
 });
});
