import { z } from 'zod';
export interface PptxTextStyle {
  family?:string;points?:number;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;color?:string;
  align?:'left'|'center'|'right'|'justify';list?:'none'|'bullet'|'number';mixed?:string[];
}
export const pptxTextFormatSchema=z.object({
  font:z.object({
    family:z.string().min(1).max(128).refine(value=>![...value].some(char=>{const code=char.codePointAt(0)!;return code<32||code===127||code>=0xd800&&code<=0xdfff||code===0xfffe||code===0xffff;})).nullable().optional(),
    points:z.number().finite().min(1).max(4000).optional(),bold:z.boolean().optional(),italic:z.boolean().optional(),underline:z.boolean().optional(),strike:z.boolean().optional(),color:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }).strict().refine(value=>Object.keys(value).length>0).optional(),
  align:z.enum(['left','center','right','justify']).optional(),list:z.enum(['none','bullet','number']).optional(),
}).strict().refine(value=>Object.keys(value).length>0);
export type PptxTextFormat=z.infer<typeof pptxTextFormatSchema>;
