import { FileError } from '@shared/files';
import type { PptxElementInfo } from '@shared/file-pptx-elements';
import type { PptxTableLayout } from '@shared/file-pptx-table';

/** Convert same-version native row boundaries to source units only when the
 * coordinate relationship is established. A fully merged hidden boundary or
 * an unadapted group/rotation cannot be reconstructed by guessing equal rows. */
export function measuredPptxRows(element:PptxElementInfo,layout:PptxTableLayout):number[]{
  const fail=():never=>{throw new FileError('UNSUPPORTED','表格行边界尚不能完整对应源尺寸，未调整高度');};
  const table=element.table,box=element.box;
  if(!table||!box||element.parentId||box.rotation!==0||box.flipH||box.flipV)fail();
  const rows=table!.cells.length,boundaries=new Map<number,number>();
  const put=(row:number,value:number)=>{
    if(!Number.isFinite(value)||row<0||row>rows)fail();const old=boundaries.get(row);
    if(old!==undefined&&Math.abs(old-value)>.1)fail();if(old===undefined)boundaries.set(row,value);
  };
  for(const cell of layout.cells){
    const entry=table!.cells[cell.row]?.[cell.column];if(!entry||entry.horizontalMerge||entry.verticalMerge)fail();
    const [a,b,c,d]=cell.points;
    if(Math.abs(a[1]-b[1])>.1||Math.abs(d[1]-c[1])>.1||Math.abs(a[0]-d[0])>.1||Math.abs(b[0]-c[0])>.1||b[0]<=a[0]||d[1]<=a[1])fail();
    put(cell.row,a[1]);put(cell.row+entry.rowSpan,d[1]);
  }
  if(boundaries.size!==rows+1)fail();
  return Array.from({length:rows},(_,row)=>{
    const height=boundaries.get(row+1)!-boundaries.get(row)!;
    if(!Number.isFinite(height)||height<=0||height>1000000)fail();return height;
  });
}
