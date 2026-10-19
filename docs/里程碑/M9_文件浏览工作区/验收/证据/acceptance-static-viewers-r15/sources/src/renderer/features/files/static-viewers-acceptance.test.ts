import {afterAll,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IpcMainInvokeEvent} from 'electron';
const shell=vi.hoisted(()=>({openExternal:vi.fn(async(_url:string)=>undefined)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell}));
import {createFileController} from '@main/core/files/controller';
import {registerRPCRouter} from '@shared/ipc/rpc';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {readFileResource} from './resource';
import {analyze,renderWindow} from './markdown/model.mjs';
const observations:Record<string,unknown>[]=[];const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_STATIC_VIEWER_EVIDENCE)writeFileSync(process.env.SMARTDD_STATIC_VIEWER_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'Production FileService/roots/revision checked resource reader/Markdown model with packaged native broker; direct service adapter. External-open OS seam is mocked here; actual default browser is verified separately by App.',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_STATIC_VIEWER_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('Static file viewers real-file integration',()=>{
 it('G08/G09/G10 reads exact Markdown/SVG bytes, resolves authorized relative resources and rejects outside roots',async()=>{
  const project=process.env.SMARTDD_STATIC_VIEWER_PROJECT!,base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-static-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'static',path:project,label:'Static viewers'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
  try{
   const root=(await files.openScope('static',{kind:'project',projectId:'static'})).roots[0];
   for(const path of ['metadata-gfm.md','math-code.md','diagram.md','attack.svg','docs/links.md']){
    const absolute=join(project,path),original=readFileSync(absolute),before=statSync(absolute,{bigint:true}),document=await files.open('static',{lease:root.lease,generation:root.generation,relativePath:path}),bytes=await readFileResource(document,{chunk:(ref,offset,size,digest,id)=>files.chunk('static',ref,offset,size,digest,id)},new AbortController().signal);expect(Buffer.from(bytes)).toEqual(original);
    if(path.endsWith('.md')){
     const source=new TextDecoder().decode(bytes),{parsed,index}=analyze(source),items=renderWindow(parsed,0,60);expect(index.at(-3)).toBe(source.length);
     if(path==='metadata-gfm.md'){expect(items.map(i=>i.type)).toEqual(expect.arrayContaining(['frontmatter','table','list']));expect(items.find(i=>i.type==='frontmatter')?.metadata?.entries).toContainEqual(['title','METADATA_中文🙂']);}
     if(path==='math-code.md'){expect(items.some(i=>i.html?.includes('katex'))).toBe(true);expect(items.find(i=>i.type==='math')?.sourceOnly).toBe('此块预览复杂度超过预算，显示完整源码');expect(source).toContain('x_{59}');}
     if(path==='diagram.md')expect(items.find(i=>i.type==='mermaid')?.source).toContain('A[START_中文] --> B[END_完成]');
     if(path==='docs/links.md'){
      for(const href of ['同目录 中文 space.png','../assets/父目录 中文.png']){const image=await files.related('static',document.ref,href);expect(image.content?.kind).toBe('image');const received=await readFileResource(image,{chunk:(ref,offset,size,digest,id)=>files.chunk('static',ref,offset,size,digest,id)},new AbortController().signal);expect(hash(received)).toBe(hash(readFileSync(image.absolutePath)));files.closeDocument('static',image.ref);}
      await expect(files.related('static',document.ref,'../../outside.png')).rejects.toThrow();await expect(files.related('other',document.ref,'同目录 中文 space.png')).rejects.toThrow('UNTRUSTED');const target=await files.related('static',document.ref,'目标 中文.md#section');expect(target.relativePath).toBe('docs/目标 中文.md');files.closeDocument('static',target.ref);
     }
     observations.push({path,types:items.map(i=>i.type),sourceSha256:hash(bytes),sourceUnits:source.length,explicitFallback:items.find(i=>i.sourceOnly)?.sourceOnly??null});
    }else{expect(document.content).toMatchObject({kind:'image',mime:'image/svg+xml'});expect(new TextDecoder().decode(bytes)).toContain('<foreignObject');observations.push({path,kind:document.content,sourceSha256:hash(bytes),boundary:'Raw SVG stays an image resource or explicit source; browser image-context execution tested in App.'});}
    const after=statSync(absolute,{bigint:true});for(const field of ['ino','mtimeNs','ctimeNs'] as const)expect(after[field]).toBe(before[field]);expect(readFileSync(absolute)).toEqual(original);files.closeDocument('static',document.ref);
   }
   const controller=createFileController(files,()=>true),sender=Object.assign(new EventEmitter(),{id:92,mainFrame:{processId:2,routingId:3},isDestroyed:()=>false}),event={sender,senderFrame:sender.mainFrame} as unknown as IpcMainInvokeEvent;
   const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:controller},{handle:(name:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,handler)} as never);const openLink=(href:string)=>handlers.get('files.openWebLink')!(event,href);
   shell.openExternal.mockClear();await openLink('http://127.0.0.1:12345/explicit');expect(shell.openExternal).toHaveBeenCalledWith('http://127.0.0.1:12345/explicit');
   for(const url of ['file:///tmp/a','javascript:alert(1)','https://user:password@example.invalid/','http://example.invalid/\n'])await expect(openLink(url)).rejects.toThrow();expect(shell.openExternal).toHaveBeenCalledTimes(1);sender.emit('destroyed');
   observations.push({case:'M9-T-G08',externalOpenAcceptedOnce:true,unsafeOrCredentialUrlsRejected:4,scope:'OS shell seam mocked; real local browser request covered separately by packaged App.'});
  }finally{files.closeOwner('static');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
 });
});
