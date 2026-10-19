import { pptxAppearanceSchema } from './file-pptx-appearance';
import { z } from 'zod';
import type { OfficePagesInfo } from './file-office-pages';
import type { OfficePagesResult } from './file-office-pages';
import { officeRecalculateSchema, officeHistorySchema, officeSaveSchema, officeRestoreSchema } from './file-office';
import type { FileCheckpointReceipt, FileSaveReceipt } from './files';
import { PPTX_SHAPES } from './file-pptx-elements';
import { pptxTextFormatSchema } from './file-pptx-format';
import type { PptxTableLayout } from './file-pptx-table';
import { pptxImageSchema } from './file-pptx-image';
import { pptxChartValuesSchema,pptxChartOptionsSchema,PPTX_CHARTS } from './file-pptx-chart';
const slideId=z.string().regex(/^\d+$/).max(10);
const elementId=z.string().regex(/^\d+$/).max(10),coordinate=z.number().finite().min(-1000000).max(1000000),extent=z.number().finite().positive().max(1000000);
export const pptxText=z.string().max(65536).refine(value=>![...value].some(char=>{const code=char.codePointAt(0)!;return code<32&&code!==9&&code!==10&&code!==13||code>=0xd800&&code<=0xdfff||code===0xfffe||code===0xffff;}),'文字包含无效 XML 字符');
const tableAddress=z.object({row:z.number().int().min(0).max(65535),column:z.number().int().min(0).max(65535)}).strict();
export const pptxActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('add'),slideId}).strict(),
  z.object({type:z.literal('duplicate'),slideId}).strict(),
  z.object({type:z.literal('delete'),slideId}).strict(),
  z.object({type:z.literal('hidden'),slideId,hidden:z.boolean()}).strict(),
  z.object({type:z.literal('notes'),slideId,text:pptxText}).strict(),
  z.object({type:z.literal('background'),slideId,color:z.string().regex(/^#[a-f0-9]{6}$/i)}).strict(),
  z.object({type:z.literal('insert-element'),slideId,kind:z.enum(['text','shape','table']),shape:z.enum(PPTX_SHAPES).optional()}).strict(),
  z.object({type:z.literal('image-insert'),slideId,image:pptxImageSchema}).strict(),
  z.object({type:z.literal('image-replace'),slideId,elementId,image:pptxImageSchema}).strict(),
  z.object({type:z.literal('chart-values'),slideId,elementId,values:pptxChartValuesSchema}).strict(),
  z.object({type:z.literal('chart-options'),slideId,elementId,patch:pptxChartOptionsSchema}).strict(),
  z.object({type:z.literal('chart-insert'),slideId,chartType:z.enum(PPTX_CHARTS)}).strict(),
  z.object({type:z.literal('chart-type'),slideId,elementId,chartType:z.enum(PPTX_CHARTS)}).strict(),
  z.object({type:z.literal('table-cell'),slideId,elementId,row:z.number().int().min(0).max(65535),column:z.number().int().min(0).max(65535),text:pptxText}).strict(),
  z.object({type:z.literal('table-clear'),slideId,elementId,range:z.object({start:tableAddress,end:tableAddress}).strict()}).strict(),
  z.object({type:z.literal('table-flags'),slideId,elementId,patch:z.object({headerRow:z.boolean().optional(),headerColumn:z.boolean().optional()}).strict().refine(value=>Object.keys(value).length>0)}).strict(),
  z.object({type:z.literal('element-delete'),slideId,elementId}).strict(),
  z.object({type:z.literal('element-text'),slideId,elementId,text:pptxText}).strict(),
  z.object({type:z.literal('element-appearance'),slideId,elementId,patch:pptxAppearanceSchema}).strict(),
  z.object({type:z.literal('element-format'),slideId,elementId,patch:pptxTextFormatSchema}).strict(),
  z.object({type:z.literal('element-transform'),slideId,elementId,patch:z.object({x:coordinate.optional(),y:coordinate.optional(),width:extent.optional(),height:extent.optional(),rotation:z.number().finite().min(-36000).max(36000).optional()}).strict().refine(value=>Object.keys(value).length>0)}).strict(),
  z.object({type:z.literal('element-layer'),slideId,elementId,direction:z.enum(['front','forward','backward','back'])}).strict(),
]);
export type PptxAction=z.infer<typeof pptxActionSchema>;
export interface PptxEditState {version:number;dirty:boolean;canUndo:boolean;canRedo:boolean;protected:boolean;info:OfficePagesInfo}
export const pptxVersionSchema=officeRecalculateSchema;
export const pptxEditSchema=pptxVersionSchema.extend({action:pptxActionSchema});
export const pptxHistorySchema=officeHistorySchema;
// Raw pending input belongs in recovery even when it is not valid XML yet.
export const pptxLegacyPendingSchema=z.object({slideId,elementId:elementId.optional(),text:z.string().max(65536)}).strict();
export const pptxCellTargetSchema=tableAddress;
export const pptxPendingSchema=pptxLegacyPendingSchema.extend({cell:pptxCellTargetSchema.optional(),chartValues:z.literal(true).optional()}).refine(value=>!value.cell&&!value.chartValues||Boolean(value.elementId),'输入缺少对象身份').refine(value=>!value.cell||!value.chartValues,'单元格与图表输入目标冲突');
export const pptxPendingKey=(value:{slideId:string;elementId?:string;cell?:{row:number;column:number};chartValues?:true})=>`${value.slideId}/${value.elementId??'notes'}${value.cell?`/cell/${value.cell.row}:${value.cell.column}`:value.chartValues?'/chart-values':''}`;
export const pptxPendingBatchSchema=z.array(pptxPendingSchema).min(1).max(128).superRefine((values,ctx)=>{
  if(new Set(values.map(pptxPendingKey)).size!==values.length)ctx.addIssue({code:'custom',message:'演示文稿草稿包含重复输入目标'});
  if(new TextEncoder().encode(JSON.stringify(values)).length>768*1024)ctx.addIssue({code:'custom',message:'演示文稿草稿文字超过预算'});
});
export const pptxPendingInputSchema=z.union([pptxPendingSchema,pptxPendingBatchSchema]);
export const pptxCheckpointSchema=pptxVersionSchema.extend({draftId:z.string().uuid(),bufferVersion:z.number().int().nonnegative(),pending:pptxPendingInputSchema.optional()});
export const pptxSaveSchema=officeSaveSchema;
export const pptxRestoreSchema=officeRestoreSchema;
export const pptxRenderSchema=pptxVersionSchema.extend({requestId:z.string().uuid()});
export type PptxVersionInput=z.infer<typeof pptxVersionSchema>;
export type PptxEditInput=z.infer<typeof pptxEditSchema>;
export type PptxHistoryInput=z.infer<typeof pptxHistorySchema>;
export type PptxPending=z.infer<typeof pptxPendingSchema>;
export type PptxPendingInput=z.infer<typeof pptxPendingInputSchema>;
export const pptxPendingInputs=(value?:PptxPendingInput):PptxPending[]=>value?(Array.isArray(value)?value:[value]):[];
export type PptxCheckpointInput=z.infer<typeof pptxCheckpointSchema>;
export type PptxSaveInput=z.infer<typeof pptxSaveSchema>;
export type PptxRestoreInput=z.infer<typeof pptxRestoreSchema>;
export type PptxRenderInput=z.infer<typeof pptxRenderSchema>;
export interface PptxOpenResult {id:string;sourceHash:string;state:PptxEditState}
export interface PptxSaveResult {state:PptxEditState;receipt:FileSaveReceipt;checkpoint:FileCheckpointReceipt;draftError?:string}
export interface PptxRenderResult extends OfficePagesResult {version:number;tableLayout?:PptxTableLayout[];tableLayoutError?:string}
