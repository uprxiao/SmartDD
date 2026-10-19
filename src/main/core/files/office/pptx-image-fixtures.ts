import { crc32, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { PptxImageInput } from '@shared/file-pptx-image';

/** Synthetic pixel data for image adapter tests, never user files. */
export function pptxTestImage(variant=0) {
  const width=120,height=80,header=Buffer.alloc(13),pixels=Buffer.alloc((width*4+1)*height);
  header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=y*(width*4+1)+1+x*4;
    pixels[at]=variant===2?30:variant?20:240;pixels[at+1]=variant===2?210:60;pixels[at+2]=variant===2?40:variant?230:30;pixels[at+3]=x<15&&y<15?0:255;
  }
  const chunk=(name:string,bytes:Buffer)=>{const length=Buffer.alloc(4),body=Buffer.concat([Buffer.from(name),bytes]),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);};
  const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  const image:PptxImageInput={mime:'image/png',base64:bytes.toString('base64')};
  return {bytes,image,receipt:{width,height,hash:createHash('sha256').update(bytes).digest('hex')}};
}
