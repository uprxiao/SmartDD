import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FileError,type FileDocument,type FileSaveReceipt,type FileCheckpointInput } from '@shared/files';
import type { OfficeSource,OfficePersistence } from './service';
import { FilePptxService } from './pptx-service';
import { PptxParser } from './pptx-parser';
import { pptxPendingInputs } from '@shared/file-pptx';
import { encodePptxDraft,decodePptxDraft } from './pptx-draft';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { FileHeavyJobs } from '../heavy-jobs';
import { pptxTestImage } from './pptx-image-fixtures';
import { modernChartFixture } from './pptx-chart-fixtures';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const ref=()=>({id:randomUUID(),lease:randomUUID(),generation:1});
describe('PPTX retained Worker, persistence and candidate preview',()=>{
  let directory:string,worker:string,bytes:Buffer,base:string;
  beforeAll(()=>{
    directory=mkdtempSync(join(tmpdir(),'willyou-pptx-service-'));worker=join(directory,'pptx.cjs');
    const require=createRequire(import.meta.url),build=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    build.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    bytes=readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx');base=hash(bytes);
  });
  afterAll(()=>rmSync(directory,{recursive:true,force:true}));
  const source=(extra:Partial<OfficeSource>={}):OfficeSource=>({name:'fixture.pptx',hash:base,size:bytes.length,writable:true,signal:new AbortController().signal,assert(){},read:async(offset,length)=>bytes.subarray(offset,offset+length),...extra});
  function store(){
    let saved=bytes,checkpoint:FileCheckpointInput|undefined;
    const revision=(data:Uint8Array)=>({hash:hash(data),device:'1',inode:'2',size:data.length,modifiedNs:'1',changedNs:'1'});
    const api:OfficePersistence={
      checkpoint:vi.fn(async(_owner,input)=>{checkpoint=input;return {draftId:input.draftId,bufferVersion:input.bufferVersion,hash:hash(Buffer.from(input.base64,'base64'))};}),
      save:vi.fn(async(_owner,input)=>{saved=Buffer.from(input.base64,'base64');return {state:'saved' as const,opId:input.opId,bufferVersion:input.bufferVersion,revision:revision(saved)};}),
      resolveDraft:vi.fn(async()=>({resolved:true})),
      readDraft:vi.fn(async()=>({base64:checkpoint!.base64,baseHash:checkpoint!.baseHash,bufferVersion:checkpoint!.bufferVersion,encoding:'ooxml-draft',hash:hash(Buffer.from(checkpoint!.base64,'base64'))})),
      refresh:vi.fn(async()=>({ref:ref(),name:'fixture.pptx',relativePath:'fixture.pptx',absolutePath:'/synthetic/fixture.pptx',documentKey:'local:1:2',revision:revision(saved),writable:true}) as FileDocument),
    };return {api,saved:()=>saved,checkpoint:()=>checkpoint};
  }
  const renderer=()=>({render:vi.fn(async(_bytes:Uint8Array=Buffer.alloc(0))=>{const pdf=Buffer.from('%PDF-synthetic');return {bytes:pdf,hash:hash(pdf),pages:2,elapsedMs:1,peakRssBytes:1,diagnostic:''};})});
  it.each(['treemap','area'] as const)('resizes %s chart data through the real Worker and recovers the new model with unfinished count input',async chartType=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,renderer(),worker,new FileHeavyJobs()),id=randomUUID(),draftId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});let state=await service.edit('owner',{id,version:0,action:{type:'chart-insert',slideId:'256',chartType}});const elementId=state.info.slides[0].elements!.at(-1)!.id;
      for(const values of [[4],[1,8,2,7,3,6,4,5]]){state=await service.edit('owner',{id,version:state.version,action:{type:'chart-values',slideId:'256',elementId,values}});expect(state.info.slides[0].elements!.at(-1)!.chart?.values).toEqual(values);}
      const pending={slideId:'256',elementId,chartValues:true as const,text:'1,8,候选,'};await service.checkpoint('owner',{id,version:state.version,draftId,bufferVersion:10,pending});
      const second=randomUUID();await service.open('owner',{id:second,ref:ref(),baseHash:base});const restored=await service.restore('owner',{id:second,version:0,draftId});expect(pptxPendingInputs(restored.pending)).toEqual([pending]);expect(restored.state.info.slides[0].elements!.at(-1)!.chart?.values).toEqual([1,8,2,7,3,6,4,5]);service.close('owner',second);
      await service.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(new OfficePagesModel(await OfficePackage.read(storage.saved())).info.slides[0].elements!.at(-1)!.chart?.values).toEqual([1,8,2,7,3,6,4,5]);
      for(let index=0;index<3;index++)state=await service.history('owner',{id,version:state.version,direction:'undo'});await service.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(storage.saved())).hashes()).toEqual((await OfficePackage.read(bytes)).hashes());
    }finally{service.dispose();}
  });
  it('routes modern chart conversions through real workbook validation in the retained Worker',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,renderer(),worker,new FileHeavyJobs()),id=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});let state=await service.edit('owner',{id,version:0,action:{type:'chart-insert',slideId:'256',chartType:'funnel'}});const elementId=state.info.slides[0].elements!.at(-1)!.id;
      for(const chartType of ['scatter','treemap','line','funnel'] as const){state=await service.edit('owner',{id,version:state.version,action:{type:'chart-type',slideId:'256',elementId,chartType}});expect(state.info.slides[0].elements!.find(row=>row.id===elementId)!.chart).toMatchObject({type:chartType,values:[3,5,2],editableValues:true});}
      await service.save('owner',{id,version:state.version,draftId:randomUUID(),bufferVersion:state.version,opId:randomUUID()});expect(new OfficePagesModel(await OfficePackage.read(storage.saved())).info.slides[0].elements!.at(-1)!.chart?.type).toBe('funnel');
    }finally{service.dispose();}
  });
  it('keeps unsaved source history when modern projection is cancelled and does not save projection shapes',async()=>{
    const storage=store(),engine=renderer(),service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID(),requestId=randomUUID();
    let spy:ReturnType<typeof vi.spyOn>|undefined;
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});
      let state=await service.edit('owner',{id,version:0,action:{type:'chart-insert',slideId:'256',chartType:'funnel'}});
      const original=PptxParser.prototype.previewSource;
      spy=vi.spyOn(PptxParser.prototype,'previewSource').mockImplementation(function(this:PptxParser,version,signal){const pending=original.call(this,version,signal);service.cancelRender('owner',id,requestId);return pending;});
      await expect(service.render('owner',{id,version:state.version,requestId})).rejects.toMatchObject({code:'CANCELLED'});spy.mockRestore();spy=undefined;
      expect(engine.render).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(1);
      state=await service.edit('owner',{id,version:state.version,action:{type:'notes',slideId:'256',text:'retained after cancelling chart projection'}});
      const projection=await service.render('owner',{id,version:state.version,requestId:randomUUID()});
      await service.save('owner',{id,version:state.version,draftId:randomUUID(),bufferVersion:state.version,opId:randomUUID()});
      expect(projection.sourceHash).toBe(hash(storage.saved()));
      const file=await OfficePackage.read(storage.saved()),model=new OfficePagesModel(file);expect(model.info.slides[0].notes).toContain('retained after');expect(model.info.slides[0].elements!.at(-1)!.chart?.type).toBe('funnel');
      const nativeInput=engine.render.mock.calls[0][0] as Uint8Array;expect(hash(nativeInput)).not.toBe(hash(storage.saved()));
      expect(new OfficePagesModel(await OfficePackage.read(nativeInput)).info.unsupportedCharts).toBeUndefined();
    }finally{spy?.mockRestore();service.dispose();}
  });
  it('rejects misleading modern chart previews while retaining the document, edits and original chart data',async()=>{
    const original=modernChartFixture(await OfficePackage.read(bytes),'funnel'),candidate=await original.bytes(),inputHash=hash(candidate),storage=store(),engine=renderer(),id=randomUUID();
    const service=new FilePptxService(()=>source({hash:inputHash,size:candidate.length,read:async(offset,length)=>candidate.subarray(offset,offset+length)}),storage.api,engine,worker,new FileHeavyJobs());
    try{
      await service.open('owner',{id,ref:ref(),baseHash:inputHash});
      await expect(service.render('owner',{id,version:0,requestId:randomUUID()})).rejects.toThrow('图表预览');
      expect(engine.render).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(1);
      const state=await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'retained after refused chart preview'}});expect(state.dirty).toBe(true);
      await service.save('owner',{id,version:state.version,draftId:randomUUID(),bufferVersion:state.version,opId:randomUUID()});
      const saved=await OfficePackage.read(storage.saved());expect(new OfficePagesModel(saved).info.slides[0].notes).toBe('retained after refused chart preview');
      for(const part of original.names())if(part.includes('/charts/')||part.includes('/embeddings/'))expect(saved.read(part),part).toEqual(original.read(part));
    }finally{service.dispose();}
  });
  const vector=()=>{const bytes=Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 405"><g class="com.sun.star.drawing.TableShape">'+Array.from({length:6},(_,i)=>{const x=10+i%2*100,y=10+Math.floor(i/2)*30;return `<path fill="rgb(1,0,${i+1})" d="M ${x},${y} L ${x+100},${y} ${x+100},${y+30} ${x},${y+30} ${x},${y} Z "/>`;}).join('')+'</g></svg>');return {bytes,hash:hash(bytes),elapsedMs:2,peakRssBytes:1,diagnostic:''};};
  it('decodes original image bytes before mutation, then saves and reopens the independent image part',async()=>{
    const storage=store(),image=pptxTestImage(),decode=vi.fn(async()=>({width:120,height:80})),service=new FilePptxService(()=>source(),storage.api,undefined,worker,new FileHeavyJobs(),decode),id=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const action={type:'image-insert' as const,slideId:'256',image:image.image};
      await expect(service.edit('other',{id,version:0,action})).rejects.toMatchObject({code:'CANCELLED'});expect(decode).not.toHaveBeenCalled();
      decode.mockRejectedValueOnce(new FileError('INVALID_INPUT','invalid image'));
      await expect(service.edit('owner',{id,version:0,action})).rejects.toThrow('invalid image');expect(storage.api.save).not.toHaveBeenCalled();
      const state=await service.edit('owner',{id,version:0,action});expect(state.info.slides[0].elements!.at(-1)!.kind).toBe('image');
      await expect(service.edit('owner',{id,version:0,action})).rejects.toMatchObject({code:'CHANGED'});expect(decode).toHaveBeenCalledTimes(2);
      await service.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});const file=await OfficePackage.read(storage.saved());expect(file.read('ppt/media/willyou-image-1.png')).toEqual(image.bytes);
    }finally{service.dispose();}
  });
  it('does not apply late image decoding after the owning document is closed',async()=>{
    let finish!:(value:{width:number;height:number})=>void;const decode=vi.fn(()=>new Promise<{width:number;height:number}>(resolve=>{finish=resolve;})),storage=store(),service=new FilePptxService(()=>source(),storage.api,undefined,worker,new FileHeavyJobs(),decode),id=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const editing=service.edit('owner',{id,version:0,action:{type:'image-insert',slideId:'256',image:pptxTestImage().image}});const rejection=expect(editing).rejects.toMatchObject({code:'CANCELLED'});
      await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());service.close('owner',id);finish({width:120,height:80});await rejection;expect(storage.api.save).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(0);
    }finally{service.dispose();}
  });
  it.each(['source','decode'] as const)('preserves the dirty Worker when a preview is cancelled during table %s processing',async phase=>{
    const storage=store(),engine={...renderer(),renderTableLayout:vi.fn(async()=>vector())},service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID(),requestId=randomUUID();
    const originalSource=PptxParser.prototype.tableLayoutSource,originalDecode=PptxParser.prototype.tableLayout;
    const spy=phase==='source'?vi.spyOn(PptxParser.prototype,'tableLayoutSource').mockImplementation(function(this:PptxParser,version,signal){const result=originalSource.call(this,version,signal);service.cancelRender('owner',id,requestId);return result;}):vi.spyOn(PptxParser.prototype,'tableLayout').mockImplementation(function(this:PptxParser,version,bytes,signal){const result=originalDecode.call(this,version,bytes,signal);service.cancelRender('owner',id,requestId);return result;});
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'unsaved notes'}});
      await expect(service.render('owner',{id,version:1,requestId})).rejects.toMatchObject({code:'CANCELLED'});spy.mockRestore();expect(service.activeDocuments).toBe(1);
      const state=await service.edit('owner',{id,version:1,action:{type:'notes',slideId:'256',text:'still alive'}});expect(state.dirty).toBe(true);
      await service.save('owner',{id,version:2,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()});expect(new OfficePagesModel(await OfficePackage.read(storage.saved())).info.slides[0].notes).toBe('still alive');
    }finally{spy.mockRestore();service.dispose();}
  });
  it('returns only decoded table geometry while private marker data stays out of history and persistence',async()=>{
    const storage=store(),engine={...renderer(),renderTableLayout:vi.fn(async(candidate:Uint8Array)=>{const file=await OfficePackage.read(candidate),model=new OfficePagesModel(file);expect(model.info.slides[0].elements!.find(element=>element.table)!.table!.heights).toEqual([0,0,0]);expect(file.hashes()['ppt/slides/slide2.xml']).toBe((await OfficePackage.read(bytes)).hashes()['ppt/slides/slide2.xml']);return vector();})},service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const result=await service.render('owner',{id,version:0,requestId:randomUUID()});
      expect(result.tableLayout).toHaveLength(1);expect(result.tableLayout![0].cells).toHaveLength(6);expect(result.tableLayout![0].cells[0].points[0]).toEqual([10,10]);expect(result.tableLayoutError).toBeUndefined();
      expect(engine.renderTableLayout).toHaveBeenCalledOnce();const state=await service.history('owner',{id,version:0,direction:'undo'});expect(state).toMatchObject({version:0,dirty:false,canUndo:false});expect(storage.api.save).not.toHaveBeenCalled();expect(storage.saved()).toEqual(bytes);
    }finally{service.dispose();}
  });
  it('rejects table geometry produced for an older edit version and permits a new preview',async()=>{
    let complete!:(value:ReturnType<typeof vector>)=>void;const storage=store(),engine={...renderer(),renderTableLayout:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockImplementation(async()=>vector())},service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID(),requestId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const preview=service.render('owner',{id,version:0,requestId});await vi.waitFor(()=>expect(engine.renderTableLayout).toHaveBeenCalledOnce());
      await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'new revision'}});complete(vector());await expect(preview).rejects.toMatchObject({code:'CANCELLED'});expect(()=>service.chunk('owner',id,requestId,0,5)).toThrow('过期');
      expect((await service.render('owner',{id,version:1,requestId:randomUUID()})).tableLayout![0].cells).toHaveLength(6);
    }finally{service.dispose();}
  });
  it('retains a usable PDF with an explicit unsupported-table warning, while trust failures reject the preview',async()=>{
    const storage=store(),engine={...renderer(),renderTableLayout:vi.fn(async()=>{throw new FileError('UNSUPPORTED','unrecognized cell layout');})},service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID(),requestId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const result=await service.render('owner',{id,version:0,requestId});expect(result.tableLayout).toBeUndefined();expect(result.tableLayoutError).toContain('unrecognized');expect(service.chunk('owner',id,requestId,0,5)).toBe(Buffer.from('%PDF-').toString('base64'));
      engine.renderTableLayout.mockRejectedValueOnce(new FileError('UNTRUSTED','runtime changed'));await expect(service.render('owner',{id,version:0,requestId:randomUUID()})).rejects.toThrow('runtime changed');expect(storage.api.save).not.toHaveBeenCalled();
    }finally{service.dispose();}
  });
  it('keeps mutation ownership, model versions and durable save receipts separate',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,renderer(),worker,new FileHeavyJobs()),id=randomUUID(),draftId=randomUUID();
    try{
      const opened=await service.open('owner',{id,ref:ref(),baseHash:base});expect(opened.state.info.slides).toHaveLength(2);
      await expect(service.edit('foreign',{id,version:0,action:{type:'notes',slideId:'256',text:'forged'}})).rejects.toThrow('不属于');
      await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'saved😀'}});
      await expect(service.edit('owner',{id,version:0,action:{type:'hidden',slideId:'256',hidden:true}})).rejects.toThrow('版本');
      const result=await service.save('owner',{id,version:1,draftId,bufferVersion:3,opId:randomUUID()});
      expect(result.state.dirty).toBe(false);expect(result.receipt.state).toBe('saved');
      expect(new OfficePagesModel(await OfficePackage.read(storage.saved())).info.slides[0].notes).toBe('saved😀');
      expect(storage.api.resolveDraft).toHaveBeenCalledWith('owner',expect.objectContaining({hash:result.checkpoint.hash,savedHash:hash(storage.saved()),action:'saved'}));
      expect((await service.history('owner',{id,version:1,direction:'undo'})).dirty).toBe(true);
      expect((await service.history('owner',{id,version:2,direction:'redo'})).dirty).toBe(false);
    }finally{service.dispose();}
  });
  it('preserves raw pending notes through a source disconnect and restores them into another instance',async()=>{
    const storage=store(),abort=new AbortController(),lifetime=new AbortController();let gone=false;
    const service=new FilePptxService(()=>source({signal:abort.signal,lifetime:lifetime.signal,assert(){if(gone)throw new FileError('CHANGED','disk disconnected');}}),storage.api,undefined,worker,new FileHeavyJobs()),id=randomUUID(),draftId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});await service.edit('owner',{id,version:0,action:{type:'hidden',slideId:'256',hidden:true}});
      abort.abort();gone=true;
      await service.checkpoint('owner',{id,version:1,draftId,bufferVersion:2,pending:{slideId:'256',text:'未提交\ud800'}});
      const decoded=decodePptxDraft(Buffer.from(storage.checkpoint()!.base64,'base64'));expect(pptxPendingInputs(decoded.pending)[0]?.text).toBe('未提交\ud800');
      await expect(service.save('owner',{id,version:1,draftId,bufferVersion:3,opId:randomUUID()})).rejects.toThrow('disconnected');
      expect(storage.api.save).not.toHaveBeenCalled();expect(service.activeDocuments).toBe(1);
      // Keep the raw envelope as it would have been at the interrupted input.
      await service.checkpoint('owner',{id,version:1,draftId,bufferVersion:4,pending:{slideId:'256',text:'候选😀'}});
      gone=false;const second=randomUUID();const independent=new FilePptxService(()=>source(),storage.api,undefined,worker,new FileHeavyJobs());
      try{await independent.open('owner',{id:second,ref:ref(),baseHash:base});const restored=await independent.restore('owner',{id:second,version:0,draftId});expect(pptxPendingInputs(restored.pending)[0]?.text).toBe('候选😀');expect(restored.state.info.slides[0].hidden).toBe(true);expect(restored.state.dirty).toBe(true);}
      finally{independent.dispose();}
      lifetime.abort();expect(service.activeDocuments).toBe(0);
    }finally{service.dispose();}
  });
  it('retains dirty content and recovery when persistence conflicts or returns a mismatched hash',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,undefined,worker,new FileHeavyJobs()),id=randomUUID(),draftId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'local'}});
      vi.mocked(storage.api.save).mockImplementationOnce(async(_o,input)=>({state:'conflict',opId:input.opId,bufferVersion:input.bufferVersion,message:'changed'}));
      const result=await service.save('owner',{id,version:1,draftId,bufferVersion:1,opId:randomUUID()});expect(result.state.dirty).toBe(true);expect(storage.api.resolveDraft).not.toHaveBeenCalled();
      vi.mocked(storage.api.save).mockImplementationOnce(async(_o,input)=>({state:'saved',opId:input.opId,bufferVersion:input.bufferVersion,revision:{hash:'0'.repeat(64)}} as FileSaveReceipt));
      await expect(service.save('owner',{id,version:1,draftId,bufferVersion:2,opId:randomUUID()})).rejects.toThrow('回执');expect(storage.api.resolveDraft).not.toHaveBeenCalled();
      const valid=await service.save('owner',{id,version:1,draftId,bufferVersion:3,opId:randomUUID()});expect(valid.state.dirty).toBe(false);
    }finally{service.dispose();}
  });
  it('cancels preview without closing the edited model and rejects late or foreign chunks',async()=>{
    const storage=store(),engine=renderer(),service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const requestId=randomUUID(),result=await service.render('owner',{id,version:0,requestId});
      expect(result.version).toBe(0);expect(service.chunk('owner',id,requestId,0,5)).toBe(Buffer.from('%PDF-').toString('base64'));
      expect(()=>service.chunk('foreign',id,requestId,0,5)).toThrow('不属于');expect(()=>service.chunk('owner',id,requestId,0,1024*1024+1)).toThrow('范围');
      service.cancelRender('owner',id,requestId);expect(service.activeDocuments).toBe(1);expect(()=>service.chunk('owner',id,requestId,0,5)).toThrow('过期');
      await expect(service.render('owner',{id,version:0,requestId})).rejects.toThrow('取消');
      expect((await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'still editable'}})).dirty).toBe(true);
    }finally{service.dispose();}
  });
  it('does not block edits behind slow layout or publish the superseded render',async()=>{
    const storage=store(),engine=renderer();let started!:()=>void,finish!:(value:Awaited<ReturnType<typeof engine.render>>)=>void;const entered=new Promise<void>(r=>{started=r;});
    engine.render.mockImplementationOnce(async()=>{started();return new Promise(r=>{finish=r;});});
    const service=new FilePptxService(()=>source(),storage.api,engine,worker,new FileHeavyJobs()),id=randomUUID(),requestId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const pending=service.render('owner',{id,version:0,requestId});await entered;
      expect((await service.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'newer'}})).version).toBe(1);
      finish(await renderer().render());await expect(pending).rejects.toThrow('取消');
      expect(()=>service.chunk('owner',id,requestId,0,5)).toThrow('过期');
      expect((await service.render('owner',{id,version:1,requestId:randomUUID()})).info.slides[0].notes).toBe('newer');
    }finally{service.dispose();}
  });
  it('honours queued cancellation, read-only access and disposed lifetime',async()=>{
    const storage=store(),jobs=new FileHeavyJobs();let finish!:()=>void;
    const holding=jobs.run(new AbortController().signal,()=>new Promise<void>(r=>{finish=r;}));await Promise.resolve();const read=vi.fn(source().read);
    const service=new FilePptxService(()=>source({read}),storage.api,undefined,worker,jobs),id=randomUUID();
    try{const pending=service.open('owner',{id,ref:ref(),baseHash:base});service.close('owner',id);await expect(pending).rejects.toThrow('取消');expect(read).not.toHaveBeenCalled();}
    finally{finish();await holding;service.dispose();}
    await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:base})).rejects.toThrow('取消');
    const readonly=new FilePptxService(()=>source({writable:false}),storage.api,undefined,worker);
    try{await readonly.open('owner',{id,ref:ref(),baseHash:base});await expect(readonly.edit('owner',{id,version:0,action:{type:'hidden',slideId:'256',hidden:true}})).rejects.toThrow('只读');}
    finally{readonly.dispose();}
  });
  it('rejects damaged or wrong-format recovery envelopes',()=>{
    const valid=encodePptxDraft(bytes,{slideId:'256',text:'原始😀'});
    expect(decodePptxDraft(valid).bytes.equals(bytes)).toBe(true);
    for(const bad of [bytes,valid.subarray(0,-1),Buffer.concat([valid,Buffer.from('x')])])expect(()=>decodePptxDraft(bad)).toThrow();
  });
  it('checkpoints object and notes input together and restores their target identity in a fresh Worker',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,undefined,worker),id=randomUUID(),draftId=randomUUID();
    const pending=[{slideId:'256',text:'恢复备注'},{slideId:'256',elementId:'2',text:'对象候选\ud800'}];
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});await service.checkpoint('owner',{id,version:0,draftId,bufferVersion:2,pending});
      expect(pptxPendingInputs(decodePptxDraft(Buffer.from(storage.checkpoint()!.base64,'base64')).pending)).toEqual(pending);expect(storage.api.save).not.toHaveBeenCalled();
      service.close('owner',id);const second=randomUUID();await service.open('owner',{id:second,ref:ref(),baseHash:base});
      const restored=await service.restore('owner',{id:second,version:0,draftId});expect(pptxPendingInputs(restored.pending)).toEqual(pending);
      const slide=restored.state.info.slides[0];expect(slide.notes).not.toBe(pending[0].text);expect(slide.elements?.find(element=>element.id==='2')?.text).not.toBe(pending[1].text);
    }finally{service.dispose();}
  });
  it('writes source appearance through the retained Worker, then saves and independently reopens its model',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,renderer(),worker,new FileHeavyJobs()),id=randomUUID(),draftId=randomUUID();
    try{
      await service.open('owner',{id,ref:ref(),baseHash:base});const inserted=await service.edit('owner',{id,version:0,action:{type:'insert-element',slideId:'256',kind:'shape'}}),elementId=inserted.info.slides[0].elements!.at(-1)!.id;
      await service.edit('owner',{id,version:1,action:{type:'element-appearance',slideId:'256',elementId,patch:{fill:'#102030',border:true,borderStyle:'dotted',shadow:true,shape:'circle'}}});
      await service.save('owner',{id,version:2,draftId,bufferVersion:3,opId:randomUUID()});const saved=await OfficePackage.read(storage.saved()),shape=new OfficePagesModel(saved).info.slides[0].elements!.find(row=>row.id===elementId)!;
      expect(shape).toMatchObject({preset:'ellipse',appearance:{fill:'#102030',border:true,borderStyle:'dotted',shadow:true}});
      for(const [part,value] of Object.entries((await OfficePackage.read(bytes)).hashes()))if(part!=='ppt/slides/slide1.xml')expect(saved.hashes()[part],part).toBe(value);
      expect((await service.history('owner',{id,version:2,direction:'undo'})).info.slides[0].elements!.find(row=>row.id===elementId)!.preset).toBe('rect');
    }finally{service.dispose();}
  });
  it('formats actual rich text in the Worker and saves the candidate without touching its content',async()=>{
    const storage=store(),service=new FilePptxService(()=>source(),storage.api,undefined,worker),id=randomUUID();
    try{
      const opened=await service.open('owner',{id,ref:ref(),baseHash:base}),element=opened.state.info.slides[0].elements!.find(element=>element.text==='MASTER_TITLE')!;
      const state=await service.edit('owner',{id,version:0,action:{type:'element-format',slideId:'256',elementId:element.id,patch:{font:{points:26,bold:true,family:'Arial'},align:'center'}}});
      expect(state.info.slides[0].elements!.find(item=>item.id===element.id)).toMatchObject({text:'MASTER_TITLE',textStyle:{points:26,bold:true,family:'Arial',align:'center'}});
      await service.save('owner',{id,version:state.version,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});
      expect(new OfficePagesModel(await OfficePackage.read(storage.saved())).info.slides[0].elements!.find(item=>item.id===element.id)?.textStyle).toMatchObject({points:26,bold:true,align:'center'});
    }finally{service.dispose();}
  });
  it('releases a crashed Worker slot, while an ordinary rejected edit retains the session',async()=>{
    const storage=store(),crashedWorker=join(directory,'crashed.cjs');
    writeFileSync(crashedWorker,"const {parentPort}=require('node:worker_threads');parentPort.on('message',m=>{if(m.method==='open')parentPort.postMessage({id:m.id,result:{version:0,dirty:false,protected:false,info:{kind:'pptx',signed:false,slides:[]}}});else process.exit(7);});");
    const broken=new FilePptxService(()=>source(),storage.api,undefined,crashedWorker),id=randomUUID();
    try{await broken.open('owner',{id,ref:ref(),baseHash:base});await expect(broken.edit('owner',{id,version:0,action:{type:'hidden',slideId:'256',hidden:true}})).rejects.toThrow('退出');expect(broken.activeDocuments).toBe(0);}
    finally{broken.dispose();}
    const live=new FilePptxService(()=>source(),storage.api,undefined,worker);
    try{await live.open('owner',{id,ref:ref(),baseHash:base});await expect(live.edit('owner',{id,version:0,action:{type:'hidden',slideId:'999',hidden:true}})).rejects.toThrow('不存在');expect(live.activeDocuments).toBe(1);expect((await live.edit('owner',{id,version:0,action:{type:'hidden',slideId:'256',hidden:true}})).version).toBe(1);}
    finally{live.dispose();}
  });
});
