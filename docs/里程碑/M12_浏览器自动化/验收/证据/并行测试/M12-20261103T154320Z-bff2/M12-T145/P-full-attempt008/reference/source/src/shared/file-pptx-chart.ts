import { z } from 'zod';

export const pptxChartValuesSchema=z.array(z.number().finite().nonnegative()).min(1).max(8);
export const PPTX_BASIC_CHARTS=['bar','line','pie','area','scatter'] as const;
export type PptxBasicChart=typeof PPTX_BASIC_CHARTS[number];
export const PPTX_MODERN_CHARTS=['histogram','waterfall','funnel','treemap'] as const;
export type PptxModernChart=typeof PPTX_MODERN_CHARTS[number];
export const PPTX_CHARTS=[...PPTX_BASIC_CHARTS,...PPTX_MODERN_CHARTS] as const;
export type PptxChartType=typeof PPTX_CHARTS[number];
export const isModernPptxChart=(type:PptxChartType):type is PptxModernChart=>(PPTX_MODERN_CHARTS as readonly string[]).includes(type);
export const pptxChartOptionsSchema=z.object({axes:z.boolean().optional(),gridLines:z.boolean().optional(),legend:z.boolean().optional()}).strict().refine(value=>Object.keys(value).length>0);
export type PptxChartOptions=z.infer<typeof pptxChartOptionsSchema>;
export function parsePptxChartValues(text:string):number[]{
  const parts=text.split(',').map(value=>value.trim());
  if(parts.some(value=>!value||!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)))throw new Error('图表数据请输入以逗号分隔的非负数值');
  const parsed=pptxChartValuesSchema.safeParse(parts.map(Number));
  if(!parsed.success)throw new Error('图表数据需为 1–8 个有限非负数值');return parsed.data;
}
export interface PptxChartInfo {
  type?:PptxBasicChart|PptxModernChart;
  values?:number[];
  editableValues:boolean;
  options?:{axes:boolean;gridLines:boolean;legend:boolean;hasAxes:boolean};
  reason?:string;
}
