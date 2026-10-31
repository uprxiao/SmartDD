import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {readFileResource} from '../resource';
import {NotebookModel} from './model';
import {frameDocument} from './sanitize';

describe.skipIf(!process.env.SMARTDD_NOTEBOOK_MARKUP_SOURCE||!process.env.SMARTDD_FILES_NATIVE_PATH)('Y19 actual local file content and markup integration',()=>{
 it('preserves physical source, parses all output types and isolates active HTML without running the notebook',async()=>{
  const fixture=JSON.parse(readFileSync(process.env.SMARTDD_NOTEBOOK_MARKUP_SOURCE!,'utf8')) as {source:string;markdown:string;html:string};
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-notebook-markup-I-'))),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);
  const path=join(project,'markup.ipynb');writeFileSync(path,fixture.source);const before=statSync(path,{bigint:true});
  const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'markup',path:project,label:'Own markup root'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
  try{
   const root=(await files.openScope('markup',{kind:'project',projectId:'markup'})).roots[0];
   const document=await files.open('markup',{lease:root.lease,generation:root.generation,relativePath:'markup.ipynb'});
   expect(document.content?.kind).toBe('notebook');
   const bytes=await readFileResource(document,{chunk:(ref,offset,size,hash,id)=>files.chunk('markup',ref,offset,size,hash,id)},new AbortController().signal);
   expect(Buffer.from(bytes)).toEqual(Buffer.from(fixture.source));
   const model=new NotebookModel(bytes,'markup.ipynb'),view=model.window(0,10),md=view.cells[0].source.html!;
   for(const tag of ['h1','ol','ul','table','blockquote'])expect(md).toContain('<'+tag);
   expect(md).toContain('katex');expect(md).toContain('&lt;script&gt;');expect(md).not.toContain('<script>');
   expect(md).toMatch(/<input[^>]*disabled/);expect(md).toContain('data-md-src=');
   expect(view.cells[1].source.html).toContain('fw-code-token');expect(view.cells[1].source.html).toContain('&lt;literal&gt;');
   const json=view.cells[1].outputs[0];expect(json.type).toBe('json');expect(json.content?.html).toContain('fw-code-token');expect(model.chunk(json.content!.key).text).toContain('JSON_中文');
   const html=view.cells[2].outputs[0];expect(html.type).toBe('html');expect(html.content?.html).toContain('SAFE_HTML_MARKER');expect(html.content?.html).not.toMatch(/<script|onerror=|onload=|https?:/i);
   expect(model.chunk(html.content!.key).text).toBe(fixture.html);
   const frame=frameDocument(html.content!.html!,{});for(const policy of ["script-src 'none'","connect-src 'none'","frame-src 'none'","object-src 'none'","form-action 'none'"])expect(frame).toContain(policy);
   const [image,error]=view.cells[3].outputs;expect(image.type).toBe('image');const asset=model.asset(image.asset!);expect(asset.mime).toBe('image/png');expect(Buffer.from(asset.data,'base64').byteLength).toBeGreaterThan(20);expect(error.type).toBe('error');expect(model.chunk(error.content!.key).text).toContain('TRACE_MARKER');
   expect(readFileSync(path,'utf8')).toBe(fixture.source);const after=statSync(path,{bigint:true});for(const key of ['ino','size','mtimeNs','ctimeNs']as const)expect(after[key]).toBe(before[key]);
   if(process.env.SMARTDD_NOTEBOOK_MARKUP_EVIDENCE)writeFileSync(process.env.SMARTDD_NOTEBOOK_MARKUP_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'Actual FileService/roots/packaged native -> hash-checked chunks -> NotebookModel and frame sanitizer;Worker/DOM separately A',sourceHash:createHash('sha256').update(bytes).digest('hex'),cells:view.cells.map(c=>({type:c.type,outputs:c.outputs.map(o=>o.type)})),physicalSourceUnchanged:true},null,2)+'\n');
   files.closeDocument('markup',document.ref);
  }finally{files.closeOwner('markup');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
 });
});
