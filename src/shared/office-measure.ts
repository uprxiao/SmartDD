import { z } from 'zod';

// Private main/Worker/native protocol. Renderers cannot submit fonts or sizes.
export const officeMeasureFontSchema=z.object({family:z.string().min(1).max(256).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)),points:z.number().min(1).max(409),bold:z.boolean(),italic:z.boolean()}).strict();
export const officeMeasureInputSchema=z.object({
  normalFont:officeMeasureFontSchema,
  items:z.array(z.object({runs:z.array(z.object({text:z.string().max(32767),font:officeMeasureFontSchema}).strict()).min(1).max(8192),widths:z.array(z.number().min(0).max(255)).min(1).max(16384),wrap:z.boolean(),indent:z.number().int().min(0).max(250),rotation:z.number().int().min(0).max(180)}).strict()).max(10000),
}).strict();
export const officeMeasureResultSchema=z.object({digitWidth:z.number().int().min(1).max(1024),lineHeight:z.number().positive().max(10000),items:z.array(z.object({width:z.number().nonnegative().max(1_000_000),height:z.number().positive().max(1_000_000)}).strict()).max(10000),fonts:z.array(z.string().max(256)).max(512)}).strict();
export type OfficeMeasureFont=z.infer<typeof officeMeasureFontSchema>;
export type OfficeMeasureInput=z.infer<typeof officeMeasureInputSchema>;
export type OfficeMeasureResult=z.infer<typeof officeMeasureResultSchema>;

/** OOXML col.width includes padding in Normal-font maximum-digit units. */
export function officeColumnPixels(width:number,digitWidth:number):number {
  return Math.floor((256*width+Math.floor(128/digitWidth))/256*digitWidth);
}
export function officeColumnUnits(pixels:number,digitWidth:number):number {
  // Round upward to a representable width that cannot clip the measured text.
  return Math.ceil(Math.ceil(pixels)*256/digitWidth-Math.floor(128/digitWidth))/256;
}
