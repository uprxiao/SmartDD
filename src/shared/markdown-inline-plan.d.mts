export interface MarkdownInlineNode {
  kind: 'heading' | 'format' | 'link' | 'image' | 'entity' | 'code';
  from: number; to: number; contentFrom?: number; contentTo?: number;
  style?: 'strong' | 'em' | 'strike'; href?: string; html?: string;
  level?: number; line?: number; parts?: [number, number][]; parents?: [number, number][];
  markers?: { from: number; to: number; hideTo: number }[];
  parentMarkers?: { from: number; to: number; hideTo: number }[];
  sourceOnly?: boolean;
}
export function createMarkdownInlinePlan(block: unknown, env: unknown, renderToken: (token: unknown) => string): MarkdownInlineNode[];
export function markdownNodeRevealed(node: MarkdownInlineNode, ranges: { from: number; to: number }[], focused: boolean): boolean;
export function markdownMarkerRevealed(node: MarkdownInlineNode, index: number, ranges: { from: number; to: number }[], focused: boolean): boolean;
