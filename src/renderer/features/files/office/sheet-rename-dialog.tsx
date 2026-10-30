import { useRef,useState,type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';

export function OfficeSheetRenameDialog({name,container,returnFocus,onRename,onCancel}:{name:string;container:RefObject<HTMLElement|null>;returnFocus:RefObject<HTMLElement|null>;onRename(name:string):Promise<string|null>;onCancel():void}) {
  const [text,setText]=useState(name),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const input=useRef<HTMLInputElement>(null),composing=useRef(false);
  const submit=async()=>{if(busy || composing.current)return;setBusy(true);setError('');try{const failure=await onRename(text);if(failure)setError(failure);else onCancel();}finally{setBusy(false);}};
  return <Dialog.Root open onOpenChange={open=>{if(!open && !busy && !composing.current)onCancel();}}>
    <Dialog.Portal container={container}>
      <Dialog.Backdrop className="fw-office-sheet-backdrop"/>
      <Dialog.Popup className="fw-office-sheet-rename" initialFocus={input} finalFocus={returnFocus} onKeyDown={event=>{
        if(event.nativeEvent.isComposing || event.keyCode === 229 || composing.current){if(['Enter','Escape'].includes(event.key))event.preventDefault();event.stopPropagation();}
      }}>
        <form onSubmit={event=>{event.preventDefault();void submit();}}>
          <Dialog.Title>重命名工作表</Dialog.Title>
          <input ref={input} aria-label="工作表新名称" value={text} maxLength={31} disabled={busy} onChange={event=>{setText(event.currentTarget.value);setError('');}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}/>
          {error && <p role="alert">{error}</p>}
          <div><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" disabled={busy || !text}>{busy ? '正在处理…' : '确定'}</button></div>
        </form>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
