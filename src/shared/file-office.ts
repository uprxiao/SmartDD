import { z } from 'zod';
import { fileRefSchema, type FileCheckpointReceipt, type FileSaveReceipt } from './files';
import type { OfficeMeasureFont } from './office-measure';

/** Office budgets are independent of the text editor's byte limit. Parsing and
 * materialisation run in a disposable Worker; engine jobs use the shared queue. */
export const OFFICE_LIMITS = Object.freeze({
  inputBytes: 40 * 1024 * 1024,
  outputBytes: 40 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  partBytes: 64 * 1024 * 1024,
  parts: 8192,
  xmlNodes: 500_000,
  xmlDepth: 128,
  parseMs: 15_000,
  workerHeapMiB: 512,
  formulaMs: 20_000,
  formulaHeapMiB: 512,
  formulaRssBytes: 768 * 1024 * 1024,
  windowRows: 100,
  windowColumns: 40,
  cellCharacters: 16_384,
  windowCharacters: 262_144,
  windowRuns:8192,
  sessions: 4,
  historyBytes: 64 * 1024 * 1024,
  historyEntries: 200,
  validationFormulas: 10_000,
  validationBytes: 8 * 1024 * 1024,
  rangeCells: 10_000,
  rangeTextBytes: 8 * 1024 * 1024,
});

export type OfficeKind = 'xlsx' | 'xlsm' | 'docx' | 'pptx';
export interface OfficePartPlan {
  changed: readonly string[];
  added: readonly string[];
  removed: readonly string[];
}
export interface OfficeCell {
  address: string; row: number; column: number;
  type: 'blank' | 'string' | 'number' | 'boolean' | 'error' | 'date';
  value: string; formula?: { text: string; type: string; sharedId?: string; range?: string };
  style: number;
  validation?:'number'|'custom';
  conditional?:{threshold?:number;fill?:string;custom?:boolean;unsupported?:boolean};
  runs?:{text:string;font?:OfficeCellStyle['font']}[];
}
export interface OfficeRange { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number }
export interface OfficeFormCheckbox {
  id:string;label:string;checked:boolean;linked:{row:number;column:number};
  from:{row:number;column:number;x:number;y:number};to:{row:number;column:number;x:number;y:number};
  reason?:string;
}
export const officeRangeSchema=z.object({firstRow:z.number().int().min(0).max(1048575),lastRow:z.number().int().min(0).max(1048575),firstColumn:z.number().int().min(0).max(16383),lastColumn:z.number().int().min(0).max(16383)}).strict().refine(value=>value.firstRow<=value.lastRow && value.firstColumn<=value.lastColumn,'选区方向无效');
export const officeFormatSchema=z.object({
  font:z.object({family:z.string().min(1).max(256).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)).optional(),points:z.number().min(1).max(409).optional(),bold:z.boolean().optional(),italic:z.boolean().optional(),underline:z.boolean().optional(),strike:z.boolean().optional(),color:z.string().regex(/^#[0-9a-f]{6}$/i).optional()}).strict().optional(),
  fill:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  alignment:z.object({horizontal:z.enum(['left','center','right']).optional(),wrap:z.boolean().optional()}).strict().optional(),
  border:z.boolean().optional(),numberFormat:z.enum(['general','number','currency','percent']).optional(),decimals:z.number().int().min(0).max(6).optional(),
}).strict().refine(value=>Object.values(value).some(item=>typeof item !== 'object' || Object.keys(item).length>0),'没有指定格式变化');
export type OfficeFormatPatch=z.infer<typeof officeFormatSchema>;
export const officeRangeActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('checkbox'),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('conditional'),value:z.number().finite().nullable(),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('validation'),value:z.enum(['number','none']),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('fit'),axis:z.enum(['row','column']),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('format'),sheetId:z.string().min(1).max(64),range:officeRangeSchema,format:officeFormatSchema}).strict(),
  z.object({type:z.literal('clear'),mode:z.enum(['contents','format','all']),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('fill'),direction:z.enum(['down','right']),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('merge'),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
  z.object({type:z.literal('unmerge'),sheetId:z.string().min(1).max(64),range:officeRangeSchema}).strict(),
]);
export type OfficeRangeAction=z.infer<typeof officeRangeActionSchema>;
export interface OfficeRangeContent {text?:string;count:number;numericCount:number;sum?:number;average?:number}
export interface OfficeCellStyle {
  font?: { family?: string; points?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string };
  fill?: string;
  alignment?: { horizontal?: 'left' | 'center' | 'right' | 'justify'; vertical?: 'top' | 'center' | 'bottom'; wrap?: boolean; indent?: number; rotation?: number; shrink?: boolean };
  borders?: Partial<Record<'left' | 'right' | 'top' | 'bottom', { style: string; color: string }>>;
  numberFormat: string | number;
}
export interface OfficeSheet {
  id: string; name: string; hidden: 'visible' | 'hidden' | 'veryHidden';
  rows: number; columns: number; protected: boolean;
  defaultRowHeight: number; defaultColumnWidth: number;
  rowSizes: { index: number; pixels: number }[];
  columnSizes: { first: number; last: number; pixels: number }[];
}
export interface OfficeWorkbookInfo {
  kind: 'xlsx' | 'xlsm'; sheets: OfficeSheet[]; date1904: boolean; signed: boolean;
  externalLinks: number; protected: boolean;
  normalFont?:OfficeMeasureFont;
  fontMetric?:{digitWidth:number;measured:boolean;message?:string};
}
export interface OfficeSheetWindow {
  sheetId: string; startRow: number; startColumn: number; rows: number; columns: number;
  rowIndices: number[]; columnIndices: number[];
  cells: (OfficeCell & { display: string; truncated: boolean })[]; merges: OfficeRange[];
  styles: Record<number, OfficeCellStyle>;
  checkboxes?:OfficeFormCheckbox[];
  controlsWarning?:string;
}
export interface OfficeCellText { address: string; text: string; formula: boolean; start: number; end: number; total: number }
export interface OfficeEditState { version: number; dirty: boolean; canUndo: boolean; canRedo: boolean; workbook: OfficeWorkbookInfo }
export const officeCellEditSchema = z.object({ sheetId: z.string().min(1).max(64), row: z.number().int().min(0).max(1048575), column: z.number().int().min(0).max(16383), text: z.string().max(32767) }).strict();
export type OfficeCellEdit = z.infer<typeof officeCellEditSchema>;
export const officeSheetActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('add')}).strict(),
  z.object({type:z.literal('move'),sheetId:z.string().min(1).max(64),index:z.number().int().min(0).max(65535)}).strict(),
  z.object({type:z.literal('rename'),sheetId:z.string().min(1).max(64),name:z.string().min(1).max(31)}).strict(),
  z.object({type:z.literal('delete'),sheetId:z.string().min(1).max(64)}).strict(),
]);
export type OfficeSheetAction=z.infer<typeof officeSheetActionSchema>;
/** Internal, bounded requests to the fixed formula parser; never arbitrary code. */
export const officeFormulaValidationSchema = z.object({ sheetIndex:z.number().int().min(0).max(65535), row:z.number().int().min(0).max(1048575), formula:z.string().min(1).max(8192) }).strict();
export type OfficeFormulaValidation = z.infer<typeof officeFormulaValidationSchema>;

export const officeOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const officeWindowSchema = z.object({ id: z.string().uuid(), sheetId: z.string().min(1).max(64), row: z.number().int().min(0).max(1048575), column: z.number().int().min(0).max(16383), rows: z.number().int().min(1).max(OFFICE_LIMITS.windowRows), columns: z.number().int().min(1).max(OFFICE_LIMITS.windowColumns), rowIndices: z.array(z.number().int().min(0).max(1048575)).min(1).max(OFFICE_LIMITS.windowRows).optional(), columnIndices: z.array(z.number().int().min(0).max(16383)).min(1).max(OFFICE_LIMITS.windowColumns).optional() }).strict();
export const officeCellSchema = officeWindowSchema.omit({ rows: true, columns: true, rowIndices: true, columnIndices: true }).extend({ start: z.number().int().nonnegative(), length: z.number().int().min(1).max(OFFICE_LIMITS.cellCharacters) });
export type OfficeOpenInput = z.infer<typeof officeOpenSchema>;
export type OfficeWindowInput = z.infer<typeof officeWindowSchema>;
export type OfficeCellInput = z.infer<typeof officeCellSchema>;
export interface OfficeCalculationState { state: 'ready' | 'cached'; message?: string }
export interface OfficeOpenResult { id: string; hash: string; workbook: OfficeWorkbookInfo; state: OfficeEditState; calculation?: OfficeCalculationState }
const officeVersion = z.object({ id:z.string().uuid(), version:z.number().int().nonnegative() }).strict();
export const officeEditSchema = officeVersion.extend({ edit:officeCellEditSchema });
export const officeHistorySchema = officeVersion.extend({ direction:z.enum(['undo','redo']) });
export const officeSheetSchema=officeVersion.extend({action:officeSheetActionSchema});
export const officeRangeInputSchema=officeVersion.extend({action:officeRangeActionSchema});
export type OfficeRangeInput=z.infer<typeof officeRangeInputSchema>;
export const officeRangeReadSchema=z.object({id:z.string().uuid(),sheetId:z.string().min(1).max(64),range:officeRangeSchema,text:z.boolean().default(false)}).strict();
export type OfficeRangeReadInput=z.infer<typeof officeRangeReadSchema>;
export type OfficeSheetInput=z.infer<typeof officeSheetSchema>;
export const officeCheckpointSchema = officeVersion.extend({ draftId:z.string().uuid(), bufferVersion:z.number().int().nonnegative(), pending:officeCellEditSchema.optional() });
export const officeSaveSchema = officeCheckpointSchema.omit({pending:true}).extend({ opId:z.string().uuid() });
export const officeRestoreSchema = officeVersion.extend({ draftId:z.string().uuid() });
export const officeRecalculateSchema = officeVersion;
export type OfficeEditInput = z.infer<typeof officeEditSchema>;
export type OfficeHistoryInput = z.infer<typeof officeHistorySchema>;
export type OfficeCheckpointInput = z.infer<typeof officeCheckpointSchema>;
export type OfficeSaveInput = z.infer<typeof officeSaveSchema>;
export type OfficeRestoreInput = z.infer<typeof officeRestoreSchema>;
export type OfficeRecalculateInput = z.infer<typeof officeRecalculateSchema>;
export interface OfficeMutationResult { state:OfficeEditState; calculation?:OfficeCalculationState }
export interface OfficeSheetResult extends OfficeMutationResult { sheetId:string }
export interface OfficeSaveResult extends OfficeMutationResult { receipt:FileSaveReceipt; checkpoint:FileCheckpointReceipt; draftError?:string }
