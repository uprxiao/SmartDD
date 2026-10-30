import { FileError } from '@shared/files';
import { OFFICE_LIMITS,officeRangeSchema,type OfficeRange,type OfficeRangeContent } from '@shared/file-office';
import type { OfficeWorkbook } from './workbook';

export const rangeContains=(range:OfficeRange,row:number,column:number)=>row>=range.firstRow && row<=range.lastRow && column>=range.firstColumn && column<=range.lastColumn;
export const rangesIntersect=(a:OfficeRange,b:OfficeRange)=>a.firstRow<=b.lastRow && a.lastRow>=b.firstRow && a.firstColumn<=b.lastColumn && a.lastColumn>=b.firstColumn;
export function subtractOfficeRange(source:OfficeRange,cut:OfficeRange):OfficeRange[] {
  if(!rangesIntersect(source,cut))return [source];
  const top=Math.max(source.firstRow,cut.firstRow),bottom=Math.min(source.lastRow,cut.lastRow),left=Math.max(source.firstColumn,cut.firstColumn),right=Math.min(source.lastColumn,cut.lastColumn),result:OfficeRange[]=[];
  if(source.firstRow<top)result.push({...source,lastRow:top-1});if(bottom<source.lastRow)result.push({...source,firstRow:bottom+1});
  if(source.firstColumn<left)result.push({firstRow:top,lastRow:bottom,firstColumn:source.firstColumn,lastColumn:left-1});if(right<source.lastColumn)result.push({firstRow:top,lastRow:bottom,firstColumn:right+1,lastColumn:source.lastColumn});return result;
}
export function checkOfficeRange(input:OfficeRange):OfficeRange {
  const range=officeRangeSchema.parse(input);
  if((range.lastRow-range.firstRow+1)*(range.lastColumn-range.firstColumn+1)>OFFICE_LIMITS.rangeCells)throw new FileError('TOO_LARGE','此选区超过单次 10000 个单元格的处理预算，请缩小选区');
  return range;
}
export function readOfficeRange(model:OfficeWorkbook,sheetId:string,input:OfficeRange,text:boolean):OfficeRangeContent {
  const range=checkOfficeRange(input),rows:string[]=[];let count=0,numericCount=0,sum=0,bytes=0;
  for(let row=range.firstRow;row<=range.lastRow;row++) {
    const fields:string[]=[];
    for(let column=range.firstColumn;column<=range.lastColumn;column++) {
      const cell=model.cell(sheetId,row,column);if(cell.value !== '' || cell.formula)count++;
      if(cell.type === 'number' && cell.value !== '' && Number.isFinite(Number(cell.value))) {numericCount++;sum+=Number(cell.value);}
      if(text) {
        const value=cell.formula ? `=${cell.formula.text}` : cell.value,encoded=/[\t\r\n"]/.test(value) ? `"${value.replaceAll('"','""')}"` : value;
        bytes+=Buffer.byteLength(encoded,'utf8')+(column>range.firstColumn || row>range.firstRow ? 1 : 0);if(bytes>OFFICE_LIMITS.rangeTextBytes)throw new FileError('TOO_LARGE','选区文字超过 8 MiB 复制预算，请缩小选区');fields.push(encoded);
      }
    }
    if(text)rows.push(fields.join('\t'));
  }
  return {count,numericCount,...(Number.isFinite(sum) && numericCount ? {sum,average:sum/numericCount} : {}),...(text ? {text:rows.join('\n')} : {})};
}
