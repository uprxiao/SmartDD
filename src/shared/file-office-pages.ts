import type { OfficeOpenInput } from './file-office';
import type { PptxElementInfo } from './file-pptx-elements';
export type OfficePagesOpenInput=OfficeOpenInput;
export interface DocxSourceResult { id:string; sourceHash:string; bytes:number; info:OfficePagesInfo }
export interface OfficeSlideInfo { id:string; title:string; hidden:boolean; notes:string; background?:string; elements?:PptxElementInfo[] }
export interface OfficePagesInfo {
  kind:'docx'|'pptx'; signed:boolean; externalLinks:number; hasRevisions:boolean;
  slides:OfficeSlideInfo[]; width?:number; height?:number;
  unsupportedCharts?:string[];
}
export interface OfficePagesResult {
  id:string; sourceHash:string; info:OfficePagesInfo;
  hash:string; bytes:number; pages:number; elapsedMs:number; warnings:string[];
}
