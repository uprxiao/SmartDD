import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
import {fileOpenSchema,type FileDocument,type FileOpenRequest} from '@shared/files';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let base:string,files:FileService,broker:NativeFileBroker;
describe.skipIf(!process.env.SMARTDD_FILES_NATIVE_PATH)('Local attachment presentation authority',()=>{
 beforeEach(()=>{base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-attachment-routing-')));mkdirSync(join(base,'root'));mkdirSync(join(base,'recovery'));broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!);const resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'attachments',path:join(base,'root'),label:'Synthetic attachments'}]};files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'recovery'),resolver))});
 afterEach(async()=>{files.closeOwner('attachments');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})});
 it('derives readonly text presentation from suffix before MIME and retains it over read/refresh',async()=>{
  const root=(await files.openScope('attachments',{kind:'project',projectId:'attachments'})).roots[0];
  const fixtures=[
   ['plain','text/html','html'],['md','text/markdown','markdown'],['alias','text/x-markdown','markdown'],['text','text/plain','text'],
   ['unknown.ext','text/html',null],['source.mdx','text/markdown',null],['known.md','text/html','markdown'],['known.html','text/plain','html'],
  ] as const;
  for(const[name,mimeType,textKind]of fixtures){const path=join(base,'root',name),bytes=Buffer.from('# SYNTHETIC_中文🙂\r\n'),before=sha(bytes);writeFileSync(path,bytes);
   const document=await files.open('attachments',{lease:root.lease,generation:root.generation,relativePath:name,readOnly:true,attachment:{mimeType}} as FileOpenRequest);expect(document.writable).toBe(false);expect((document as FileDocument&{attachment:unknown}).attachment).toEqual({mimeType,textKind});
   expect((await files.read('attachments',document.ref)).document).toMatchObject({writable:false,attachment:{mimeType,textKind}});expect(await files.refresh('attachments',document.ref)).toMatchObject({writable:false,attachment:{mimeType,textKind}});
   await expect(files.checkpoint('attachments',{ref:document.ref,draftId:'00000000-0000-4000-8000-000000000001',bufferVersion:1,baseHash:document.revision.hash,base64:Buffer.from('do not write').toString('base64'),encoding:'utf-8',bom:false})).rejects.toMatchObject({code:'PERMISSION'});
   expect(sha(readFileSync(path))).toBe(before);observations.push({name,mimeType,textKind,readonly:true,sourceSha256:before});files.closeDocument('attachments',document.ref);
  }
 });
 it('rejects MIME hints without readonly narrowing and never forces binary data into text HTML',async()=>{
  const root=(await files.openScope('attachments',{kind:'project',projectId:'attachments'})).roots[0];writeFileSync(join(base,'root','binary'),Buffer.from([0,1,2,3]));
  expect(fileOpenSchema.safeParse({lease:root.lease,generation:root.generation,relativePath:'binary',attachment:{mimeType:'text/html'}}).success).toBe(false);
  const document=await files.open('attachments',{lease:root.lease,generation:root.generation,relativePath:'binary',readOnly:true,attachment:{mimeType:'text/html'}} as FileOpenRequest);expect(document.content?.kind).toBe('binary');expect((document as FileDocument&{attachment:{textKind:unknown}}).attachment.textKind).toBeNull();expect((files.htmlSource('attachments',document.ref) as {attachmentHtml?:boolean}).attachmentHtml).not.toBe(true);
 });
 it('permits only a main-derived extensionless HTML attachment mapping and keeps related files readonly without inheriting MIME',async()=>{
  writeFileSync(join(base,'root','page'),'<h1>HTML_ATTACHMENT</h1>');writeFileSync(join(base,'root','target'),'<h1>TARGET_IS_TEXT</h1>');const root=(await files.openScope('attachments',{kind:'project',projectId:'attachments'})).roots[0];
  const attachment=await files.open('attachments',{lease:root.lease,generation:root.generation,relativePath:'page',readOnly:true,attachment:{mimeType:'text/html'}} as FileOpenRequest);expect((files.htmlSource('attachments',attachment.ref) as {attachmentHtml?:boolean}).attachmentHtml).toBe(true);
  const related=await files.related('attachments',attachment.ref,'target');expect(related.writable).toBe(false);expect((related as FileDocument&{attachment:unknown}).attachment).toEqual({textKind:null});expect((files.htmlSource('attachments',related.ref) as {attachmentHtml?:boolean}).attachmentHtml).not.toBe(true);
  const ordinary=await files.open('attachments',{lease:root.lease,generation:root.generation,relativePath:'page'});expect((ordinary as FileDocument&{attachment?:unknown}).attachment).toBeUndefined();expect((files.htmlSource('attachments',ordinary.ref) as {attachmentHtml?:boolean}).attachmentHtml).not.toBe(true);
 });
});
afterAll(()=>{if(process.env.SMARTDD_ATTACHMENT_ROUTING_EVIDENCE)writeFileSync(process.env.SMARTDD_ATTACHMENT_ROUTING_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I real FileService/native; not App/HTML UI or complete F04/F07/F21/G12 acceptance',observations},null,2)+'\n')});
