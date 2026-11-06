import { crc32,inflateSync } from 'node:zlib';
import { FileError } from '@shared/files';

const invalid=(detail:string):never=>{throw new FileError('INVALID_INPUT',`图片数据不完整或损坏：${detail}`);};
const dimensions=(width:number,height:number)=>{
  if(!width||!height||width>8192||height>8192||width*height>16*1024*1024)throw new FileError('TOO_LARGE','图片超过 1600 万像素或单边 8192 像素');
  return {width,height};
};
/** ImageIO deliberately recovers some truncated inputs. Validate container and
 * compressed PNG scanline completeness in the bounded Office Worker as well. */
export function validatePptxImageContainer(bytes:Buffer,mime:'image/png'|'image/jpeg'):{width:number;height:number}{
  if(mime==='image/jpeg')return jpeg(bytes);
  let offset=8,width=0,height=0,depth=0,color=0,interlace=0,ended=false,palette=false,idatEnded=false;
  const data:Buffer[]=[];
  while(offset<bytes.length){
    if(offset+12>bytes.length)invalid('PNG 块被截断');
    const length=bytes.readUInt32BE(offset),name=bytes.toString('ascii',offset+4,offset+8),end=offset+12+length;
    if(end>bytes.length||!/^[A-Za-z]{4}$/.test(name)||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))invalid('PNG 块长度或 CRC 不匹配');
    const body=bytes.subarray(offset+8,end-4);
    if(offset===8&&name!=='IHDR')invalid('PNG 缺少头部');
    if(name==='IHDR'){
      if(offset!==8||length!==13)invalid('PNG 头部无效');
      width=body.readUInt32BE(0);height=body.readUInt32BE(4);dimensions(width,height);depth=body[8];color=body[9];interlace=body[12];
      if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]} as Record<number,number[]>)[color]?.includes(depth)||body[10]!==0||body[11]!==0||interlace>1)invalid('PNG 编码参数无效');
    }else if(name==='PLTE'){
      if(palette||data.length||!length||length%3||length>768||[0,4].includes(color)||color===3&&length/3>2**depth)invalid('PNG 调色板无效');palette=true;
    }else if(name==='IDAT'){
      if(idatEnded||color===3&&!palette)invalid('PNG 图像块顺序无效');data.push(body);
    }else if(name==='IEND'){
      if(length||!data.length||end!==bytes.length)invalid('PNG 结尾无效');ended=true;
    }else{
      if(['acTL','fcTL','fdAT'].includes(name))throw new FileError('UNSUPPORTED','动画 PNG 尚不可插入，原文件保留');
      if((bytes[offset+4]&32)===0)throw new FileError('UNSUPPORTED','PNG 包含未支持的关键块');
    }
    if(data.length&&name!=='IDAT')idatEnded=true;offset=end;
  }
  if(!ended)invalid('PNG 缺少完整结尾');
  const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color],passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return {size:Math.ceil(w*channels*depth/8)+1,count:w?h:0};});
  const expected=rows.reduce((sum,row)=>sum+row.size*row.count,0),compressed=Buffer.concat(data);
  try{
    const result=inflateSync(compressed,{maxOutputLength:expected,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
    if(result.buffer.length!==expected||result.engine.bytesWritten!==compressed.length)invalid('PNG 压缩数据长度无效');
    let at=0;for(const row of rows)for(let i=0;i<row.count;i++){if(result.buffer[at]>4)invalid('PNG 扫描行滤镜无效');at+=row.size;}
  }catch(error){if(error instanceof FileError)throw error;invalid('PNG 压缩数据无法完整解码');}
  return {width,height};
}
function jpeg(bytes:Buffer):{width:number;height:number}{
  let offset=2,width=0,height=0,scans=0,inScan=false;
  while(offset<bytes.length){
    if(inScan){
      while(offset<bytes.length){
        if(bytes[offset++]!==255)continue;
        const start=offset-1;while(bytes[offset]===255)offset++;
        const code=bytes[offset++];if(code===0||code>=0xd0&&code<=0xd7)continue;
        offset=start;inScan=false;break;
      }
    }
    if(offset>=bytes.length||bytes[offset++]!==255)invalid('JPEG 标记缺失');
    while(bytes[offset]===255)offset++;const marker=bytes[offset++];
    if(marker===0xd9){if(!width||!scans||offset!==bytes.length)invalid('JPEG 结尾无效');return {width,height};}
    if(marker===0xd8||marker===0||marker>=0xd0&&marker<=0xd7||offset+2>bytes.length)invalid('JPEG 标记无效');
    if(marker===1)continue;
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)invalid('JPEG 数据段被截断');
    const body=bytes.subarray(offset+2,offset+length);
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
      if(![0xc0,0xc1,0xc2].includes(marker))throw new FileError('UNSUPPORTED','此 JPEG 压缩模式尚未适配');
      if(width||body.length<6||body.length!==6+body[5]*3)invalid('JPEG 帧头无效');width=body.readUInt16BE(3);height=body.readUInt16BE(1);dimensions(width,height);
    }
    if(marker===0xda){if(!width||body.length<6)invalid('JPEG 扫描头无效');scans++;inScan=true;}
    offset+=length;
  }
  return invalid('JPEG 缺少完整结尾');
}
