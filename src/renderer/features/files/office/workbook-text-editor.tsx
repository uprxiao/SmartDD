import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {OfficeFloatingVector} from '@shared/file-office';
import type {OfficeBuffer} from './buffer';

/** Input lives in the FileBuffer's recovery envelope, not just this textarea.
 * The same queue flushes it before history, navigation, close and save. */
export function WorkbookTextEditor({office,sheetId,object,style,onClose}:{office:OfficeBuffer;sheetId:string;object:OfficeFloatingVector;style:CSSProperties;onClose():void}){
  const [text,setText]=useState(office.pendingDrawing?.objectId===object.id?office.pendingDrawing.text:object.shape?.text??'');
  const original=useRef({text:object.shape?.text??'',version:office.result?.state.version}),input=useRef<HTMLTextAreaElement>(null),alive=useRef(false),finishing=useRef(false),composing=useRef(false),blurred=useRef(false);
  const writer=office.writer;
  useEffect(()=>{alive.current=true;input.current?.focus({preventScroll:true});return()=>{alive.current=false;if(composing.current)office.composing=false;};},[office]);
  const finish=async()=>{
    if(finishing.current||composing.current)return;finishing.current=true;
    const ok=await writer.flush();finishing.current=false;if(!alive.current)return;
    if(ok)onClose();else input.current?.focus({preventScroll:true});
  };
  return <textarea ref={input} className="fw-office-text-editor" aria-label="编辑工作簿文本框" data-office-text-editor={object.id} style={style} maxLength={32767} value={text} readOnly={!office.editingControls}
    onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}
    onChange={event=>{const value=event.currentTarget.value;if(writer.setDrawingText({sheetId,objectId:object.id,text:value},original.current.text,original.current.version))setText(value);}}
    onCompositionStart={()=>{composing.current=true;office.composing=true;}}
    onCompositionEnd={()=>{composing.current=false;office.composing=false;if(blurred.current)void finish();}}
    onBlur={()=>{blurred.current=true;void finish();}}
    onFocus={()=>{blurred.current=false;}}
    onKeyDown={event=>{
      if(event.nativeEvent.isComposing||event.keyCode===229||composing.current){event.stopPropagation();return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();writer.cancelDrawingText();onClose();return;}
      if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();void finish();return;}
      if(!((event.metaKey||event.ctrlKey)&&['s','z'].includes(event.key.toLowerCase())))event.stopPropagation();
    }}/>;
}
