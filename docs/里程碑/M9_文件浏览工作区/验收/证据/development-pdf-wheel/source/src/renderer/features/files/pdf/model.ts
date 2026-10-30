// Adapted from the reviewed M9 prototype's file-pdf-model.mjs. Production adds
// the shared canvas ceiling and a hard viewport count; source pages remain intact.
export const CSS_UNITS = 96 / 72;
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export const TOTAL_CANVAS_PIXELS = 32 * 1024 * 1024;
export const MAX_CANVAS_SIDE = 16384;
export const MAX_BODY_PAGES = 8;
export interface PdfPageSize { width: number; height: number }
export const clampPdfZoom = (zoom: number) => Math.max(30, Math.min(800, Number.isFinite(zoom) ? zoom : 100));
export const clampPdfPage = (page: number, total: number) => Math.max(1, Math.min(total, Number.isFinite(page) ? Math.trunc(page) : 1));
export const fitWidthZoom = (width: number, available: number) => clampPdfZoom(Math.min(100, Math.floor(available / (width * CSS_UNITS) * 100)));

export function pdfRenderPlan(size: PdfPageSize, zoom: number, dpr = 1, pixelLimit = MAX_CANVAS_PIXELS) {
  if (![size.width, size.height, zoom, dpr, pixelLimit].every(Number.isFinite) || size.width <= 0 || size.height <= 0 || zoom <= 0 || pixelLimit < 1) throw new Error('PDF 页面尺寸无效');
  const display = zoom / 100 * CSS_UNITS, cssWidth = size.width * display, cssHeight = size.height * display;
  const nativeRatio = Math.max(1, dpr), ratio = Math.min(nativeRatio, Math.sqrt(Math.min(pixelLimit, MAX_CANVAS_PIXELS) / (cssWidth * cssHeight)), MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight));
  // Rounding both dimensions down also keeps extremely narrow/tall pages inside
  // the total budget when one dimension would otherwise round to zero.
  const canvasWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const canvasHeight = Math.max(1, Math.min(Math.floor(cssHeight * ratio), Math.floor(pixelLimit / canvasWidth)));
  return { display, cssWidth, cssHeight, ratio, canvasWidth, canvasHeight, downscaled: ratio < nativeRatio };
}
export class PdfCanvasBudget {
  private readonly allocations = new Map<object, number>();
  get pixels(): number { return [...this.allocations.values()].reduce((a, b) => a + b, 0); }
  get count(): number { return this.allocations.size; }
  take(owner: object, size: PdfPageSize, zoom: number, dpr: number, quota: number) {
    this.release(owner);
    const available = Math.min(quota, TOTAL_CANVAS_PIXELS - this.pixels);
    if (available < 1 || this.count >= 20) return null;
    const plan = pdfRenderPlan(size, zoom, dpr, available);
    this.allocations.set(owner, plan.canvasWidth * plan.canvasHeight);
    return plan;
  }
  release(owner: object): void { this.allocations.delete(owner); }
}
export function pdfOffsets(sizes: readonly PdfPageSize[], zoom: number): Float64Array {
  const result = new Float64Array(sizes.length + 1);
  for (let i = 0; i < sizes.length; i++) result[i + 1] = result[i] + sizes[i].height * CSS_UNITS * zoom / 100 + 12;
  return result;
}
export function pageAtOffset(offsets: Float64Array, position: number): number {
  let lo = 0, hi = Math.max(0, offsets.length - 2);
  while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (offsets[mid] <= position) lo = mid; else hi = mid - 1; }
  return lo;
}
export function pdfPageWindow(offsets: Float64Array, top: number, height: number) {
  const total = offsets.length - 1;
  if (!total) return { numbers: [], before: 0, after: 0 };
  const current = pageAtOffset(offsets, Math.max(0, top)), first = Math.max(0, current - 1);
  const last = Math.min(total - 1, first + MAX_BODY_PAGES - 1, pageAtOffset(offsets, top + height + 800));
  return { numbers: Array.from({ length: last - first + 1 }, (_, i) => first + i + 1), before: offsets[first], after: offsets[total] - offsets[last + 1] };
}
export function classifyPdfError(error: unknown): { kind: string; message: string } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidPDFException') return { kind: 'invalid', message: '文件不是有效的 PDF，或已损坏、不完整。' };
  if (name === 'PasswordException') return { kind: 'password', message: '需要正确的密码才能打开此 PDF。' };
  if (name === 'PdfWorkerError') return { kind: 'worker', message: 'PDF 工作进程意外退出，请重试。' };
  if (name === 'PdfWorkerTimeout') return { kind: 'timeout', message: 'PDF 工作进程响应超时，已释放资源；请重试。' };
  if (name === 'AbortError' || name === 'AbortException') return { kind: 'aborted', message: '已取消 PDF 读取。' };
  return { kind: 'read', message: error instanceof Error ? error.message : '读取 PDF 失败，请重试。' };
}
export async function resolveDestinationPage(dest: unknown, doc: { getDestination: (name: string) => Promise<unknown>; getPageIndex: (ref: any) => Promise<number> }): Promise<number | null> {
  try {
    const value = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(value) || !value.length) return null;
    const index = Number.isInteger(value[0]) ? value[0] : await doc.getPageIndex(value[0]);
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch { return null; }
}
