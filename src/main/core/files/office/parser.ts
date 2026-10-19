import { OfficeWorkerClient } from './worker-client';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS, type OfficeWorkbookInfo, type OfficeSheetWindow, type OfficeCellText, type OfficeCellEdit, type OfficeEditState, type OfficeFormulaValidation, type OfficeSheetAction, type OfficeSheetResult } from '@shared/file-office';
import type { OfficeRangeAction,OfficeRange,OfficeRangeContent } from '@shared/file-office';
import type {OfficeMeasureInput,OfficeMeasureResult} from '@shared/office-measure';

/** Spreadsheet document protocol over the shared bounded Worker lifetime. */
export class OfficeParser extends OfficeWorkerClient {
  open(bytes: Uint8Array, hash: string, signal: AbortSignal): Promise<OfficeWorkbookInfo> {
    if (bytes.byteLength > OFFICE_LIMITS.inputBytes) return Promise.reject(new FileError('TOO_LARGE', 'Office 文件超过 40 MiB'));
    return this.request({ method: 'open', bytes, hash }, signal);
  }
  window(sheetId: string, row: number, column: number, rows: number, columns: number, signal: AbortSignal, rowIndices?: number[], columnIndices?: number[]): Promise<OfficeSheetWindow> { return this.request({ method: 'window', sheetId, row, column, rows, columns, ...(rowIndices ? { rowIndices } : {}), ...(columnIndices ? { columnIndices } : {}) }, signal); }
  cell(sheetId: string, row: number, column: number, start: number, length: number, signal: AbortSignal): Promise<OfficeCellText> { return this.request({ method: 'cell', sheetId, row, column, start, length }, signal); }
  prepareCalculation(signal: AbortSignal): Promise<{ bytes: Uint8Array; hash: string; formulas: number } | null> { return this.request({ method: 'prepareCalculation' }, signal); }
  applyCalculation(bytes: Uint8Array, inputHash: string, signal: AbortSignal): Promise<OfficeWorkbookInfo> { return this.request({ method: 'applyCalculation', bytes, inputHash }, signal); }
  state(signal: AbortSignal): Promise<OfficeEditState> { return this.request({ method: 'state' }, signal); }
  validationFormulas(version:number,signal:AbortSignal):Promise<OfficeFormulaValidation[]> { return this.request({method:'validationFormulas',version},signal); }
  edit(version: number, edit: OfficeCellEdit, signal: AbortSignal): Promise<OfficeEditState> { return this.request({ method: 'edit', version, edit }, signal); }
  sheetAction(version:number,action:OfficeSheetAction,signal:AbortSignal):Promise<OfficeSheetResult> { return this.request({method:'sheetAction',version,action},signal); }
  range(sheetId:string,range:OfficeRange,text:boolean,signal:AbortSignal):Promise<OfficeRangeContent> {return this.request({method:'range',sheetId,range,text},signal);}
  fontMetric(metric:NonNullable<OfficeWorkbookInfo['fontMetric']>,signal:AbortSignal):Promise<OfficeWorkbookInfo> {return this.request({method:'fontMetric',metric},signal);}
  prepareFit(version:number,action:OfficeRangeAction,signal:AbortSignal):Promise<OfficeMeasureInput> {return this.request({method:'prepareFit',version,action},signal);}
  prepareRange(version:number,action:OfficeRangeAction,signal:AbortSignal,measured?:OfficeMeasureResult):Promise<{token:string;formulas:OfficeFormulaValidation[];bytes?:Uint8Array}> {return this.request({method:'prepareRange',version,action,...(measured ? {measured} : {})},signal);}
  commitRange(version:number,token:string,signal:AbortSignal):Promise<OfficeEditState> {return this.request({method:'commitRange',version,token},signal);}
  cancelRange(token:string,signal:AbortSignal):Promise<void> {return this.request({method:'cancelRange',token},signal);}
  history(version: number, direction: 'undo' | 'redo', signal: AbortSignal): Promise<OfficeEditState> { return this.request({ method: 'history', version, direction }, signal); }
  materialize(version: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; hash: string; version: number }> { return this.request({ method: 'materialize', version }, signal); }
  acknowledge(version: number, hash: string, signal: AbortSignal): Promise<OfficeEditState> { return this.request({ method: 'acknowledge', version, hash }, signal); }
  restore(version: number, bytes: Uint8Array, signal: AbortSignal): Promise<OfficeEditState> { return this.request({ method: 'restore', version, bytes }, signal); }
}
