import {afterEach,describe,expect,it,vi} from 'vitest';
import {formatTerminalReferences,terminalReferenceSchema} from '@shared/file-terminal';
import {disposers,fixture,payload,pdf,selection,numericTokens} from './fixture';
afterEach(()=>{for(const d of disposers.splice(0).reverse())d();vi.restoreAllMocks();});
describe('G049 original T12/T13 PDF reference contract against current exports',()=>{
 it('accepts a real PDF region comment without a fictitious L1 range',()=>{const input=payload();const accepted=terminalReferenceSchema.parse(input);expect(accepted).toEqual(input);expect(accepted).not.toHaveProperty('range');});
 it('accepts an in-page point only when both dimensions are zero',()=>{const input=payload(1,{x:0,y:1,width:0,height:0});expect(terminalReferenceSchema.parse(input)).toEqual(input);});
 it('formats actual path, page and all four normalized region numbers without text line labels',()=>{
  const input={...payload(),relativePath:'目录/evidence.pdf'},value=formatTerminalReferences([input]as never,{includeText:true,style:'plain'}).text;
  expect(value).toContain('目录/evidence.pdf');expect(value).toContain(input.comment);expect(value).toContain(input.text);expect(value).not.toMatch(/\bL\d+(?:-\d+)?\b/);
  const tokens=numericTokens(value);expect(tokens).toContain(2);for(const n of [0.125,0.25,0.375,0.5])expect(tokens.some(v=>v===n||v===n*100)).toBe(true);
 });
 it('preserves the PDF comment kind and page/region through existing add and actual insert builder',async()=>{
  const f=fixture();await f.store.add(f.path,f.file.revision,selection()as never);expect(f.store.references).toHaveLength(1);expect(f.api.terminalInsert).not.toHaveBeenCalled();await f.store.insert();expect(f.api.terminalInsert).toHaveBeenCalledOnce();const input=f.api.terminalInsert.mock.calls[0][0];expect(input.kind).toBe('context');expect(input.references[0]).toMatchObject({kind:'pdf-comment',pdf:pdf(),comment:'请核对绿色区域',text:'选中文字🙂'});expect(input.references[0]).not.toHaveProperty('range');
 });
 it('returns true only after a comment is actually queued, so the draft can be closed honestly',async()=>{const f=fixture();expect(await f.store.add(f.path,f.file.revision,selection()as never)).toBe(true);expect(f.store.references).toHaveLength(1);});
 it('keeps distinct page and region comments of the same PDF instead of collapsing them',async()=>{
  const f=fixture();for(const s of [selection(),selection(3),selection(2,{x:0.5,y:0.25,width:0.25,height:0.5})])await f.store.add(f.path,f.file.revision,s as never);expect(f.store.references).toHaveLength(3);expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });
 it('deduplicates exactly the same page/anchor/text/comment and releases the redundant captured ref',async()=>{const f=fixture();await f.store.add(f.path,f.file.revision,selection()as never);await f.store.add(f.path,f.file.revision,selection()as never);expect(f.store.references).toHaveLength(1);expect(f.api.closeDocument).toHaveBeenCalledTimes(1);expect(f.api.terminalInsert).not.toHaveBeenCalled();});
 it('deduplicates concurrent identical add calls without leaking extra held document refs',async()=>{const f=fixture();await Promise.all([f.store.add(f.path,f.file.revision,selection()as never),f.store.add(f.path,f.file.revision,selection()as never)]);expect(f.store.references).toHaveLength(1);const held=new Set(f.store.references.map(x=>x.file.ref.id)),closed=new Set(f.api.closeDocument.mock.calls.map(x=>x[0].id));expect(f.opened.filter(x=>!closed.has(x.ref.id)).map(x=>x.ref.id)).toEqual([...held]);});
 it('updates issued capability metadata on the same lease/generation without clearing the tray',async()=>{
  const f=fixture();await f.store.add(f.path,f.file.revision,selection()as never);const before=[...f.store.references];const updated={...f.root,capabilities:{pdfAnnotations:false,pdfAnnotationBatching:true}};f.store.setRoot(updated);expect((f.store.root as any).capabilities).toEqual(updated.capabilities);expect(f.store.references).toEqual(before);expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });
});
