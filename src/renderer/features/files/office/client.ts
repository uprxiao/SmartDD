import { OFFICE_LIMITS, type OfficeCellText, type OfficeOpenResult, type OfficeSheetWindow,type OfficeDrawingImageData } from '@shared/file-office';
import type { OfficeRange } from '@shared/file-office';
import type { FileRef } from '@shared/files';
import { rpc } from '@renderer/lib/ipc';

export class OfficeClient {
  readonly id = crypto.randomUUID();
  readonly ready: Promise<OfficeOpenResult>;
  private closed = false;
  private retiring = false;
  private readonly reads = new Set<Promise<unknown>>();
  private imageQueue:Promise<unknown>=Promise.resolve();
  constructor(private ref: FileRef, private readonly baseHash: string) {
    this.ref={...ref};
    this.ready = rpc.files.openOffice({ id: this.id, ref, baseHash }).then((value) => { this.assert(); return value; }, (error) => { this.close(); throw error; });
  }
  owns(ref: FileRef, baseHash?: string): boolean {
    return !this.closed && !this.retiring && (baseHash===undefined || this.baseHash===baseHash) && this.ref.id === ref.id && this.ref.lease === ref.lease && this.ref.generation === ref.generation;
  }
  private assert() { if (this.closed) throw new Error('工作簿已关闭'); }
  private read<T>(operation:()=>Promise<T>):Promise<T> {
    this.assert();if(this.retiring)throw new Error('工作簿已关闭');
    const pending=operation();this.reads.add(pending);
    void pending.then(()=>this.reads.delete(pending),()=>this.reads.delete(pending));
    return pending;
  }
  async window(sheetId: string, rowIndices: number[], columnIndices: number[]): Promise<OfficeSheetWindow> {
    return this.read(async()=>{this.assert(); await this.ready; this.assert();
    const result = await rpc.files.officeWindow({ id: this.id, sheetId, row: rowIndices[0], column: columnIndices[0], rows: rowIndices.length, columns: columnIndices.length, rowIndices, columnIndices });
    this.assert(); return result;});
  }
  async drawingImage(sheetId:string,objectId:string,mediaHash:string):Promise<OfficeDrawingImageData> {
    return this.read(()=>{
      const pending=this.imageQueue.catch(()=>undefined).then(async()=>{
        this.assert();await this.ready;this.assert();
        const result=await rpc.files.officeDrawingImage({id:this.id,sheetId,objectId,mediaHash});
        this.assert();
        if(result.id!==objectId || result.sha256!==mediaHash || !['image/png','image/jpeg'].includes(result.mime) || !(result.bytes instanceof Uint8Array) || !result.bytes.length || result.bytes.length>OFFICE_LIMITS.drawingImageBytes)throw new Error('绘图图片回执与当前对象不一致');
        return result;
      });
      this.imageQueue=pending;return pending;
    });
  }
  async cell(sheetId: string, row: number, column: number, start = 0): Promise<OfficeCellText> {
    return this.read(()=>this.cellPart(sheetId,row,column,start));
  }
  private async cellPart(sheetId: string, row: number, column: number, start = 0): Promise<OfficeCellText> {
    this.assert(); await this.ready; this.assert();
    const result = await rpc.files.officeCell({ id: this.id, sheetId, row, column, start, length: OFFICE_LIMITS.cellCharacters });
    this.assert(); return result;
  }
  async copy(sheetId: string, row: number, column: number): Promise<void> {
    const text = await this.text(sheetId,row,column);
    this.assert(); await navigator.clipboard.writeText(text);
  }
  async range(sheetId:string,range:OfficeRange,text=false) {
    return this.read(async()=>{this.assert();await this.ready;this.assert();const result=await rpc.files.officeRange({id:this.id,sheetId,range,text});this.assert();return result;});
  }
  async copyRange(sheetId:string,range:OfficeRange) {const result=await this.range(sheetId,range,true);this.assert();await navigator.clipboard.writeText(result.text!);}
  async text(sheetId:string,row:number,column:number):Promise<string> {
    return this.read(async()=>{
    let text = '', total = -1;
    do {
      const result = await this.cellPart(sheetId, row, column, text.length);
      if (result.start !== text.length || result.end < result.start || result.end - result.start !== result.text.length || result.total > OFFICE_LIMITS.partBytes || (total >= 0 && total !== result.total) || (result.end === result.start && result.end < result.total)) throw new Error('单元格分块内容不一致');
      total = result.total; text += result.text;
    } while (text.length < total);
    this.assert(); return text;});
  }
  /** A successful candidate owns new reads immediately. Already-issued reads
   * finish against their original model before its native lifetime ends. */
  async retire():Promise<void> {
    if(this.closed)return;this.retiring=true;
    await Promise.allSettled([...this.reads]);this.close();
  }
  async reconnect(ref:FileRef,version:number) {
    this.assert();const result=await rpc.files.reconnectOffice({id:this.id,version,ref});
    // The main model now belongs to this ref even if a later metadata refresh
    // finds its root withdrawn. Keep the lifetime until another retry/close.
    this.ref={...result.document.ref};this.assert();return result;
  }
  close(): void { if (this.closed) return; this.closed = true; void rpc.files.closeOffice(this.id).catch(() => undefined); }
}
