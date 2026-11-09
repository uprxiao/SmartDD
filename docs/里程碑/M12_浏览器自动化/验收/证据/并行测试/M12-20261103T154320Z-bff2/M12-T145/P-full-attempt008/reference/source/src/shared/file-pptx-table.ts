import type { PptxTextStyle } from './file-pptx-format';
export interface PptxTableCell {
  row:number;column:number;text:string;textStyle:PptxTextStyle;
  rowSpan:number;columnSpan:number;horizontalMerge:boolean;verticalMerge:boolean;
}
export interface PptxTableInfo {
  widths:number[];heights:number[];cells:PptxTableCell[][];
  headerRow:boolean;headerColumn:boolean;styleId?:string;
  /** Zero source heights require layout measurement before placing hit areas. */
  explicitGrid:boolean;
}

/** Native layout projection in page points, separate from editable OOXML. */
export type PptxTablePoint=readonly [number,number];
export interface PptxTableCellLayout {
  row:number;column:number;
  points:readonly [PptxTablePoint,PptxTablePoint,PptxTablePoint,PptxTablePoint];
}
export interface PptxTableLayout {slideId:string;elementId:string;cells:PptxTableCellLayout[]}

export interface PptxTableAddress {row:number;column:number}
export interface PptxTableRange {start:PptxTableAddress;end:PptxTableAddress}
export const pptxTableAnchors=(table:PptxTableInfo)=>table.cells.flat().filter(cell=>!cell.horizontalMerge&&!cell.verticalMerge);
export function pptxTableAnchor(table:PptxTableInfo,address:PptxTableAddress){
  return pptxTableAnchors(table).find(cell=>address.row>=cell.row&&address.row<cell.row+cell.rowSpan&&address.column>=cell.column&&address.column<cell.column+cell.columnSpan);
}
/** A merged cell is selected as a whole whenever the range intersects it. */
export function pptxTableRangeCells(table:PptxTableInfo,range:PptxTableRange){
  const r1=Math.min(range.start.row,range.end.row),r2=Math.max(range.start.row,range.end.row),c1=Math.min(range.start.column,range.end.column),c2=Math.max(range.start.column,range.end.column);
  return pptxTableAnchors(table).filter(cell=>cell.row<=r2&&cell.row+cell.rowSpan>r1&&cell.column<=c2&&cell.column+cell.columnSpan>c1);
}
