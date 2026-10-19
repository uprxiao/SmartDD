import { describe,it,expect } from 'vitest';
import type { PptxTableInfo } from '@shared/file-pptx-table';
import { pptxTableRangeCells } from '@shared/file-pptx-table';
import { moveTableCell } from './pptx-table-selection';
describe('merged PPTX table selection',()=>{
  it('moves between anchors, includes intersecting merges and clamps without creating rows',()=>{
    const table:PptxTableInfo={widths:[20,30,40],heights:[10,20,30],headerRow:false,headerColumn:false,explicitGrid:true,cells:Array.from({length:3},(_,row)=>Array.from({length:3},(_,column)=>({row,column,text:'',textStyle:{},rowSpan:1,columnSpan:1,horizontalMerge:false,verticalMerge:false})))};
    table.cells[0][0].columnSpan=2;table.cells[0][1].horizontalMerge=true;table.cells[1][2].rowSpan=2;table.cells[2][2].verticalMerge=true;
    expect(moveTableCell(table,{row:0,column:0},'ArrowRight')).toEqual({row:0,column:2});expect(moveTableCell(table,{row:0,column:2},'ArrowLeft')).toEqual({row:0,column:0});
    expect(moveTableCell(table,{row:1,column:2},'ArrowDown')).toEqual({row:1,column:2});expect(moveTableCell(table,{row:2,column:1},'Tab')).toEqual({row:2,column:1});
    expect(moveTableCell(table,{row:0,column:2},'Tab',true)).toEqual({row:0,column:0});expect(pptxTableRangeCells(table,{start:{row:0,column:1},end:{row:0,column:2}}).map(cell=>cell.column)).toEqual([0,2]);
  });
});
