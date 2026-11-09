import { z } from 'zod';

export interface OfficeFidelityIssue {
  kind: 'missing' | 'added' | 'changed' | 'invalid';
  part?: string;
  message: string;
}
/** Bounded diagnostics; OOXML candidates remain in the main/document Worker. */
export interface OfficeFidelityReport { total: number; issues: OfficeFidelityIssue[] }
export interface OfficeFidelityFailure extends OfficeFidelityReport { token: string; version: number }
export const officeLossyCopySchema = z.object({
  kind: z.enum(['xlsx', 'pptx']), id: z.string().uuid(), token: z.string().uuid(),
}).strict();
export type OfficeLossyCopyInput = z.infer<typeof officeLossyCopySchema>;
