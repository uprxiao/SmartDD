import {afterAll,describe,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {readFileResource} from '../resource';
import {NotebookModel} from './model';
const observations:Record<string,unknown>[]=[];
afterAll(()=>{if(process.env.SMARTDD_NOTEBOOK_DETAIL_EVIDENCE)writeFileSync(process.env.SMARTDD_NOTEBOOK_DETAIL_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'Real native/FileService revision-checked bytes -> production NotebookModel; no Clipboard API, no Worker transport/DOM claim.',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_NOTEBOOK_DETAIL_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('Notebook detail real-file integration',()=>{
 it('T33/T35 checks full-source emptiness/collapse and output data; T34 data-only chunk integrity',async()=>{
  const project=process.env.SMARTDD_NOTEBOOK_DETAIL_PROJECT!,generated=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {fixtures:Record<string,string>;matrix:{name:string;source:string;inner:boolean;empty:boolean;output:boolean}[];longCode:string;longRaw:string;html:string};
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-notebook-detail-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'nb-details',path:project,label:'Notebook detail fixtures'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
  try{
   const root=(await files.openScope('details',{kind:'project',projectId:'nb-details'})).roots[0];
   for(const[name,source]of Object.entries(generated.fixtures)){
    const path=join(project,name),before=statSync(path,{bigint:true}),document=await files.open('details',{lease:root.lease,generation:root.generation,relativePath:name}),bytes=await readFileResource(document,{chunk:(ref,offset,size,hash,id)=>files.chunk('details',ref,offset,size,hash,id)},new AbortController().signal);expect(Buffer.from(bytes)).toEqual(Buffer.from(source));const model=new NotebookModel(bytes,name),cell=model.window(0,1).cells[0],item=generated.matrix.find(i=>i.name===name);
    if(item){expect(cell.sourceEmpty).toBe(item.empty);expect(cell.sourceCollapsed).toBe(item.inner);expect(cell.outputTotal>0).toBe(item.output);expect(model.chunk('0/source').text).toBe(item.source);observations.push({case:'M9-T-T33',name,sourceEmpty:cell.sourceEmpty,sourceCollapsed:cell.sourceCollapsed,outputs:cell.outputTotal});}
    else if(name.startsWith('copy-')){
     const expected=name==='copy-code.ipynb'?generated.longCode:generated.longRaw,parts:string[]=[];let offset=0;while(offset<expected.length){const part=model.chunk('0/source',offset);parts.push(part.text);expect(part.end).toBeGreaterThan(offset);offset=part.end;}expect(parts.join('')).toBe(expected);observations.push({case:'M9-T-T34',name,scope:'data-only source retrieval; no system clipboard access, P/A copy still not executed',characters:expected.length,sha256:createHash('sha256').update(expected).digest('hex'),chunks:parts.length});
    }else{
     expect(cell.outputs.map(o=>o.type)).toEqual(['image','html','stream','error','json','json']);expect(cell.outputs.filter(o=>o.summary)).toHaveLength(3);expect(model.asset(cell.outputs[0].asset!).data).toContain('height="1800"');expect(model.chunk(cell.outputs[1].content!.key).text).toBe(generated.html);for(const output of cell.outputs.slice(2))expect(model.chunk(output.content!.key).text.length).toBeGreaterThan(0);observations.push({case:'M9-T-T35',name,types:cell.outputs.map(o=>o.type),summaries:3,rawKeys:cell.outputs.flatMap(o=>o.content?[o.content.key]:[])});
    }
    const after=statSync(path,{bigint:true});for(const key of ['ino','mtimeNs','ctimeNs'] as const)expect(after[key]).toBe(before[key]);expect(readFileSync(path,'utf8')).toBe(source);files.closeDocument('details',document.ref);
   }
  }finally{files.closeOwner('details');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
 });
});
