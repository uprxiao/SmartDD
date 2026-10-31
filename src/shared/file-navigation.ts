import { z } from 'zod';

const positive = z.number().int().positive().safe();
const identifier = z.string().trim().min(1).max(1024);
/** Display targets contain no paths, leases, cloud IDs or write authority. */
export const artifactNavigationTargetSchema = z.union([
  z.object({ artifactKind: z.literal('document'), pageNumber: positive }).strict(),
  z.object({ artifactKind: z.literal('presentation'), slideNumber: positive.optional(), slideId: identifier.optional(), objectId: identifier.optional() }).strict().refine(target => target.slideNumber !== undefined || target.slideId !== undefined, '缺少幻灯片位置'),
  z.object({ artifactKind: z.literal('workbook'), sheet: identifier, range: identifier }).strict(),
  z.object({ artifactKind: z.literal('workbook'), sheet: identifier, objectId: identifier, objectKind: z.enum(['chart', 'table', 'image', 'shape']).optional() }).strict(),
]);
export type ArtifactNavigationTarget = z.infer<typeof artifactNavigationTargetSchema>;
export interface FileDisplayOptions { artifactNavigationTarget?: ArtifactNavigationTarget | null; filePreviewTitle?: string | null }
export interface ArtifactNavigationRequest { id: string; documentId: string; sourceHash: string; target: ArtifactNavigationTarget }
export interface ArtifactCellRange { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number }

/** A bounded A1 range in the existing one-million-row/16,384-column CSV view. */
export function artifactCellRange(range: string): ArtifactCellRange {
  const match = /^(\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6})(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6}))?$/.exec(range);
  if (!match) throw new Error('表格定位范围无效');
  const cell = (value: string) => {
    const parts = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(value)!;
    let column = 0; for (const char of parts[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    const row = Number(parts[2]);
    if (row > 1_000_000 || column > 16_384) throw new Error('表格定位超出读取上限');
    return { row: row - 1, column: column - 1 };
  };
  const first = cell(match[1]), last = cell(match[2] ?? match[1]);
  if (first.row > last.row || first.column > last.column) throw new Error('表格定位范围方向无效');
  return { firstRow: first.row, lastRow: last.row, firstColumn: first.column, lastColumn: last.column };
}

export function fileDisplayIntent(name: string, options: FileDisplayOptions) {
  const title = options.filePreviewTitle == null ? null : z.string().max(4096).parse(options.filePreviewTitle);
  const requested = options.artifactNavigationTarget == null ? null : artifactNavigationTargetSchema.parse(options.artifactNavigationTarget);
  if (!requested) return { title, target: null, unsupported: false };
  const document = /\.(?:pdf|tex)$/i.test(name), workbook = /\.(?:csv|tsv)$/i.test(name);
  // Formats without a local artifact pane retain the ordinary fallback, with
  // an explicit unhandled notice. A valid target never invents a new source.
  if (!document && !workbook) return { title, target: null, unsupported: true };
  if (document && requested.artifactKind === 'document') return { title, target: requested, unsupported: false };
  if (workbook && requested.artifactKind === 'workbook' && 'range' in requested) {
    // CSV/TSV has one actual table, identified by its source filename. It has
    // no invented Sheet1 namespace or Office object identifiers.
    if (requested.sheet !== name.split('/').at(-1)) throw new Error('当前表格不存在指定工作表');
    artifactCellRange(requested.range);
    return { title, target: requested, unsupported: false };
  }
  throw new Error('当前文件不支持指定的预览定位目标');
}
