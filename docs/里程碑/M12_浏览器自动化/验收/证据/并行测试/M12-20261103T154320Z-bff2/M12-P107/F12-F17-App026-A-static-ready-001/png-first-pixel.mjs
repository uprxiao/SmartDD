// Inspect a synthetic compositor screenshot. PNG row zero has no left/up
// predecessor for its first pixel, so all five PNG filters leave it unchanged.
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
export function pngFirstPixel(png) {
  assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  const idat=[];let colorType;
  for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){assert.equal(data[8],8);colorType=data[9];assert([2,6].includes(colorType));assert.equal(data[12],0)}
    if(type==='IDAT')idat.push(data);offset+=12+length;
  }
  const raw=inflateSync(Buffer.concat(idat));assert(raw[0]<=4);
  return[raw[1],raw[2],raw[3],colorType===6?raw[4]:255];
}
