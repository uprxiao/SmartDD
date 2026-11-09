import { z } from 'zod';

export const browserInputProgressSchema = z.object({
  confirmedChars: z.number().int().nonnegative(),
  inFlight: z.object({ offset: z.number().int().nonnegative(), length: z.number().int().positive() }).optional(),
  observed: z.object({ at: z.string().datetime(), length: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
});
export type BrowserProgress = z.infer<typeof browserInputProgressSchema>;
