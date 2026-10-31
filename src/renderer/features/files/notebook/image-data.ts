import type {NotebookAsset} from './model';

/** Decode only the same bounded image MIME types accepted by notebook outputs.
 * SVG still goes through the worker's sanitizer before it is displayed. */
export function notebookImageData(href:string):NotebookAsset{
  const match=/^data:(image\/(?:png|jpeg|svg\+xml))(;base64)?,([\s\S]*)$/i.exec(href);
  if(!match)throw new Error('Notebook 内嵌图片编码不受支持');
  const mime=match[1].toLowerCase() as NotebookAsset['mime'],limit=mime==='image/svg+xml'?2*1024*1024:40*1024*1024;
  if(match[3].length>(match[2]?Math.ceil(limit/3)*4+4:limit*3))throw new Error('Notebook 内嵌图片超过预览上限');
  if(!match[2]){
    if(mime!=='image/svg+xml')throw new Error('Notebook 位图需要 Base64 编码');
    const data=decodeURIComponent(match[3]);if(new TextEncoder().encode(data).length>limit)throw new Error('Notebook 内嵌图片超过预览上限');return{mime,data};
  }
  const encoded=match[3].replace(/\s/g,'');
  if(!encoded||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4===1)throw new Error('Notebook 内嵌图片 Base64 无效');
  const decoded=atob(encoded);if(decoded.length>limit)throw new Error('Notebook 内嵌图片超过预览上限');
  return{mime,data:mime==='image/svg+xml'?new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(decoded,c=>c.charCodeAt(0))):encoded};
}
