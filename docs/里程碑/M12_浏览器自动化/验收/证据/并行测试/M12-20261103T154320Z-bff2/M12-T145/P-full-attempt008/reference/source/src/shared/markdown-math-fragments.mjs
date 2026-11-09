/** Coalesce the sibling DOM fragments of one parsed block into one genuine
 * engine request. Individual DOM aborts release only their own result; the
 * original request is cancelled when its last live fragment disappears. */
export function createMarkdownMathFragments(session) {
  let queued = [], scheduled = false, disposed = false; const groups = new Set();
  const cancelled = () => new DOMException('公式预览已取消', 'AbortError');
  const flush = () => {
    scheduled = false; const records = queued.filter(record => !record.signal.aborted); queued = [];
    if (!records.length) return;
    const controller = new AbortController(), group = { controller, records: new Set(records) }; groups.add(group);
    const formulas = []; let baseNodes = 0, baseUnits = 0;
    for (const record of records) { record.group = group; record.from = formulas.length; formulas.push(...record.formulas); baseNodes += record.baseNodes; baseUnits += record.baseUnits; }
    void session.renderGroup(formulas, { signal: controller.signal, baseNodes, baseUnits }).then(result => {
      for (const record of group.records) record.resolve({ ...result, html: result.overflow ? [] : result.html.slice(record.from, record.from + record.formulas.length) });
    }, error => { for (const record of group.records) record.reject(error); });
  };
  return {
    renderGroup(formulas, { signal, baseNodes = 0, baseUnits = 0 }) {
      if (disposed || signal.aborted) return Promise.reject(cancelled());
      return new Promise((resolve, reject) => {
        const record = { formulas, signal, baseNodes, baseUnits, resolve, reject, group: null, from: 0, cancel: null };
        const cancel = () => {
          signal.removeEventListener('abort', cancel); queued = queued.filter(value => value !== record);
          const group = record.group; if (group) { group.records.delete(record); if (!group.records.size) { group.controller.abort(); groups.delete(group); } }
          reject(cancelled());
        };
        record.cancel = cancel; signal.addEventListener('abort', cancel, { once: true }); queued.push(record);
        if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      });
    },
    dispose() { if (disposed) return; disposed = true; for (const record of [...queued]) record.cancel(); for (const group of [...groups]) for (const record of [...group.records]) record.cancel(); },
  };
}
