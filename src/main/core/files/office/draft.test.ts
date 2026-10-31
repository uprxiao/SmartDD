import { describe,expect,it } from 'vitest';
import { encodeOfficeDraft,decodeOfficeDraft } from './draft';
describe('Office private recovery envelope',()=>{
  it('retains uncommitted text-box identity and Unicode text without putting it into the source bytes',()=>{
    const bytes=Buffer.from('retained OOXML'),pendingDrawing={sheetId:'1',objectId:'a'.repeat(64),text:'未提交\n_x000A_ & <hello> 😀\ud800'};
    expect(decodeOfficeDraft(encodeOfficeDraft(bytes,undefined,pendingDrawing))).toEqual({bytes,pendingDrawing});
    expect(()=>encodeOfficeDraft(bytes,undefined,{...pendingDrawing,objectId:'/arbitrary/path'})).toThrow();
  });
  it('retains exact package bytes and incomplete, Unicode and escape-looking formula input',()=>{
    const bytes=Buffer.from([0,255,1,13,10]), pending={sheetId:'1',row:0,column:0,text:'=SUM(中文😀\ud800'};
    expect(decodeOfficeDraft(encodeOfficeDraft(bytes,pending))).toEqual({bytes,pending});
    expect(decodeOfficeDraft(encodeOfficeDraft(bytes))).toEqual({bytes});
  });
  it('rejects truncation, unexpected metadata and over-budget input before it can become a save candidate',()=>{
    const bytes=encodeOfficeDraft(Buffer.from('PK'),{sheetId:'1',row:0,column:0,text:'partial'});
    expect(()=>decodeOfficeDraft(bytes.subarray(0,-1))).toThrow('长度');
    const malformed=Buffer.from(bytes); malformed.writeUInt32LE(999999,10); expect(()=>decodeOfficeDraft(malformed)).toThrow('长度');
    expect(()=>decodeOfficeDraft(Buffer.from('a valid text draft is not OOXML'))).toThrow('格式');
    expect(()=>encodeOfficeDraft(Buffer.alloc(40*1024*1024+1))).toThrow();
  });
});
