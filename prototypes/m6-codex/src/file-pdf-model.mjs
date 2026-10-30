// PDF 查看的纯计算部分（不依赖 pdf.js，可在 Node 中测试）。
export const CSS_UNITS = 96 / 72;
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024; // Safari 常见画布面积上限
export const MAX_CANVAS_SIDE = 16384;

// 显示尺寸（CSS 像素）与画布渲染倍率：画布面积超限时降采样并报告。
export function pdfRenderPlan(widthPt, heightPt, zoomPercent, devicePixelRatio = 1) {
  const display = zoomPercent / 100 * CSS_UNITS;
  const cssWidth = widthPt * display, cssHeight = heightPt * display;
  let ratio = Math.max(1, devicePixelRatio);
  const area = cssWidth * cssHeight * ratio * ratio;
  let downscaled = false;
  if (area > MAX_CANVAS_PIXELS) { ratio = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)); downscaled = true; }
  const side = Math.max(cssWidth, cssHeight) * ratio;
  if (side > MAX_CANVAS_SIDE) { ratio = MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight); downscaled = true; }
  return { display, cssWidth, cssHeight, ratio, canvasWidth: Math.max(1, Math.floor(cssWidth * ratio)), canvasHeight: Math.max(1, Math.floor(cssHeight * ratio)), downscaled };
}
export const fitWidthZoom = (pageWidthPt, availableCssWidth, max = 100) => Math.max(10, Math.min(max, Math.floor(availableCssWidth / (pageWidthPt * CSS_UNITS) * 100)));

// pdf.js 错误 → 用户可读分类。code 来自 PasswordResponses（1 需要密码，2 密码错误）。
export function classifyPdfError(error) {
  const name = error?.name || '';
  if (name === 'PasswordException') return { kind: 'password', wrong: error.code === 2 };
  if (name === 'InvalidPDFException') return { kind: 'invalid', message: '文件不是有效的 PDF，或已损坏、不完整。' };
  if (name === 'MissingPDFException') return { kind: 'missing', message: '找不到文件。' };
  if (name === 'ResponseException' || name === 'UnexpectedResponseException') return { kind: 'network', message: '读取文件失败，请重试。' };
  if (name === 'PdfWorkerError') return { kind: 'worker', message: 'PDF 工作进程意外退出，请重试。' };
  if (name === 'PdfWorkerTimeout') return { kind: 'timeout', message: 'PDF 工作进程响应超时，已释放资源；请重试。' };
  if (name === 'AbortException') return { kind: 'aborted' };
  return { kind: 'unknown', message: '无法渲染 PDF。' };
}

// 目的地数组 → 页索引。pdf.js 对页引用对象与已解析整数形式给出不同值；调用方提供 getPageIndex。
export async function resolveDestinationPage(dest, getDestination, getPageIndex) {
  try {
    const array = typeof dest === 'string' ? await getDestination(dest) : dest;
    if (!Array.isArray(array) || array.length === 0) return null;
    const target = array[0];
    if (Number.isInteger(target)) return target >= 0 ? target : null; // 远程跳转的整数页码
    const index = await getPageIndex(target);
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch { return null; }
}
// 页级并发渲染预算：只渲染可见页及前后各 margin 页。
export function pagesToRender(visible, total, margin = 1) {
  if (!visible.length) return [];
  const lo = Math.max(1, Math.min(...visible) - margin), hi = Math.min(total, Math.max(...visible) + margin);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

// Keep large PDFs bounded by the viewport, not by total page count.
export function pdfPageWindow(sizes, zoom, top = 0, height = 800, overscan = 800) {
  const offsets = [0];
  for (const size of sizes) offsets.push(offsets.at(-1) + size.height * CSS_UNITS * zoom / 100 + 12);
  let first = 0, last = sizes.length - 1;
  while (first < last && offsets[first + 1] < Math.max(0, top - overscan)) first++;
  last = first;
  while (last + 1 < sizes.length && offsets[last + 1] < top + height + overscan) last++;
  return { numbers: sizes.length ? Array.from({ length: last - first + 1 }, (_, i) => first + i + 1) : [],
    before: offsets[first] || 0, after: offsets.at(-1) - (offsets[last + 1] || 0), offsets };
}

export function pdfDeliveryResult(value) {
  if (value?.status && ['inserted', 'failed', 'unknown'].includes(value.status)) return value.status;
  return value?.ok ? 'inserted' : value?.error === 'terminal-no-response' ? 'unknown' : 'failed';
}
export function beginPdfDelivery(state) {
  if (state.phase === 'inserting') return state;
  const ids = state.requests.filter(x => !['inserted', 'unknown'].includes(x.delivery)).map(x => x.id);
  return ids.length ? { ...state, phase: 'inserting', operation: state.operation + 1, error: '', pendingIds: ids } : state;
}
export function finishPdfDeliveryItem(state, operation, id, status) {
  if (state.operation !== operation || state.phase !== 'inserting') return state;
  const requests = state.requests.map(item => item.id === id ? { ...item, delivery: status } : item);
  const pendingIds = state.pendingIds.filter(value => value !== id);
  const phase = status !== 'inserted' ? status : pendingIds.length ? 'inserting' : 'inserted';
  return { ...state, requests, pendingIds, phase, error: status === 'failed' ? '插入失败，评论已保留。' : status === 'unknown' ? '插入结果未知，请先检查终端；不会自动重发。' : '' };
}
export function stopPdfDelivery(state) {
  return { ...state, operation: state.operation + 1, phase: state.phase === 'inserting' ? 'unknown' : 'idle', pendingIds: [],
    requests: state.requests.map(item => item.delivery === 'inserting' ? { ...item, delivery: 'unknown' } : item),
    error: state.phase === 'inserting' ? '已停止等待，投递结果未知；未停止或撤回终端任务。' : '' };
}
