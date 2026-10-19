import { crc32 } from 'node:zlib';
import { describe,it,expect } from 'vitest';
import { validatePptxImageContainer } from './pptx-image-container';
import { pptxTestImage } from './pptx-image-fixtures';
describe('strict image completeness beyond the tolerant system decoder',()=>{
  it('accepts complete transparent PNG and rejects the exact truncated native failure, bad CRC and trailing data',()=>{
    const {bytes}=pptxTestImage();expect(validatePptxImageContainer(bytes,'image/png')).toEqual({width:120,height:80});
    for(const candidate of [bytes.subarray(0,bytes.length-24),bytes.subarray(0,bytes.length-12),Buffer.concat([bytes,Buffer.from('extra')])])expect(()=>validatePptxImageContainer(candidate,'image/png')).toThrow();
    const bad=Buffer.from(bytes);bad[45]^=1;expect(()=>validatePptxImageContainer(bad,'image/png')).toThrow('CRC');
  });
  it('checks compressed scanline completeness even when the enclosing chunk CRC is valid',()=>{
    const {bytes}=pptxTestImage(),bad=Buffer.from(bytes),offset=33,length=bad.readUInt32BE(offset);bad[offset+8+5]^=127;bad.writeUInt32BE(crc32(bad.subarray(offset+4,offset+8+length)),offset+8+length);
    expect(()=>validatePptxImageContainer(bad,'image/png')).toThrow('压缩数据');
  });
  it('rejects dimension bombs before decompression and identifies unsupported animated containers',()=>{
    const {bytes}=pptxTestImage(),bomb=Buffer.from(bytes);bomb.writeUInt32BE(100000000,16);bomb.writeUInt32BE(crc32(bomb.subarray(12,29)),29);expect(()=>validatePptxImageContainer(bomb,'image/png')).toThrow('1600');
    const data=Buffer.alloc(20);data.writeUInt32BE(8);data.write('acTL',4);data.writeUInt32BE(2,8);data.writeUInt32BE(crc32(data.subarray(4,16)),16);
    expect(()=>validatePptxImageContainer(Buffer.concat([bytes.subarray(0,33),data,bytes.subarray(33)]),'image/png')).toThrow('动画');
  });
});
