import type { MarkdownInlineNode } from '@shared/markdown-inline-plan.mjs';
export interface MarkdownMathRange {
  from: number; to: number; contentEnd: number; code: string; html: string; displayMode: boolean; block: boolean;
}
export interface MarkdownItem {
  from: number; to: number; line: number; type: string; html?: string; source?: string;
  metadata?: { entries: [string, string][]; error?: string };
  sourceMap?: { from: number; to: number; mode: string; runs?: number[][] } | null;
  sourceOnly?: string;
  math?: MarkdownMathRange[];
  inline?: MarkdownInlineNode[];
}
export const blockTypes: string[];
export function analyze(source: string): { parsed: unknown; index: Uint32Array<ArrayBuffer> };
export function renderWindow(parsed: unknown, start: number, count: number, readOnly?: boolean): MarkdownItem[];
