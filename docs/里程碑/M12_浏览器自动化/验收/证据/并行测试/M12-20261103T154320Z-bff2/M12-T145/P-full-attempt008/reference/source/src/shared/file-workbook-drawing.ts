import {z} from 'zod';
import {pptxImageSchema} from './file-pptx-image';

/** The default custom workbook toolbar. Extended chart types remain a separate
 * capability; this list does not enable a provider or claim arbitrary OOXML. */
export const WORKBOOK_CHARTS=['bar','line','pie','area','scatter'] as const;
export const WORKBOOK_SHAPES=['ellipse','rect','triangle','diamond','star5','rightArrow','leftArrow','plus','chevron','wedgeRoundRectCallout','line','lineInv'] as const;
export type WorkbookShape=typeof WORKBOOK_SHAPES[number];
export const workbookTextFrameSchema=z.object({x:z.number().finite().min(0).max(100000000),y:z.number().finite().min(0).max(100000000),width:z.number().finite().min(1).max(100000),height:z.number().finite().min(1).max(100000)}).strict();
export const workbookTextEditSchema=z.object({sheetId:z.string().min(1).max(64),objectId:z.string().regex(/^[a-f0-9]{64}$/),text:z.string().max(32767)}).strict();
export type WorkbookTextEdit=z.infer<typeof workbookTextEditSchema>;
export const workbookDrawingSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('shape'),shape:z.enum(WORKBOOK_SHAPES)}).strict(),
  z.object({kind:z.literal('chart'),chartType:z.enum(WORKBOOK_CHARTS)}).strict(),
  z.object({kind:z.literal('image'),image:pptxImageSchema}).strict(),
  z.object({kind:z.literal('text'),frame:workbookTextFrameSchema,autoSize:z.boolean()}).strict(),
]);
export type WorkbookDrawing=z.infer<typeof workbookDrawingSchema>;
