import {afterAll,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {readFileResource} from '../resource';
import {NotebookModel} from './model';
import {frameDocument} from './sanitize';

const rows:Record<string,unknown>[]=[];
afterAll(()=>{if(process.env.SMARTDD_NOTEBOOK_EVIDENCE)writeFileSync(process.env.SMARTDD_NOTEBOOK_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'Production FileService/packaged native broker -> revision/hash checked chunk reader -> NotebookModel. Worker/DOM tested separately in packaged App.',rows},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_NOTEBOOK_FIXTURES||!process.env.SMARTDD_FILES_NATIVE_PATH)('Notebook real-file content integration',()=>{
 it('G01/G02/G03/G04/G05/G07 preserves actual bytes through classification, chunks and notebook output/sanitization',async()=>{
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-nb-native-'))),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);
  const generated=JSON.parse(readFileSync(process.env.SMARTDD_NOTEBOOK_FIXTURES!,'utf8')) as {fixtures:Record<string,string>;mimeKeys:string[]};
  for(const[name,source]of Object.entries(generated.fixtures))writeFileSync(join(project,name),source);
  const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'nb',path:project,label:'Notebook fixtures'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
  try{
   const root=(await files.openScope('nb',{kind:'project',projectId:'nb'})).roots[0];
   for(const[name,source]of Object.entries(generated.fixtures)){
    const path=join(project,name),before=statSync(path,{bigint:true}),document=await files.open('nb',{lease:root.lease,generation:root.generation,relativePath:name});
    expect(document.content?.kind).toBe('notebook');
    const bytes=await readFileResource(document,{chunk:(ref,offset,size,hash,id)=>files.chunk('nb',ref,offset,size,hash,id)},new AbortController().signal);expect(Buffer.from(bytes)).toEqual(Buffer.from(source));
    if(name==='bad-json.ipynb'||name==='bad-schema.ipynb'){
     expect(()=>new NotebookModel(bytes,name)).toThrow(name==='bad-json.ipynb'?'JSON 解析':'结构无效');rows.push({name,rejected:true});
    }else{
     const model=new NotebookModel(bytes,name),window=model.window(0,30),cell=window.cells[0];
     if(name.startsWith('cell-')){const kind=name==='cell-future.ipynb'?'raw':name.slice(5,-6);expect(cell.type).toBe(kind);expect(model.chunk('0/source').text).toBe((JSON.parse(source).cells[0]).source);}
     if(name.startsWith('empty-'))expect(name==='empty-notebook.ipynb'?window.cells.length:cell.source.total).toBe(0);
     if(name==='stream-error.ipynb'){expect(cell.outputs).toHaveLength(3);expect(cell.outputs.map(o=>o.type)).toEqual(['stream','stream','error']);expect(model.chunk('0/0/text').text).toBe('STDOUT_中文🙂\nline2');expect(model.chunk('0/1/text').text).toBe('STDERR_中文🙂');expect(model.chunk('0/2/text').text).toBe('ValueError: ERROR_中文🙂\nTRACE_LINE_1\nTRACE_LINE_2');expect(cell.outputs[2].summary?.html).toContain('ERROR_SUMMARY');}
     if(/^mime-\d/.test(name)){const index=Number(name[5]),mime=generated.mimeKeys[index],expected=['image','image','image','html','markdown','text','json','json'][index];expect(cell.outputs.map(o=>o.type)).toEqual([expected,expected]);if(index<3)for(const output of cell.outputs)expect(model.asset(output.asset!).mime).toBe(mime);if(index>=6)for(const output of cell.outputs){const text=model.chunk(output.content!.key).text;expect(()=>JSON.parse(text)).not.toThrow();expect(text).toContain('\n  ');}}
     if(name==='mime-empty-html.ipynb')expect(cell.outputs[0].type).toBe('markdown');if(name==='mime-empty-markdown.ipynb')expect(cell.outputs[0].type).toBe('text');
     if(name==='unknown-output.ipynb'){expect(cell.outputTotal).toBe(0);expect(cell.source.text).toContain('VALID_SOURCE_REMAINS');}
     if(name==='html-sandbox.ipynb'){const output=cell.outputs[0],safe=output.content!.html!;expect(safe).toContain('SAFE_HTML_');expect(safe).not.toMatch(/<script|<iframe|<form|onerror=|onload=|<foreignObject|https?:/i);const frame=frameDocument(safe,{});for(const policy of ["script-src 'none'","connect-src 'none'","frame-src 'none'","object-src 'none'","form-action 'none'"])expect(frame).toContain(policy);expect(model.chunk(output.content!.key).text).toContain('<script>');}
     rows.push({name,cells:window.cells.map(c=>({type:c.type,title:c.title,source:c.source.text,outputs:c.outputs.map(o=>({type:o.type,mime:o.mime,title:o.title,text:o.content?.text}))}))});
    }
    const after=statSync(path,{bigint:true});expect(readFileSync(path,'utf8')).toBe(source);for(const field of ['ino','size','mtimeNs','ctimeNs'] as const)expect(after[field]).toBe(before[field]);files.closeDocument('nb',document.ref);
   }
  }finally{files.closeOwner('nb');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
 });
});
describe('Notebook read-only worker protocol',()=>{
 it('G06 rejects run/execute/evaluate requests and keeps code as source text',async()=>{
  let listener!:(event:MessageEvent)=>void;const replies:{id:number;result?:unknown;error?:string}[]=[];
  vi.stubGlobal('addEventListener',(_name:string,fn:(event:MessageEvent)=>void)=>{listener=fn;});vi.stubGlobal('postMessage',(reply:{id:number;result?:unknown;error?:string})=>replies.push(reply));
  const marker='__willyouNotebookMustNotExecute',source=`globalThis.${marker} = true;`;
  try{
   await import('./worker');
   const send=(method:string,args:unknown[])=>{listener({data:{id:replies.length+1,method,args}} as MessageEvent);return replies.at(-1)!;};
   const bytes=new TextEncoder().encode(JSON.stringify({metadata:{},cells:[{cell_type:'code',source,outputs:[]}]}));
   expect(send('open',[bytes.buffer,'no-run.ipynb']).error).toBeUndefined();expect(send('window',[0,1,{}]).error).toBeUndefined();
   for(const method of ['run','execute','evaluate','kernel'])expect(send(method,[source]).error).toBe('未知 Notebook 请求');
   expect(send('chunk',['0/source',0]).result).toMatchObject({text:source});expect(Reflect.get(globalThis,marker)).toBeUndefined();
   rows.push({case:'M9-T-G06',scope:'Actual production worker request handler + NotebookModel in-process; synthetic message transport. Real dedicated Worker separately covered by App.',rejectedMethods:['run','execute','evaluate','kernel'],executionCanaryAbsent:true,sourceUnchanged:true});
  }finally{vi.unstubAllGlobals();}
 });
});
