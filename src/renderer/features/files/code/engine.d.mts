export { CODE_TOKEN_STRIDE, codeTokenStyle } from './paint.mjs';
export const CODE_LIMITS: Readonly<{ source: number; tokens: number; window: number; deadline: number }>;
export function codeLanguage(filename: string): string | null;
export function highlightRanges(source: string, filename: string): Uint32Array;
export function highlightWindow(tokens: Uint32Array, from: number, to: number): Uint32Array;
export function highlightLanguage(name?: string): string | null;
export function highlightCode(source: string, language?: string): { html: string | null; language: string | null };
