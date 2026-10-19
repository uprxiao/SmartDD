import { OFFICE_LIMITS, type OfficeCellText, type OfficeOpenResult, type OfficeSheetWindow } from '@shared/file-office';
import type { OfficeRange } from '@shared/file-office';
import type { FileRef } from '@shared/files';
import { rpc } from '@renderer/lib/ipc';

export class OfficeClient {
  readonly id = crypto.randomUUID();
  readonly ready: Promise<OfficeOpenResult>;
  private closed = false;
  constructor(ref: FileRef, baseHash: string) {
    this.ready = rpc.files.openOffice({ id: this.id, ref, baseHash }).then((value) => { this.assert(); return value; }, (error) => { this.close(); throw error; });
  }
  private assert() { if (this.closed) throw new Error('工作簿已关闭'); }
  async window(sheetId: string, rowIndices: number[], columnIndices: number[]): Promise<OfficeSheetWindow> {
    this.assert(); await this.ready; this.assert();
    const result = await rpc.files.officeWindow({ id: this.id, sheetId, row: rowIndices[0], column: columnIndices[0], rows: rowIndices.length, columns: columnIndices.length, rowIndices, columnIndices });
    this.assert(); return result;
  }
  async cell(sheetId: string, row: number, column: number, start = 0): Promise<OfficeCellText> {
    this.assert(); await this.ready; this.assert();
    const result = await rpc.files.officeCell({ id: this.id, sheetId, row, column, start, length: OFFICE_LIMITS.cellCharacters });
    this.assert(); return result;
  }
  async copy(sheetId: string, row: number, column: number): Promise<void> {
    const text = await this.text(sheetId,row,column);
    this.assert(); await navigator.clipboard.writeText(text);
  }
  async range(sheetId:string,range:OfficeRange,text=false) {
    this.assert();await this.ready;this.assert();const result=await rpc.files.officeRange({id:this.id,sheetId,range,text});this.assert();return result;
  }
  async copyRange(sheetId:string,range:OfficeRange) {const result=await this.range(sheetId,range,true);this.assert();await navigator.clipboard.writeText(result.text!);}
  async text(sheetId:string,row:number,column:number):Promise<string> {
    let text = '', total = -1;
    do {
      const result = await this.cell(sheetId, row, column, text.length);
      if (result.start !== text.length || result.end < result.start || result.end - result.start !== result.text.length || result.total > OFFICE_LIMITS.partBytes || (total >= 0 && total !== result.total) || (result.end === result.start && result.end < result.total)) throw new Error('单元格分块内容不一致');
      total = result.total; text += result.text;
    } while (text.length < total);
    this.assert(); return text;
  }
  close(): void { if (this.closed) return; this.closed = true; void rpc.files.closeOffice(this.id).catch(() => undefined); }
}
