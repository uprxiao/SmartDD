// pdf-url:worker-url
var worker_url_default = "file:///private/tmp/willyou-m9-acceptance-batch-r87-build/mac-arm64/WillYou.app/Contents/Resources/app.asar/out/renderer/assets/pdf.worker.min-qwK7q_zL.mjs";

// src/renderer/features/files/pdf/session-slot.ts
var ViewerSessionSlot = class {
  current = null;
  queue = Promise.resolve();
  replace(create, signal) {
    const result = this.queue.catch(() => void 0).then(async () => {
      signal.throwIfAborted();
      await this.current?.destroy();
      this.current = null;
      signal.throwIfAborted();
      const session = await create();
      if (signal.aborted) {
        await session.destroy();
        signal.throwIfAborted();
      }
      this.current = session;
      return session;
    });
    this.queue = result;
    return result;
  }
};

// src/renderer/features/files/pdf/engine.ts
var enginePromise = null;
var slot = new ViewerSessionSlot();
var activeWorkers = 0;
var pdfWorkerCount = () => activeWorkers;
var errorOf = (name, message) => Object.assign(new Error(message), { name });
function createPdfSession(bytes, options) {
  return slot.replace(() => startSession(bytes, options), options.signal);
}
async function startSession(bytes, { signal, onPassword, onFailure }) {
  const engine = await (enginePromise ??= import("file:///private/tmp/willyou-m9-acceptance-batch-r87-build/mac-arm64/WillYou.app/Contents/Resources/app.asar/out/renderer/assets/pdf-C5fLvmtO.js").catch((error) => {
    enginePromise = null;
    throw error;
  }));
  signal.throwIfAborted();
  if (bytes.byteLength > 256 * 1024 * 1024) throw new Error("PDF \u8D85\u8FC7 256 MiB \u8BFB\u53D6\u4E0A\u9650");
  engine.GlobalWorkerOptions.workerSrc = worker_url_default;
  const port = new Worker(worker_url_default, { type: "module", name: "willyou-pdf" });
  let worker;
  try {
    worker = new engine.PDFWorker({ port });
  } catch (error) {
    port.terminate();
    throw error;
  }
  activeWorkers++;
  let loading, release, disposed = false, failed = false;
  let loadTimer;
  const timers = /* @__PURE__ */ new Set();
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => void 0);
  const destroy = () => {
    if (release) return release;
    disposed = true;
    rejectFailure(errorOf("AbortException", "PDF \u5DF2\u5173\u95ED"));
    clearTimeout(loadTimer);
    timers.forEach(clearTimeout);
    timers.clear();
    signal.removeEventListener("abort", aborted);
    port.removeEventListener("error", workerError);
    port.removeEventListener("messageerror", messageError);
    release = (async () => {
      let deadline;
      try {
        await Promise.race([loading?.destroy().catch(() => void 0), new Promise((resolve) => {
          deadline = setTimeout(resolve, 200);
        })]);
      } finally {
        clearTimeout(deadline);
        try {
          worker.destroy();
        } finally {
          port.terminate();
          activeWorkers--;
        }
      }
    })();
    return release;
  };
  const fail = (error) => {
    if (disposed || failed) return;
    failed = true;
    rejectFailure(error);
    try {
      onFailure(error);
    } finally {
      void destroy();
    }
  };
  const aborted = () => {
    void destroy();
  };
  const workerError = (event) => {
    event.preventDefault();
    fail(errorOf("PdfWorkerError", "PDF \u5DE5\u4F5C\u8FDB\u7A0B\u5931\u8D25"));
  };
  const messageError = () => fail(errorOf("PdfWorkerError", "PDF \u5DE5\u4F5C\u8FDB\u7A0B\u6D88\u606F\u65E0\u6548"));
  signal.addEventListener("abort", aborted, { once: true });
  port.addEventListener("error", workerError);
  port.addEventListener("messageerror", messageError);
  const run = (promise) => {
    if (disposed) {
      void promise.catch(() => void 0);
      return Promise.reject(errorOf("AbortException", "PDF \u5DF2\u5173\u95ED"));
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = errorOf("PdfWorkerTimeout", "PDF \u9875\u9762\u54CD\u5E94\u8D85\u65F6");
        reject(error);
        fail(error);
      }, 15e3);
      timers.add(timer);
    });
    return Promise.race([promise, failure, timeout]).finally(() => {
      clearTimeout(timer);
      timers.delete(timer);
    });
  };
  const arm = () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => fail(errorOf("PdfWorkerTimeout", "PDF \u8F7D\u5165\u8D85\u65F6")), 15e3);
  };
  try {
    loading = engine.getDocument({
      data: bytes,
      worker,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
      cMapUrl: "willyou-assets://pdf/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "willyou-assets://pdf/standard_fonts/",
      wasmUrl: "willyou-assets://pdf/wasm/",
      useWorkerFetch: true,
      canvasMaxAreaInBytes: 128 * 1024 * 1024
    });
    loading.onPassword = (update, reason) => {
      clearTimeout(loadTimer);
      if (!disposed) onPassword((value) => {
        if (!disposed) {
          arm();
          update(value);
        }
      }, reason === engine.PasswordResponses.INCORRECT_PASSWORD);
    };
    arm();
  } catch (error) {
    await destroy();
    throw error;
  }
  const ready = Promise.race([loading.promise, failure]).finally(() => clearTimeout(loadTimer));
  void ready.catch((error) => {
    if (!disposed) fail(error);
  });
  return { engine, ready, run, destroy };
}
export {
  createPdfSession,
  pdfWorkerCount
};
