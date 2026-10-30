import { PDFDocument, PDFName } from 'pdf-lib';
import { TEX_LIMITS } from '@shared/file-tex';

/** Only the private compiler snapshot is changed. Normal PDFs retain bytes. */
export async function normalizeBlankPdfPages(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength > TEX_LIMITS.outputBytes) throw new Error('TeX PDF 图片超过 40 MiB');
  const document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  const pages = document.getPages();
  if (!pages.length || pages.length > TEX_LIMITS.pages) throw new Error('TeX PDF 图片页数须在 1–2000 页之间');
  const missing = pages.filter((page) => !page.node.has(PDFName.of('Contents')));
  if (!missing.length) return null;
  const empty = document.context.register(document.context.stream('q\nQ\n'));
  for (const page of missing) page.node.set(PDFName.of('Contents'), empty);
  const result = await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  if (result.byteLength > TEX_LIMITS.outputBytes) throw new Error('兼容处理后的 TeX PDF 图片超过 40 MiB');
  return result;
}
