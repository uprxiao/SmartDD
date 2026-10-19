import { z } from 'zod';
import { PPTX_SHAPES } from './file-pptx-elements';

/** Only resolved local properties are reported. Absence is inheritance or an
 * unsupported paint/effect, not a guessed white fill or disabled border. */
export interface PptxAppearance {
  fill?: string|null;
  border?: boolean;
  borderStyle?: 'solid'|'dashed'|'dotted';
  shadow?: boolean;
}
export const pptxAppearanceSchema=z.object({
  fill:z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  border:z.boolean().optional(),
  borderStyle:z.enum(['solid','dashed','dotted']).optional(),
  shadow:z.boolean().optional(),
  shape:z.enum(PPTX_SHAPES).optional(),
}).strict().refine(value=>Object.keys(value).length>0);
export type PptxAppearancePatch=z.infer<typeof pptxAppearanceSchema>;
