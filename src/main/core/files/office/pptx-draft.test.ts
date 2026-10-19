import { describe,expect,it } from 'vitest';
import { pptxPendingInputs,pptxPendingBatchSchema,pptxPendingSchema,pptxPendingKey } from '@shared/file-pptx';
import { encodePptxDraft,decodePptxDraft } from './pptx-draft';

describe('targeted PPTX recovery envelope',()=>{
  it('reads the original WYPPTX1 notes without reinterpretation',()=>{
    const bytes=Buffer.from('PK-original'),pending={slideId:'256',text:'旧备注😀\ud800'};
    const json=Buffer.from(JSON.stringify({schema:1,bytes:bytes.length,pending})),length=Buffer.alloc(4);length.writeUInt32LE(json.length);
    expect(decodePptxDraft(Buffer.concat([Buffer.from('WYPPTX1\n'),length,json,bytes]))).toEqual({bytes,pending});
  });
  it('reads WYPPTX2 object inputs as their original targets and rejects cell data under the old schema',()=>{
    const bytes=Buffer.from('PK-original'),pending=[{slideId:'256',text:'notes'},{slideId:'256',elementId:'2',text:'object'}];
    const encode=(inputs:unknown)=>{const json=Buffer.from(JSON.stringify({schema:2,bytes:bytes.length,pending:inputs})),size=Buffer.alloc(4);size.writeUInt32LE(json.length);return Buffer.concat([Buffer.from('WYPPTX2\n'),size,json,bytes]);};
    expect(decodePptxDraft(encode(pending))).toEqual({bytes,pending});expect(()=>decodePptxDraft(encode([{...pending[1],cell:{row:0,column:1}}]))).toThrow('元数据');
  });
  it('recovers several independent targets and invalid XML composition without changing OOXML bytes',()=>{
    const bytes=Buffer.from([0,255,13,10]),pending=[{slideId:'256',text:'notes😀'},{slideId:'256',elementId:'2',text:'中文\ud800\u0000'},{slideId:'257',elementId:'2',text:'different slide'}];
    const encoded=encodePptxDraft(bytes,pending),decoded=decodePptxDraft(encoded);
    expect(encoded.subarray(0,8).toString()).toBe('WYPPTX4\n');expect(decoded.bytes).toEqual(bytes);expect(pptxPendingInputs(decoded.pending)).toEqual(pending);
    // JSON escaping can use six bytes per UTF-16 unit. A single bounded raw
    // input must still be recoverable even before XML validation succeeds.
    const raw={slideId:'256',elementId:'2',text:'\u0000'.repeat(65536)};
    expect(pptxPendingInputs(decodePptxDraft(encodePptxDraft(bytes,raw)).pending)).toEqual([raw]);
    expect(decodePptxDraft(encodePptxDraft(bytes))).toEqual({bytes});
  });
  it('keeps table cells separate from each other and from notes/object text, including raw composition',()=>{
    const base={slideId:'256',elementId:'2',text:'中文\ud800\u0000'},pending=[{slideId:'256',text:'notes'},base,{...base,cell:{row:0,column:0}},{...base,cell:{row:0,column:1}},{...base,cell:{row:1,column:0}}],bytes=Buffer.from('PK');
    expect(new Set(pending.map(pptxPendingKey)).size).toBe(5);expect(pptxPendingInputs(decodePptxDraft(encodePptxDraft(bytes,pending)).pending)).toEqual(pending);
    expect(()=>encodePptxDraft(bytes,[pending[2],pending[2]])).toThrow('重复');
    for(const value of [{slideId:'256',cell:{row:0,column:0},text:'missing object'},{...base,cell:{row:-1,column:0}},{...base,cell:{row:0,column:65536}},{...base,cell:{row:0,column:0,extra:1}}])expect(pptxPendingSchema.safeParse(value).success).toBe(false);
  });
  it('rejects duplicate targets, overflow and damaged envelopes instead of dropping input',()=>{
    const input={slideId:'256',elementId:'2',text:'same'},bytes=Buffer.from('PK');
    expect(()=>encodePptxDraft(bytes,[input,input])).toThrow('重复');
    expect(()=>encodePptxDraft(bytes,Array.from({length:4},(_,i)=>({...input,elementId:String(i),text:'\u0000'.repeat(65536)})))).toThrow('预算');
    expect(pptxPendingBatchSchema.safeParse(Array.from({length:129},(_,i)=>({...input,elementId:String(i)}))).success).toBe(false);
    const encoded=encodePptxDraft(bytes,input);
    for(const bad of [encoded.subarray(0,-1),Buffer.concat([encoded,Buffer.from('x')]),Buffer.from(encoded).fill(255,8,12)])expect(()=>decodePptxDraft(bad)).toThrow();
  });
  it('reads the prior cell envelope and keeps invalid chart input as a distinct version-four target',()=>{
    const bytes=Buffer.from('PK-original'),cell={slideId:'256',elementId:'2',cell:{row:0,column:0},text:'old cell'};
    const encode3=(pending:unknown)=>{const json=Buffer.from(JSON.stringify({schema:3,bytes:bytes.length,pending})),size=Buffer.alloc(4);size.writeUInt32LE(json.length);return Buffer.concat([Buffer.from('WYPPTX3\n'),size,json,bytes]);};
    expect(decodePptxDraft(encode3([cell]))).toEqual({bytes,pending:[cell]});
    const chart={slideId:'256',elementId:'2',chartValues:true as const,text:'1,中文\ud800,'};
    expect(()=>decodePptxDraft(encode3([chart]))).toThrow('元数据');
    expect(pptxPendingInputs(decodePptxDraft(encodePptxDraft(bytes,[cell,chart])).pending)).toEqual([cell,chart]);
    expect(pptxPendingKey(cell)).not.toBe(pptxPendingKey(chart));
    expect(pptxPendingSchema.safeParse({...chart,elementId:undefined}).success).toBe(false);expect(pptxPendingSchema.safeParse({...chart,cell:cell.cell}).success).toBe(false);
  });
});
