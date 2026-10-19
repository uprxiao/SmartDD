import { beforeEach,describe,it,expect,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { LibreOfficeEngine } from './libreoffice-engine';
import { FileHeavyJobs } from '../heavy-jobs';
import type { NativeFileBroker } from '../native-broker';

const mocks=vi.hoisted(()=>({resources:vi.fn(),create:vi.fn(),clean:vi.fn()}));
vi.mock('./libreoffice-resources',()=>({libreOfficeResources:mocks.resources}));
vi.mock('../engine-workspaces',()=>({FileEngineWorkspaces:class {create=mocks.create;clean=mocks.clean;}}));
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const pdf=Buffer.from('%PDF-1.7\nsynthetic protocol fixture');
const receipt=()=>({state:'ready',base64:pdf.toString('base64'),hash:digest(pdf),bytes:pdf.length,pages:1,elapsedMs:100,peakRssBytes:1024,diagnostic:''});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
describe('LibreOffice engine ownership, cancellation and receipt boundary',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.resources.mockResolvedValue({runtime:{path:'/fixed'},files:[],links:[]});mocks.create.mockResolvedValue({path:'/private/job',identity:{device:'1',inode:'2'}});mocks.clean.mockResolvedValue(undefined);});
  const instance=(request=vi.fn().mockResolvedValue(receipt()),queue=new FileHeavyJobs())=>({engine:new LibreOfficeEngine({request} as unknown as NativeFileBroker,{directory:'/fixed',userData:'/isolated'},queue),request});
  it('owns the queued input snapshot and releases the job after verified PDF output',async()=>{
    const gate=deferred<void>(),queue=new FileHeavyJobs(),block=queue.run(new AbortController().signal,()=>gate.promise);
    const {engine,request}=instance(undefined,queue),bytes=Buffer.from('original candidate'),operation=engine.render(bytes,'docx',new AbortController().signal);bytes.fill(0);gate.resolve();await block;
    const result=await operation;expect(result.bytes).toEqual(pdf);expect(request.mock.calls[0][0]).toMatchObject({format:'docx',base64:Buffer.from('original candidate').toString('base64'),hash:digest(Buffer.from('original candidate'))});expect(mocks.clean).toHaveBeenCalledOnce();
  });
  it.each([
    {hash:'0'.repeat(64)}, {bytes:pdf.length+1}, {pages:0}, {pages:2001}, {peakRssBytes:1024*1024*1024+1},
    {base64:Buffer.from('not a PDF').toString('base64'),bytes:9,hash:digest(Buffer.from('not a PDF'))},
  ])('rejects malformed output rather than exposing it as a preview (%o)',async(change)=>{
    const {engine}=instance(vi.fn().mockResolvedValue({...receipt(),...change}));
    await expect(engine.render(Buffer.from('source'),'pptx',new AbortController().signal)).rejects.toThrow('[IO]');expect(mocks.clean).toHaveBeenCalledOnce();
  });
  it('keeps table XML projection distinct from PDF previews and always releases its private job',async()=>{
    const xml=Buffer.from('<?xml version="1.0"?><svg/>'),valid={...receipt(),base64:xml.toString('base64'),hash:digest(xml),bytes:xml.length,pages:0};
    const {engine,request}=instance(vi.fn().mockResolvedValue(valid));
    const result=await engine.renderTableLayout(Buffer.from('private PPTX clone'),new AbortController().signal);
    expect(result.bytes).toEqual(xml);expect(result).not.toHaveProperty('pages');expect(request.mock.calls[0][0]).toMatchObject({format:'pptx',tableLayout:true});expect(mocks.clean).toHaveBeenCalledOnce();
    await expect(engine.render(Buffer.from('source'),'pptx',new AbortController().signal)).rejects.toThrow('校验');
    for(const value of [receipt(),{...valid,pages:1},{...valid,hash:'0'.repeat(64)}]){
      request.mockResolvedValueOnce(value);await expect(engine.renderTableLayout(Buffer.from('clone'),new AbortController().signal)).rejects.toThrow('校验');
    }
    expect(mocks.clean).toHaveBeenCalledTimes(5);
  });
  it('keeps conversion failure diagnostic and cleans its isolated profile',async()=>{
    const {engine}=instance(vi.fn().mockResolvedValue({state:'failed',message:'不能打开文档',diagnostic:'format rejected'}));
    await expect(engine.render(Buffer.from('source'),'docx',new AbortController().signal)).rejects.toThrow('format rejected');expect(mocks.clean).toHaveBeenCalledOnce();
  });
  it('cancels a queued document without preparing a runtime or creating a job',async()=>{
    const queue=new FileHeavyJobs(),gate=deferred<void>(),block=queue.run(new AbortController().signal,()=>gate.promise),{engine,request}=instance(undefined,queue),abort=new AbortController();
    const promise=engine.render(Buffer.from('source'),'docx',abort.signal);abort.abort();await expect(promise).rejects.toThrow('CANCELLED');expect(mocks.resources).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();gate.resolve();await block;
  });
  it('disposal cancels preparation and cannot create a later job',async()=>{
    const gate=deferred<unknown>();mocks.resources.mockImplementation(()=>gate.promise);const {engine,request}=instance(),operation=engine.render(Buffer.from('source'),'docx',new AbortController().signal);
    await vi.waitFor(()=>expect(mocks.resources).toHaveBeenCalledOnce());engine.dispose();gate.resolve({runtime:{path:'/fixed'},files:[],links:[]});await expect(operation).rejects.toThrow('CANCELLED');expect(mocks.create).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();await expect(engine.render(Buffer.from('retry'),'docx',new AbortController().signal)).rejects.toThrow('CANCELLED');
  });
  it('cleans a job on native cancellation and does not return a late successful PDF',async()=>{
    const gate=deferred<unknown>(),abort=new AbortController(),request=vi.fn(()=>gate.promise),{engine}=instance(request);const promise=engine.render(Buffer.from('source'),'docx',abort.signal);
    await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());abort.abort();gate.resolve(receipt());await expect(promise).rejects.toThrow('CANCELLED');expect(mocks.clean).toHaveBeenCalledOnce();
  });
});
