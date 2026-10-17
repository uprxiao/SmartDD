// Dedicated native browser workers: no fake-worker fallback and no remote resources.
let enginePromise = null;
const live = new Map();
let serial = 0, created = 0, destroyed = 0;
export function loadPdfEngine() {
  return enginePromise ||= Promise.all([import('pdfjs-dist/build/pdf.mjs'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  }).catch(error => { enginePromise = null; throw error; });
}
export const pdfRuntimeSnapshot = () => ({ created, destroyed, active: live.size, sessions: [...live.values()].map(s => s.snapshot()) });
const errorOf = (name, message) => Object.assign(new Error(message), { name });

export async function createPdfSession({ url, onPassword, onFailure, timeoutMs = 15000 } = {}) {
  const engine = await loadPdfEngine();
  const port = new Worker(engine.GlobalWorkerOptions.workerSrc, { type: 'module', name: 'willyou-pdf-' + (++serial) });
  let worker;
  try { worker = new engine.PDFWorker({ port }); } catch (error) { port.terminate(); throw error; }
  created++;
  const id = serial, pendingTimers = new Set();
  let disposed = false, failed = false, loading, release, loadingTimer;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  failure.catch(() => {});
  const destroy = () => {
    if (release) return release;
    disposed = true;
    rejectFailure(errorOf('AbortException', 'PDF session disposed'));
    pendingTimers.forEach(clearTimeout); pendingTimers.clear(); clearTimeout(loadingTimer);
    port.removeEventListener('error', onError); port.removeEventListener('messageerror', onMessageError);
    // pdf.js destroy can wait on an already-dead worker. Bound the handshake,
    // then always terminate our own port (PDFWorker({port}) does not own it).
    release = (async () => {
      let timer;
      try { await Promise.race([loading?.destroy().catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 200); })]); }
      finally { clearTimeout(timer); try { worker.destroy(); } finally { port.terminate(); live.delete(id); destroyed++; } }
    })();
    return release;
  };
  const fail = error => {
    if (disposed || failed) return;
    failed = true; rejectFailure(error);
    try { onFailure?.(error); } finally { void destroy(); }
  };
  const onError = event => { event.preventDefault(); fail(errorOf('PdfWorkerError', 'PDF worker crashed')); };
  const onMessageError = () => fail(errorOf('PdfWorkerError', 'PDF worker message could not be decoded'));
  port.addEventListener('error', onError); port.addEventListener('messageerror', onMessageError);
  const run = promise => {
    if (disposed) return Promise.reject(errorOf('AbortException', 'PDF session disposed'));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { const error = errorOf('PdfWorkerTimeout', 'PDF worker did not respond'); reject(error); fail(error); }, timeoutMs);
      pendingTimers.add(timer);
    });
    return Promise.race([promise, failure, timeout]).finally(() => { clearTimeout(timer); pendingTimers.delete(timer); });
  };
  try { loading = engine.getDocument({ url, worker, isEvalSupported: false, useSystemFonts: true, verbosity: 0,
    cMapUrl: '/assets/m9-pdf/runtime/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/assets/m9-pdf/runtime/standard_fonts/' });
  } catch (error) { await destroy(); throw error; }
  const armLoadingDeadline = () => { clearTimeout(loadingTimer); loadingTimer = setTimeout(() => fail(errorOf('PdfWorkerTimeout', 'PDF loading timed out')), timeoutMs); };
  armLoadingDeadline();
  // Pause the deadline while awaiting a user password, resume on each attempt.
  loading.onPassword = (update, reason) => { clearTimeout(loadingTimer); onPassword?.(password => { if (!disposed) { armLoadingDeadline(); update(password); } }, reason, engine); };
  const session = { id, engine, run, destroy,
    ready: Promise.race([loading.promise, failure]).finally(() => clearTimeout(loadingTimer)),
    snapshot: () => ({ id, nativeWorker: port instanceof Worker, disposed, failed, pendingTimers: pendingTimers.size }) };
  session.ready.catch(() => {});
  live.set(id, session);
  return session;
}
