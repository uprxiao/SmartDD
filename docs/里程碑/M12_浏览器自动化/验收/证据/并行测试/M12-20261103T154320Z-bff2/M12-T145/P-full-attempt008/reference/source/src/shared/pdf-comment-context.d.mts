import type { ZodType } from 'zod';
export interface TerminalPdfContext { page: number; anchor: { x: number; y: number; width: number; height: number } }
export const terminalPdfContextSchema: ZodType<TerminalPdfContext>;
export function formatPdfReferenceLocation(value: TerminalPdfContext): string;
