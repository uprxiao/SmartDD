import { pptxTableAnchor,pptxTableAnchors,type PptxTableAddress,type PptxTableInfo } from '@shared/file-pptx-table';

export const sameTableCell=(a:PptxTableAddress|undefined,b:PptxTableAddress|undefined)=>a?.row===b?.row&&a?.column===b?.column;
export function moveTableCell(table:PptxTableInfo,address:PptxTableAddress,key:string,reverse=false):PptxTableAddress{
  const cell=pptxTableAnchor(table,address);if(!cell)return address;
  const anchors=pptxTableAnchors(table);let next;
  if(key==='Tab')next=anchors[Math.max(0,Math.min(anchors.length-1,anchors.indexOf(cell)+(reverse?-1:1)))];
  else{
    const row=key==='ArrowUp'?cell.row-1:key==='ArrowDown'?cell.row+cell.rowSpan:cell.row;
    const column=key==='ArrowLeft'?cell.column-1:key==='ArrowRight'?cell.column+cell.columnSpan:cell.column;
    next=pptxTableAnchor(table,{row,column});
  }
  return next?{row:next.row,column:next.column}:{row:cell.row,column:cell.column};
}
