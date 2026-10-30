import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ViewerSessionSlot } from './session-slot';

// Lifecycle adapted from the reviewed native-worker experiment. The production
// input is revision-checked bytes, never an authored URL or arbitrary file path.
type Engine = typeof import('pdfjs-dist');
export interface PdfSession {
  engine: Engine;
  ready: Promise<PDFDocumentProxy>;
  run<T>(promise: Promise<T>): Promise<T>;
  destroy(): Promise<void>;
}
let enginePromise: Promise<Engine> | null = null;
const slot = new ViewerSessionSlot<PdfSession>();
let activeWorkers = 0;
export const pdfWorkerCount = () => activeWorkers;
const errorOf = (name: string, message: string) => Object.assign(new Error(message), { name });
interface Options {
  signal: AbortSignal;
  onPassword: (submit: (value: string) => void, wrong: boolean) => void;
  onFailure: (error: unknown) => void;
}
export function createPdfSession(bytes: Uint8Array<ArrayBuffer>, options: Options): Promise<PdfSession> {
  return slot.replace(() => startSession(bytes, options), options.signal);
}
async function startSession(bytes: Uint8Array<ArrayBuffer>, { signal, onPassword, onFailure }: Options): Promise<PdfSession> {
  const engine = await (enginePromise ??= import('pdfjs-dist').catch((error) => { enginePromise = null; throw error; }));
  signal.throwIfAborted();
  if (bytes.byteLength > 256 * 1024 * 1024) throw new Error('PDF 超过 256 MiB 读取上限');
  engine.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const port = new Worker(pdfWorkerUrl, { type: 'module', name: 'willyou-pdf' });
  let worker: InstanceType<Engine['PDFWorker']>;
  // pdf.js 5.4's generated declaration narrows the default `port = null` to
  // null, although its implementation accepts a native Worker via this API.
  try { worker = new engine.PDFWorker({ port } as unknown as ConstructorParameters<Engine['PDFWorker']>[0]); } catch (error) { port.terminate(); throw error; }
  activeWorkers++;
  let loading: PDFDocumentLoadingTask | undefined, release: Promise<void> | undefined, disposed = false, failed = false;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let rejectFailure!: (reason: unknown) => void;
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failure.catch(() => undefined);
  const destroy = (): Promise<void> => {
    if (release) return release;
    disposed = true; rejectFailure(errorOf('AbortException', 'PDF 已关闭'));
    clearTimeout(loadTimer); timers.forEach(clearTimeout); timers.clear();
    signal.removeEventListener('abort', aborted);
    port.removeEventListener('error', workerError); port.removeEventListener('messageerror', messageError);
    release = (async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([loading?.destroy().catch(() => undefined), new Promise<void>((resolve) => { deadline = setTimeout(resolve, 200); })]); }
      finally { clearTimeout(deadline); try { worker.destroy(); } finally { port.terminate(); activeWorkers--; } }
    })();
    return release;
  };
  const fail = (error: unknown) => {
    if (disposed || failed) return;
    failed = true; rejectFailure(error);
    try { onFailure(error); } finally { void destroy(); }
  };
  const aborted = () => { void destroy(); };
  const workerError = (event: ErrorEvent) => { event.preventDefault(); fail(errorOf('PdfWorkerError', 'PDF 工作进程失败')); };
  const messageError = () => fail(errorOf('PdfWorkerError', 'PDF 工作进程消息无效'));
  signal.addEventListener('abort', aborted, { once: true });
  port.addEventListener('error', workerError); port.addEventListener('messageerror', messageError);
  const run = <T>(promise: Promise<T>): Promise<T> => {
    if (disposed) { void promise.catch(() => undefined); return Promise.reject(errorOf('AbortException', 'PDF 已关闭')); }
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const error = errorOf('PdfWorkerTimeout', 'PDF 页面响应超时'); reject(error); fail(error); }, 15_000);
      timers.add(timer);
    });
    return Promise.race([promise, failure, timeout]).finally(() => { clearTimeout(timer); timers.delete(timer); });
  };
  const arm = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => fail(errorOf('PdfWorkerTimeout', 'PDF 载入超时')), 15_000); };
  try {
    loading = engine.getDocument({ data: bytes, worker, isEvalSupported: false, useSystemFonts: true, verbosity: 0,
      cMapUrl: 'willyou-assets://pdf/cmaps/', cMapPacked: true, standardFontDataUrl: 'willyou-assets://pdf/standard_fonts/',
      wasmUrl: 'willyou-assets://pdf/wasm/', useWorkerFetch: true, canvasMaxAreaInBytes: 128 * 1024 * 1024 });
    loading.onPassword = (update: (value: string) => void, reason: number) => {
      clearTimeout(loadTimer);
      if (!disposed) onPassword((value) => { if (!disposed) { arm(); update(value); } }, reason === engine.PasswordResponses.INCORRECT_PASSWORD);
    };
    arm();
  } catch (error) { await destroy(); throw error; }
  const ready = Promise.race([loading.promise, failure]).finally(() => clearTimeout(loadTimer));
  void ready.catch((error) => { if (!disposed) fail(error); });
  return { engine, ready, run, destroy };
}
