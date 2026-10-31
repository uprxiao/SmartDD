import { z } from 'zod';

// Display-relative positions survive zoom/DPR changes. They describe context;
// an opaque prepared source still grants every file/terminal operation.
export const terminalPdfContextSchema = z.object({
  page: z.number().int().min(1).max(1_000_000),
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict()
    .refine(rect => rect.x + rect.width <= 1 + Number.EPSILON * 4 && rect.y + rect.height <= 1 + Number.EPSILON * 4 && (rect.width === 0 && rect.height === 0 || rect.width > 0 && rect.height > 0), 'PDF 区域超出页面或无效'),
}).strict();

export function formatPdfReferenceLocation(value) {
  const { page, anchor } = terminalPdfContextSchema.parse(value);
  const percentage = number => `${Number((number * 100).toFixed(2))}%`;
  return `第 ${page} 页 · ${anchor.width || anchor.height ? '区域' : '位置'} ${[anchor.x, anchor.y, anchor.width, anchor.height].map(percentage).join(', ')}`;
}
