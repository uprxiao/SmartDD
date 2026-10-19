import { useEffect,useRef,useState,type CSSProperties,type RefObject } from 'react';
import type { PptxElementInfo } from '@shared/file-pptx-elements';
import { pptxTableAnchors,pptxTableRangeCells,type PptxTableAddress,type PptxTableCellLayout,type PptxTableLayout,type PptxTableRange } from '@shared/file-pptx-table';
import type { PptxBuffer } from './pptx-buffer';
import { moveTableCell,sameTableCell } from './pptx-table-selection';

/** Map the native quadrilateral to a CSS box without assuming equal rows,
 * axis alignment or the (often much larger) source graphic-frame extent. */
function cellStyle(cell:PptxTableCellLayout,scale:number):CSSProperties{
  const [a,b,,d]=cell.points,ux=b[0]-a[0],uy=b[1]-a[1],vx=d[0]-a[0],vy=d[1]-a[1],width=Math.hypot(ux,uy),height=Math.hypot(vx,vy);
  return {left:a[0]*scale,top:a[1]*scale,width:width*scale,height:height*scale,transform:`matrix(${ux/width},${uy/width},${vx/height},${vy/height},0,0)`};
}
export function PptxTableObject({pptx,slideId,element,layout,scale,enabled,container,onSelect,onExit}:{
  pptx:PptxBuffer;slideId:string;element:PptxElementInfo;layout?:PptxTableLayout;scale:number;enabled:boolean;container:RefObject<HTMLElement|null>;
  onSelect(cell?:PptxTableAddress,text?:boolean):Promise<boolean>;onExit():void;
}){
  const table=element.table!,root=useRef<HTMLDivElement>(null),lastLayout=useRef(layout),mounted=useRef(true),request=useRef(0);
  const selected=pptx.selection?.slideId===slideId&&pptx.selection.elementId===element.id,active=selected?pptx.selection?.cell:undefined;
  const inputTarget=pptx.elementEditing?.slideId===slideId&&pptx.elementEditing.elementId===element.id?pptx.elementEditing:undefined;
  const [range,setRange]=useState<PptxTableRange|null>(active?{start:active,end:active}:null);
  if(layout)lastLayout.current=layout;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;};},[]);
  useEffect(()=>{setRange(prior=>active?(prior&&sameTableCell(prior.end,active)?prior:{start:active,end:active}):null);},[active?.row,active?.column,selected]);
  const focusCell=(cell?:PptxTableAddress)=>{
    const node=cell?root.current?.querySelector<HTMLElement>(`[data-cell="${cell.row}:${cell.column}"]`):root.current;
    (node??container.current)?.focus({preventScroll:true});
  };
  const select=async(cell:PptxTableAddress,extend=false,text=false)=>{
    const sequence=++request.current;if(pptx.composing||!layout)return;
    if(!await onSelect(cell,text)||!mounted.current||sequence!==request.current)return;
    setRange({start:extend&&range?range.start:cell,end:cell});if(!text)focusCell(cell);
  };
  const clear=()=>{
    if(!enabled||!range||!layout||pptx.composing||pptx.controlsBusy)return;
    void pptx.action({type:'table-clear',slideId,elementId:element.id,range}).then(ok=>{if(ok&&mounted.current)focusCell(active);});
  };
  const highlighted=new Set(range&&selected?pptxTableRangeCells(table,range).map(cell=>`${cell.row}:${cell.column}`):[]);
  // Only the already focused input may retain its old measured position while
  // a new version renders. Stale geometry never exposes new editable hit areas.
  const geometry=layout??lastLayout.current;
  if(!geometry)return null;
  const cells=new Map(geometry.cells.map(cell=>[`${cell.row}:${cell.column}`,cell]));
  return <div ref={root} role="grid" tabIndex={active?-1:0} aria-label={`table 对象 ${element.name||element.id}`} aria-rowcount={table.cells.length} aria-colcount={table.widths.length} aria-readonly={!enabled} aria-multiselectable="true" className="fw-pptx-table" onFocus={event=>{if(event.target===event.currentTarget&&!selected)void onSelect();}} onKeyDown={event=>{
    if((event.target as Element).closest('textarea')||event.defaultPrevented||event.nativeEvent.isComposing||event.keyCode===229||pptx.composing)return;
    const primary=event.metaKey!==event.ctrlKey;
    if(event.key==='Escape'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      event.preventDefault();event.stopPropagation();if(active){void onSelect().then(ok=>{if(ok){setRange(null);focusCell();}});}else onExit();return;
    }
    if(!layout||pptx.controlsBusy){if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter','F2','Delete','Backspace'].includes(event.key)||primary&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();}return;}
    if(active&&primary&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='a'){
      event.preventDefault();event.stopPropagation();setRange({start:{row:0,column:0},end:{row:table.cells.length-1,column:table.widths.length-1}});return;
    }
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab'].includes(event.key)&&active){
      event.preventDefault();event.stopPropagation();void select(moveTableCell(table,active,event.key,event.shiftKey),event.key!=='Tab'&&event.shiftKey);return;
    }
    if((event.key==='Enter'||event.key==='F2')&&!event.shiftKey){
      event.preventDefault();event.stopPropagation();const cell=active??pptxTableAnchors(table)[0];if(cell)void select(cell,false,enabled);return;
    }
    if((event.key==='Delete'||event.key==='Backspace')&&active&&!event.shiftKey){event.preventDefault();event.stopPropagation();if(!event.repeat)clear();}
  }}>
    {table.cells.map((row,r)=><div key={r} role="row" aria-rowindex={r+1} className="fw-pptx-table-row">{row.filter(cell=>!cell.horizontalMerge&&!cell.verticalMerge).map(cell=>{
      const address={row:cell.row,column:cell.column},key=`${cell.row}:${cell.column}`,box=cells.get(key),editing=enabled&&sameTableCell(inputTarget?.cell,address);
      if(!box)return null;
      const style=cell.textStyle,value=pptx.pendingFor(slideId,element.id,address)?.text??cell.text,sourceVersion=pptx.result?.state.version;
      return <div key={key} role="gridcell" aria-label={`幻灯片表格 ${cell.row+1}:${cell.column+1}`} aria-selected={highlighted.has(key)} aria-disabled={!layout&&!editing||undefined} aria-colindex={cell.column+1} aria-rowspan={cell.rowSpan} aria-colspan={cell.columnSpan} tabIndex={layout&&sameTableCell(active,address)?0:-1} data-cell={key}
        className={`fw-pptx-table-cell${selected&&!active?' is-object-selected':''}${highlighted.has(key)?' is-selected':''}${editing?' is-editing':''}`} style={{...cellStyle(box,scale),...(!layout&&!editing?{pointerEvents:'none'}:{})}}
        onPointerDown={event=>{if((event.target as Element).closest('textarea')||event.button!==0)return;event.preventDefault();event.stopPropagation();void select(address,event.shiftKey);}}
        onClick={event=>{if(!(event.target as Element).closest('textarea')){event.stopPropagation();void select(address,event.shiftKey);}}}
        onDoubleClick={event=>{if(!(event.target as Element).closest('textarea')){event.stopPropagation();void select(address,false,enabled);}}}>
        {editing?<textarea autoFocus aria-label={`编辑幻灯片表格 ${cell.row+1}:${cell.column+1}`} maxLength={65536} value={value} style={{fontFamily:style.family,fontSize:style.points===undefined?undefined:style.points*scale,fontWeight:style.bold?700:undefined,fontStyle:style.italic?'italic':undefined,textAlign:style.align}}
          onChange={event=>pptx.setTableText(slideId,element.id,address,event.currentTarget.value,cell.text,sourceVersion)}
          onCompositionStart={()=>pptx.setComposing(true)} onCompositionEnd={event=>{pptx.setTableText(slideId,element.id,address,event.currentTarget.value,cell.text,sourceVersion);pptx.setComposing(false);}}
          onBlur={()=>{if(!pptx.composing&&sameTableCell(pptx.elementEditing?.cell,address))void pptx.finishElementText({slideId,elementId:element.id,cell:address});}}
          onKeyDown={event=>{
            if(event.nativeEvent.isComposing||event.keyCode===229||pptx.composing)return;
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(pptx.cancelElementText())focusCell(address);}
            else if((event.key==='Tab'||event.key==='Enter'&&!event.shiftKey)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
              event.preventDefault();event.stopPropagation();const next=moveTableCell(table,address,event.key==='Enter'?'ArrowDown':'Tab',event.shiftKey);void pptx.finishElementText({slideId,elementId:element.id,cell:address}).then(ok=>{if(ok&&mounted.current){void onSelect(next).then(selected=>{if(selected&&mounted.current){setRange({start:next,end:next});focusCell(next);}});}});
            }
          }}/>:<span className="sr-only">{value}</span>}
      </div>;
    })}</div>)}
  </div>;
}
