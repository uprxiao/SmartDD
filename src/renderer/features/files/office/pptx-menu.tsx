import {useEffect,useRef,useState,type ReactElement,type RefObject} from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
const layers=[['front','置于顶层','⌘⇧F'],['forward','上移一层','⌘⌥⇧F'],['backward','下移一层','⌘⌥⇧B'],['back','置于底层','⌘⇧B']] as const;
export function PptxElementMenu({children,enabled,busy=false,container,onLayer,onSelect}:{children:ReactElement;enabled:boolean;busy?:boolean;container:RefObject<HTMLElement|null>;onLayer(direction:typeof layers[number][0]):void;onSelect():boolean|Promise<boolean>}){
  const [open,setOpen]=useState(false),request=useRef(0),mounted=useRef(true),allowed=useRef(enabled);
  allowed.current=enabled;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;};},[]);
  useEffect(()=>{if(!enabled){request.current++;setOpen(false);}},[enabled]);
  const prepare=async()=>{
    const current=++request.current;if(!enabled||busy)return;
    let selected=false;try{selected=await onSelect();}catch{/* The owning buffer retains its failed input/error. */}
    if(mounted.current&&current===request.current&&allowed.current)setOpen(selected);
  };
  return <ContextMenu.Root disabled={!enabled||busy} open={open&&enabled&&!busy} onOpenChange={next=>{if(next)void prepare();else{request.current++;setOpen(false);}}}><ContextMenu.Trigger render={children} onKeyDown={event=>{
    if(!enabled||event.nativeEvent.isComposing||event.keyCode===229||(event.target as Element).closest('textarea'))return;
    if(event.key==='Escape'){request.current++;setOpen(false);return;}
    if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();event.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.bottom}));}
  }}/><ContextMenu.Portal container={container}><ContextMenu.Positioner className="fw-office-sheet-menu-position" side="right" align="start" alignOffset={4} collisionPadding={8}><ContextMenu.Popup className="fw-office-sheet-menu" aria-label="对象操作">
    {layers.map(([direction,label,key])=><ContextMenu.Item key={direction} disabled={!enabled||busy} onClick={()=>onLayer(direction)}>{label}<kbd>{key}</kbd></ContextMenu.Item>)}
  </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal></ContextMenu.Root>;
}
export function PptxSlideMenu({children,enabled,hidden,canDuplicate,canDelete,container,onVisibility,onDuplicate,onDelete}:{children:ReactElement;enabled:boolean;hidden:boolean;canDuplicate:boolean;canDelete:boolean;container:RefObject<HTMLElement|null>;onVisibility():void;onDuplicate():void;onDelete():void}){
  return <ContextMenu.Root disabled={!enabled}>
    <ContextMenu.Trigger render={children} onKeyDown={event=>{
      if(!enabled||event.nativeEvent.isComposing||event.keyCode===229)return;
      if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();event.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.bottom}));}
    }}/>
    <ContextMenu.Portal container={container}><ContextMenu.Positioner className="fw-office-sheet-menu-position" side="right" align="start" alignOffset={4} collisionPadding={8}><ContextMenu.Popup className="fw-office-sheet-menu" aria-label="幻灯片操作">
      <ContextMenu.Item disabled={!enabled||!canDuplicate} onClick={onDuplicate}>复制幻灯片</ContextMenu.Item>
      <ContextMenu.Item disabled={!enabled} onClick={onVisibility}>{hidden?'显示':'隐藏'}</ContextMenu.Item>
      <ContextMenu.Separator/>
      <ContextMenu.Item disabled={!enabled||!canDelete} onClick={onDelete}>删除</ContextMenu.Item>
    </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
}
