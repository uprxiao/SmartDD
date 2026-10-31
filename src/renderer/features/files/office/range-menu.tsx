import { useEffect,useRef,useState,type ReactElement,type RefObject } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { OfficeRangeAction } from '@shared/file-office';

type RangedAction=Exclude<OfficeRangeAction,{type:'drawing-text'}>;
export type RangeCommand=RangedAction extends infer T ? T extends RangedAction ? Omit<T,'sheetId'|'range'> : never : never;
export function OfficeRangeMenu({children,enabled,canEdit,container,beforeOpen,onAction}:{children:ReactElement;enabled:boolean;canEdit:boolean;container:RefObject<HTMLElement|null>;beforeOpen(target:EventTarget|null):Promise<boolean>;onAction(action:RangeCommand):void}) {
  const [open,setOpen]=useState(false),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>{if(!enabled){generation.current++;setOpen(false);}},[enabled]);
  return <ContextMenu.Root disabled={!enabled} open={open} onOpenChange={(next,details)=>{
    const request=++generation.current;
    if(!next){setOpen(false);return;}
    // The active editor must finish before the menu targets a different range.
    // Do not open against the previous selection while IPC is still pending.
    void beforeOpen(details.event.target).then(ok=>{if(ok && generation.current === request)setOpen(true);});
  }}>
    <ContextMenu.Trigger render={children} onKeyDown={event=>{
      if(!enabled || event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest('input,textarea'))return;
      if(event.key === '/' || event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault();event.stopPropagation();
        const active=event.currentTarget.querySelector('[data-active=true]') ?? event.currentTarget,box=active.getBoundingClientRect();
        active.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.bottom}));
      }
    }}/>
    <ContextMenu.Portal container={container}><ContextMenu.Positioner className="fw-office-sheet-menu-position" side="right" align="start" alignOffset={4} collisionPadding={8}>
      <ContextMenu.Popup className="fw-office-sheet-menu" aria-label="单元格操作">
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'fill',direction:'down'})}>向下填充</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'fill',direction:'right'})}>向右填充</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'merge'})}>合并单元格</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'unmerge'})}>取消合并</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'fit',axis:'column'})}>适应列宽</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'fit',axis:'row'})}>适应行高</ContextMenu.Item>
        <ContextMenu.Separator/>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'clear',mode:'contents'})}>清除内容</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'clear',mode:'format'})}>清除格式</ContextMenu.Item>
        <ContextMenu.Item disabled={!canEdit} onClick={()=>onAction({type:'clear',mode:'all'})}>全部清除</ContextMenu.Item>
      </ContextMenu.Popup>
    </ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
}
