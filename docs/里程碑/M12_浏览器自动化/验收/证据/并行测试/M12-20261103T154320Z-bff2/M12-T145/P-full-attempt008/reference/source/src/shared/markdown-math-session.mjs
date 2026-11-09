const abortError = () => new DOMException('公式预览已取消', 'AbortError');
/** One lazy engine per editor. Native Worker callbacks/requests; no DOM access. */
export function createMarkdownMathSession() {
  let worker = null, serial = 0, disposed = false; const owners = new Map(), pending = new Map();
  const stop = () => { if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null; } };
  const detach = (record, error) => {
    clearTimeout(record.timer); pending.delete(record.id); owners.delete(record.id); record.signal.removeEventListener('abort', record.cancel);
    record.reject?.(error); record.resolve = record.reject = null;
  };
  const fail = error => { stop(); for (const record of [...owners.values()]) detach(record, error); };
  const ensure = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./markdown-math-worker.mjs', import.meta.url), { type: 'module', name: 'WillYou math' });
    worker.onmessage = ({ data }) => {
      const record = pending.get(data?.id); if (!record) return;
      clearTimeout(record.timer); pending.delete(record.id);
      if (data.type === 'math-failure') { detach(record, new Error(data.error)); return; }
      const result = data.result;
      if (data.type !== 'math-result' || !result || !Array.isArray(result.html) || !result.html.every(x => typeof x === 'string') || !result.overflow && result.html.length !== record.count) { detach(record, new Error('公式渲染响应无效')); return; }
      record.resolve(result); record.resolve = record.reject = null;
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || '公式引擎加载失败')); };
    return worker;
  };
  return {
    renderGroup(formulas, { signal, baseNodes = 0, baseUnits = 0 }) {
      if (disposed || signal.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const record = { id: ++serial, count: formulas.length, signal, resolve, reject, timer: undefined, cancel: null };
        record.cancel = () => { detach(record, abortError()); queueMicrotask(() => { if (!owners.size) stop(); }); };
        owners.set(record.id, record); signal.addEventListener('abort', record.cancel, { once: true });
        // Let CodeMirror finish destroying a superseded viewport before applying
        // the existing 60-block window bound to requests for the new viewport.
        queueMicrotask(() => {
          if (!owners.has(record.id) || signal.aborted || disposed) return;
          if (pending.size >= 60) { detach(record, new Error('公式预览队列已满，源码仍保留')); return; }
          try { const target = ensure(); pending.set(record.id, record); record.timer = setTimeout(() => fail(new Error('公式渲染超过 15 秒，源码仍保留')), 15000); target.postMessage({ type: 'render-math', id: record.id, formulas, baseNodes, baseUnits }); }
          catch (error) { fail(error); }
        });
      });
    },
    dispose() { if (disposed) return; disposed = true; fail(abortError()); },
  };
}
/** Share the existing 2 Mi-unit render-window budget across all math DOM. */
export function createMarkdownMathBudget(baseUnits) {
  let units = baseUnits; const allocations = new Map();
  return {
    reserve(owner, extra) { const previous = allocations.get(owner) ?? 0, next = Math.max(0, extra); if (units - previous + next > 2 * 1024 * 1024) return false; units += next - previous; allocations.set(owner, next); return true; },
    release(owner) { units -= allocations.get(owner) ?? 0; allocations.delete(owner); },
  };
}
export function hydrateMarkdownMath(root, session, signal, { budget, baseUnits = root.innerHTML.length, measure = () => {}, overflow = () => {}, error = () => {} }) {
  const elements = [...root.querySelectorAll('[data-md-math]')]; if (!elements.length || signal.aborted) return () => {};
  const original = root.innerHTML, fixedUnits = original.length - elements.reduce((sum, element) => sum + element.innerHTML.length, 0), baseNodes = (original.match(/</g) ?? []).length;
  const local = new AbortController(); let stopped = false; const live = () => !stopped && !signal.aborted && root.isConnected;
  const release = () => { stopped = true; local.abort(); budget.release(root); signal.removeEventListener('abort', release); }; signal.addEventListener('abort', release, { once: true });
  void session.renderGroup(elements.map(element => ({ source: element.dataset.mdMathCode ?? '', displayMode: element.dataset.mdMath === 'block' })), { signal: local.signal, baseNodes, baseUnits: fixedUnits }).then(result => {
    if (!live()) return;
    if (result.overflow) { overflow(); return; }
    const clone = root.cloneNode(true), targets = [...clone.querySelectorAll('[data-md-math]')];
    targets.forEach((element, index) => { element.innerHTML = result.html[index]; element.classList.remove('fw-md-math-pending'); element.classList.add('fw-md-math-ready'); element.dataset.mdMathState = 'ready'; });
    if (!budget.reserve(root, clone.innerHTML.length - baseUnits)) { overflow(); return; }
    if (!live()) { budget.release(root); return; }
    // Keep the real span objects/selection mapping; the clone only measures cost.
    elements.forEach((element, index) => { element.innerHTML = result.html[index]; element.classList.remove('fw-md-math-pending'); element.classList.add('fw-md-math-ready'); element.dataset.mdMathState = 'ready'; }); measure();
  }).catch(failure => { if (!live()) return; for (const element of elements) { element.dataset.mdMathState = 'error'; element.title = '公式暂时无法显示，源码已保留'; } error(failure); });
  return release;
}
