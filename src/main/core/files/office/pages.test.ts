import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipFile } from 'yazl';
import { FileError,type FileRef } from '@shared/files';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { OfficePagesParser } from './pages-parser';
import { FileOfficePagesService } from './pages-service';
import { FileHeavyJobs } from '../heavy-jobs';
import type { OfficeSource } from './service';
import { OPC_REL,OPC_TYPES,OFFICE_REL } from './relationships';
import { modernChartFixture } from './pptx-chart-fixtures';
import { OfficeXml,descendants } from './xml';
import { CHARTEX } from './preview-capabilities';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const path='docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx';
const ref=():FileRef=>({id:randomUUID(),lease:randomUUID(),generation:1});
async function docx(extra=''){
  const zip=new ZipFile();
  for(const [name,content] of Object.entries({
    '[Content_Types].xml':`<Types xmlns="${OPC_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="${OPC_REL}"><Relationship Id="r1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins><w:r><w:t>中文😀</w:t></w:r></w:ins></w:p></w:body></w:document>',
    ...(extra?{'customXml/item.xml':extra}:{}),
  }))zip.addBuffer(Buffer.from(content),name);zip.end();const chunks:Buffer[]=[];for await(const chunk of zip.outputStream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}
function patch(file:OfficePackage,name:string,transform:(xml:string)=>string){return file.patch(new Map([[name,Buffer.from(transform(file.read(name).toString()))]]),{changed:[name],added:[],removed:[]});}
describe('Office pages source model and bounded service',()=>{
  let directory:string,worker:string,pptx:Buffer,hash:string;
  beforeAll(()=>{
    directory=mkdtempSync(join(tmpdir(),'willyou-pages-'));worker=join(directory,'pages.cjs');
    const require=createRequire(import.meta.url),build=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    build.buildSync({entryPoints:[resolve('src/main/core/files/office/pages-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    pptx=readFileSync(path);hash=digest(pptx);
  });
  afterAll(()=>rmSync(directory,{recursive:true,force:true}));
  const source=(patch:Partial<OfficeSource>={}):OfficeSource=>({name:'synthetic.pptx',hash,size:pptx.length,signal:new AbortController().signal,assert(){},read:async(offset,length)=>pptx.subarray(offset,offset+length),...patch});
  const rendered=()=>{const bytes=Buffer.from('%PDF-synthetic');return {bytes,hash:digest(bytes),pages:2,elapsedMs:1,peakRssBytes:1,diagnostic:''};};
  const engine=()=>({render:vi.fn(async()=>rendered()),dispose:vi.fn()});
  it('reports only live modern chart references and does not expose arbitrary layout identifiers',async()=>{
    const modern=modernChartFixture(await OfficePackage.read(pptx),'funnel'),before=modern.hashes();
    expect(new OfficePagesModel(modern).info.unsupportedCharts).toEqual(['漏斗图']);
    const unknown=patch(modern,'ppt/charts/chart1.xml',xml=>xml.replace('layoutId="funnel"','layoutId="constructor"'));
    expect(new OfficePagesModel(unknown).info.unsupportedCharts).toEqual(['扩展图表']);
    const part='ppt/slides/slide1.xml',doc=new OfficeXml(modern.read(part)),frame=descendants(doc.root,'graphicFrame').find(node=>descendants(node,'chart',CHARTEX).length)!;
    const unreferenced=modern.patch(new Map([[part,doc.edit([{start:frame.start,end:frame.end,value:''}])]]),{changed:[part],added:[],removed:[]});
    expect(new OfficePagesModel(unreferenced).info.unsupportedCharts).toBeUndefined();
    expect(unreferenced.has('ppt/charts/chart1.xml')).toBe(true);expect(modern.hashes()).toEqual(before);
  });
  it('guards modern chart references in DOCX before native layout as well',async()=>{
    const base=await OfficePackage.read(await docx()),ppt=modernChartFixture(await OfficePackage.read(pptx),'waterfall');
    const parts=new Map<string,Uint8Array>([
      ['word/document.xml',Buffer.from(base.read('word/document.xml').toString().replace('</w:body>',`<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="${CHARTEX}"><cx:chart xmlns:cx="${CHARTEX}" xmlns:r="${OFFICE_REL}" r:id="rModern"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body>`))],
      ['word/_rels/document.xml.rels',Buffer.from(`<Relationships xmlns="${OPC_REL}"><Relationship Id="rModern" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="charts/chartEx1.xml"/></Relationships>`)],
      ['word/charts/chartEx1.xml',ppt.read('ppt/charts/chart1.xml')],
      ['word/charts/_rels/chartEx1.xml.rels',ppt.read('ppt/charts/_rels/chart1.xml.rels')],
      ['word/embeddings/chart-data.xlsx',ppt.read('ppt/embeddings/chart-data.xlsx')],
      ['[Content_Types].xml',Buffer.from(base.read('[Content_Types].xml').toString().replace('</Types>','<Override PartName="/word/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"/><Override PartName="/word/embeddings/chart-data.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>'))],
    ]);
    const file=base.patch(parts,{changed:[...parts.keys()].filter(name=>base.has(name)),added:[...parts.keys()].filter(name=>!base.has(name)),removed:[]}),candidate=await file.bytes(),before=digest(candidate),render=engine();
    const service=new FileOfficePagesService(()=>source({name:'chart.docx',hash:before,size:candidate.length,read:async(offset,length)=>candidate.subarray(offset,offset+length)}),render,worker,new FileHeavyJobs());
    try{await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:before})).rejects.toThrow('瀑布图');expect(render.render).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(0);}finally{service.dispose();}
  });
  it.each(['funnel','histogram','waterfall','treemap'] as const)('refuses the fixed renderer fallback for %s instead of returning a wrong line chart',async type=>{
    const candidate=await modernChartFixture(await OfficePackage.read(pptx),type).bytes(),before=digest(candidate),render=engine();
    const service=new FileOfficePagesService(()=>source({hash:before,size:candidate.length,read:async(offset,length)=>candidate.subarray(offset,offset+length)}),render,worker,new FileHeavyJobs());
    try{
      await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:before})).rejects.toThrow('图表预览');
      expect(render.render).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(0);expect(digest(candidate)).toBe(before);
    }finally{service.dispose();}
  });
  it('preserves actual slide order and notes, distinguishes hidden slides without dropping pages',async()=>{
    const file=await OfficePackage.read(pptx),before=file.hashes(),original=new OfficePagesModel(file).info;
    expect(original.kind).toBe('pptx');expect(original.slides).toHaveLength(2);expect(original.slides[0].notes).not.toBe('');
    const hidden=patch(file,'ppt/slides/slide1.xml',xml=>xml.replace('<p:sld ','<p:sld show="0" '));
    expect(new OfficePagesModel(hidden).info.slides.map(row=>row.hidden)).toEqual([true,false]);
    expect(new OfficePagesModel(hidden).info.slides.map(row=>row.id)).toEqual(original.slides.map(row=>row.id));
    expect(file.hashes()).toEqual(before);expect(original.width).toBeGreaterThan(0);
  });
  it('rejects duplicate identities and unrelated slide relationships',async()=>{
    const file=await OfficePackage.read(pptx),doc=file.read('ppt/presentation.xml').toString(),ids=[...doc.matchAll(/<p:sldId id="(\d+)"/g)].map(match=>match[1]);
    expect(ids).toHaveLength(2);
    expect(()=>new OfficePagesModel(patch(file,'ppt/presentation.xml',xml=>xml.replace(`id="${ids[1]}"`,`id="${ids[0]}"`)))).toThrow('身份');
    expect(()=>new OfficePagesModel(patch(file,'ppt/_rels/presentation.xml.rels',xml=>xml.replace(`${OFFICE_REL}/slide"`,`${OFFICE_REL}/notesSlide"`)))).toThrow('关系');
  });
  it('finds DOCX revisions and rejects an unused XML part containing DTD before rendering',async()=>{
    const bytes=await docx(),parser=new OfficePagesParser(worker);
    try {expect(await parser.inspect(bytes,digest(bytes),new AbortController().signal)).toMatchObject({kind:'docx',hasRevisions:true,slides:[]});}finally{parser.close();}
    await expect(OfficePackage.read(await docx('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>')).then(file=>new OfficePagesModel(file))).rejects.toThrow('DTD');
  });
  it('binds PDF chunks to owner and live source revision and releases resources',async()=>{
    let changed=false;const render=engine(),service=new FileOfficePagesService(()=>source({assert(){if(changed)throw new FileError('CHANGED','new disk revision');}}),render,worker,new FileHeavyJobs()),id=randomUUID();
    try {
      const output=await service.open('owner',{id,ref:ref(),baseHash:hash});expect(output.pages).toBe(2);expect(render.render).toHaveBeenCalledTimes(1);
      expect(service.chunk('owner',id,0,5)).toBe(Buffer.from('%PDF-').toString('base64'));
      expect(()=>service.chunk('other',id,0,5)).toThrow('不属于');expect(()=>service.chunk('owner',id,0,1024*1024+1)).toThrow('范围');
      changed=true;expect(()=>service.chunk('owner',id,0,5)).toThrow('disk');
      service.closeOwner('owner');expect(service.activeDocuments).toBe(0);
    } finally {service.dispose();}
  });
  it('never sends invalid OOXML or an extension mismatch into native rendering',async()=>{
    for(const input of [source({name:'synthetic.docx'}),source({read:async(offset,length)=>Buffer.alloc(length)})]){
      const render=engine(),service=new FileOfficePagesService(()=>input,render,worker,new FileHeavyJobs());
      try {await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:hash})).rejects.toThrow();expect(render.render).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(0);}finally{service.dispose();}
    }
  });
  it('cancels queued work before reads and rejects replay of a released request',async()=>{
    const jobs=new FileHeavyJobs();let finish!:()=>void;const holding=jobs.run(new AbortController().signal,()=>new Promise<void>(resolve=>{finish=resolve;}));await Promise.resolve();
    const read=vi.fn(source().read),render=engine(),service=new FileOfficePagesService(()=>source({read}),render,worker,jobs),id=randomUUID(),input={id,ref:ref(),baseHash:hash};
    try {const pending=service.open('owner',input);service.release('owner',id);await expect(pending).rejects.toThrow('取消');await expect(service.open('owner',input)).rejects.toThrow('取消');expect(read).not.toHaveBeenCalled();expect(render.render).not.toHaveBeenCalled();}finally{finish();await holding;service.dispose();}
  });
  it('rejects mismatched PDF page count instead of assigning notes to the wrong page',async()=>{
    const render=engine();render.render.mockResolvedValue({...rendered(),pages:1});const service=new FileOfficePagesService(()=>source(),render,worker,new FileHeavyJobs());
    try {await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:hash})).rejects.toThrow('页数');expect(service.activeDocuments).toBe(0);}finally{service.dispose();}
  });
  it('drops a late render completion after source revocation',async()=>{
    const abort=new AbortController();let entered!:()=>void,finish!:(value:ReturnType<typeof rendered>)=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
    const render={render:async()=>{entered();return new Promise<ReturnType<typeof rendered>>(resolve=>{finish=resolve;});},dispose(){}};
    const service=new FileOfficePagesService(()=>source({signal:abort.signal}),render,worker,new FileHeavyJobs()),id=randomUUID();
    try {const pending=service.open('owner',{id,ref:ref(),baseHash:hash});await ready;abort.abort();finish(rendered());await expect(pending).rejects.toThrow('取消');expect(service.activeDocuments).toBe(0);expect(()=>service.chunk('owner',id,0,5)).toThrow('不属于');}finally{service.dispose();}
  });
  it('rechecks disk revision after rendering even if no watcher event has arrived',async()=>{
    let changed=false;const render=engine();render.render.mockImplementation(async()=>{changed=true;return rendered();});
    const service=new FileOfficePagesService(()=>source({read:async(offset,length)=>{if(changed)throw new FileError('CHANGED','native revision changed');return pptx.subarray(offset,offset+length);}}),render,worker,new FileHeavyJobs());
    try {await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:hash})).rejects.toThrow('native revision');expect(service.activeDocuments).toBe(0);}finally{service.dispose();}
  });
});
