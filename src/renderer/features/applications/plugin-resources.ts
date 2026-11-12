const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const maximumBytes=25*1024*1024;
function bytes(value:Record<string,unknown>):Uint8Array {
  if(typeof value.data!=='string')throw new Error('资源分块内容无效');
  if(value.encoding==='utf8')return new TextEncoder().encode(value.data);
  if(value.encoding==='base64')return Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
  throw new Error('资源分块编码无效');
}
/** Optional standard chunk contract. Existing single-response plugin resources keep their declared semantics. */
export async function assemblePluginResource(resource:unknown,read:(offset?:number)=>Promise<unknown>,signal:AbortSignal):Promise<unknown>{
  if(signal.aborted)throw new DOMException('页面读取已取消','AbortError');
  let value=await read();if(!object(value)||!Object.hasOwn(value,'nextOffset'))return value;
  if(!object(resource)||typeof resource.id!=='string'||typeof resource.revision!=='string'||!/^[a-f0-9]{64}$/.test(resource.revision)||typeof resource.mediaType!=='string'||!Number.isSafeInteger(resource.size)||Number(resource.size)<0||Number(resource.size)>maximumBytes)throw new Error('资源引用无效或超过预览预算');
  const chunks:Uint8Array[]=[];let offset=0;
  for(let count=0;count<1024;count++){
    if(signal.aborted)throw new DOMException('页面读取已取消','AbortError');
    if(!object(value)||value.resourceId!==resource.id||value.revision!==resource.revision||value.mediaType!==resource.mediaType||value.offset!==offset||!Number.isSafeInteger(value.length)||Number(value.length)<0)throw new Error('资源分块来源或位置不符');
    const chunk=bytes(value);if(chunk.length!==value.length||offset+chunk.length>Number(resource.size))throw new Error('资源分块长度不符');chunks.push(chunk);offset+=chunk.length;
    if(value.nextOffset===null){if(value.eof!==true||offset!==resource.size)throw new Error('资源未完整接收');break;}
    if(chunk.length===0||value.eof!==false||value.nextOffset!==offset)throw new Error('资源分块没有连续前进');
    if(count===1023)throw new Error('资源分块数量超过预算');value=await read(offset);
  }
  const complete=new Uint8Array(offset);let position=0;for(const chunk of chunks){complete.set(chunk,position);position+=chunk.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',complete)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==resource.revision)throw new Error('完整资源内容摘要不符');
  if(signal.aborted)throw new DOMException('页面读取已取消','AbortError');
  let binary='';for(let i=0;i<complete.length;i+=8192)binary+=String.fromCharCode(...complete.subarray(i,i+8192));
  return{mediaType:resource.mediaType,resourceId:resource.id,revision:resource.revision,encoding:'base64',data:btoa(binary),offset:0,length:complete.length,nextOffset:null,eof:true,truncated:false};
}
