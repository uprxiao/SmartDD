import { z } from 'zod';

export const PPTX_IMAGE_LIMIT = 20 * 1024 * 1024;
export const pptxImageSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().min(4).max(Math.ceil(PPTX_IMAGE_LIMIT / 3) * 4),
}).strict();
export type PptxImageInput = z.infer<typeof pptxImageSchema>;
