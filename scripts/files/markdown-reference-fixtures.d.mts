export interface ReferenceWindowCase { name: string; end: number; crlf?: boolean; header?: boolean; long?: boolean; mixed?: boolean; imageCount: number }
export function referenceWindowFixture(end: number, options?: { crlf?: boolean; header?: boolean; long?: boolean; mixed?: boolean }): { source: string; definition: string; definitionStart: number; definitionEnd: number };
export const referenceWindowCases: ReferenceWindowCase[];
