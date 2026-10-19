import type { ReactElement,RefObject } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';

export function OfficeSheetMenu({children,enabled,canDelete,container,onView,onRename,onDelete}:{children:ReactElement;enabled:boolean;canDelete:boolean;container:RefObject<HTMLElement|null>;onView():void;onRename():void;onDelete():void}) {
  return <ContextMenu.Root disabled={!enabled}>
    <ContextMenu.Trigger render={children} onKeyDown={event=>{
      if(!enabled || event.nativeEvent.isComposing || event.keyCode === 229)return;
      if(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault();event.stopPropagation();
        const box=event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.bottom}));
      }
    }}/>
    <ContextMenu.Portal container={container}>
      <ContextMenu.Positioner className="fw-office-sheet-menu-position" side="right" align="start" alignOffset={4} collisionPadding={8}>
        <ContextMenu.Popup className="fw-office-sheet-menu" aria-label="工作表操作">
          <ContextMenu.Item disabled={!enabled} onClick={onView}>查看工作表</ContextMenu.Item>
          <ContextMenu.Item disabled={!enabled} onClick={onRename}>重命名</ContextMenu.Item>
          <ContextMenu.Separator/>
          <ContextMenu.Item disabled={!enabled || !canDelete} onClick={onDelete}>删除</ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  </ContextMenu.Root>;
}
