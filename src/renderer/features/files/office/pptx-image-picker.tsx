import { useEffect,useRef,useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { PPTX_IMAGE_LIMIT } from '@shared/file-pptx-image';
import { bytesToBase64,fileErrorMessage } from '../file-buffer';
import type { PptxBuffer } from './pptx-buffer';

/** The native file chooser grants only the selected bytes. No filesystem path
 * or URL is accepted by the Office image action. */
export function PptxImagePicker({pptx,slideId,elementId,onApplied}:{pptx:PptxBuffer;slideId:string;elementId?:string;onApplied?():void}){
  const input=useRef<HTMLInputElement>(null),reader=useRef<FileReader|null>(null),request=useRef(0);
  const captured=useRef<{id:string;version:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const label=elementId?'替换图片':'插入图片',identity=`${pptx.id}/${slideId}/${elementId??'new'}`;
  useEffect(()=>{setBusy(false);setError('');return()=>{request.current++;reader.current?.abort();captured.current=null;};},[identity]);
  const choose=()=>{
    if(!pptx.id||!pptx.result||!pptx.editable||pptx.controlsBusy||pptx.composing)return;
    captured.current={id:pptx.id,version:pptx.result.state.version};setError('');input.current?.click();
  };
  const load=async(file:File)=>{
    const expected=captured.current,token=++request.current;if(!expected)return;
    setBusy(true);setError('');
    try{
      if(!file.size||file.size>PPTX_IMAGE_LIMIT)throw new Error('请选择不超过 20 MiB 的 PNG 或 JPEG 图片');
      const bytes=await new Promise<Uint8Array>((resolve,reject)=>{
        const current=reader.current=new FileReader();current.onload=()=>resolve(new Uint8Array(current.result as ArrayBuffer));current.onerror=()=>reject(new Error('图片读取失败，原图保留'));current.onabort=()=>reject(new Error('图片读取已取消'));current.readAsArrayBuffer(file);
      });
      if(token!==request.current)return;
      const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!png&&!jpeg)throw new Error('当前支持 PNG 和 JPEG，所选文件未被插入');
      const image={mime:png?'image/png' as const:'image/jpeg' as const,base64:bytesToBase64(bytes)};
      const ok=await pptx.action(elementId?{type:'image-replace',slideId,elementId,image}:{type:'image-insert',slideId,image},expected);
      if(token===request.current&&ok)onApplied?.();
    }catch(failure){if(token===request.current)setError(fileErrorMessage(failure));}
    finally{if(token===request.current){reader.current=null;captured.current=null;setBusy(false);}}
  };
  return <><button aria-label={label} title="PNG / JPEG，最多 20 MiB、1600 万像素" disabled={busy||!pptx.editable||pptx.controlsBusy||pptx.composing} onClick={choose}>{!elementId&&<ImageIcon size={14}/>} {busy?'正在读取图片…':elementId?'替换图片':'图片'}</button><input ref={input} hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-label={`${label}文件`} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void load(file);}}/>{error&&<span role="alert" className="fw-office-notice">{error}</span>}</>;
}
