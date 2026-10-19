import type { ReactElement,RefObject } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
const layers=[['front','置于顶层','⌘⇧F'],['forward','上移一层','⌘⌥⇧F'],['backward','下移一层','⌘⌥⇧B'],['back','置于底层','⌘⇧B']] as const;
export function PptxElementMenu({children,enabled,container,onLayer,onSelect,onDelete}:{children:ReactElement;enabled:boolean;container:RefObject<HTMLElement|null>;onLayer(direction:typeof layers[number][0]):void;onSelect():void;onDelete():void}){
  return <ContextMenu.Root disabled={!enabled}><ContextMenu.Trigger render={children} onContextMenu={()=>{if(enabled)onSelect();}} onKeyDown={event=>{
    if(!enabled||event.nativeEvent.isComposing||event.keyCode===229||(event.target as Element).closest('textarea'))return;
    if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();event.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.bottom}));}
  }}/><ContextMenu.Portal container={container}><ContextMenu.Positioner className="fw-office-sheet-menu-position" side="right" align="start" alignOffset={4} collisionPadding={8}><ContextMenu.Popup className="fw-office-sheet-menu" aria-label="对象操作">
    {layers.map(([direction,label,key])=><ContextMenu.Item key={direction} disabled={!enabled} onClick={()=>onLayer(direction)}>{label}<kbd>{key}</kbd></ContextMenu.Item>)}
    <ContextMenu.Separator/>
    <ContextMenu.Item disabled={!enabled} onClick={onDelete}>删除<kbd>⌫</kbd></ContextMenu.Item>
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
