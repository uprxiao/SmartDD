// Own packaged renderer only. Native Worker requests/events are forwarded.
// Error gates synchronously prevent the default reporting that delaying the
// original consumer would otherwise introduce; core ErrorEvent fields stay exact.
function install() {
 if (globalThis.__markdownObservation) return true;
 const Base = globalThis.Worker, post = Base.prototype.postMessage, terminate = Base.prototype.terminate, descriptor = Object.getOwnPropertyDescriptor(Base.prototype, 'onmessage'), errorDescriptor = Object.getOwnPropertyDescriptor(Base.prototype, 'onerror');
 if (!descriptor?.set || !errorDescriptor?.set) throw Error('Native Worker descriptors missing');
 const s = { Base, post, terminate, descriptor, errorDescriptor, rows: [], objects: [], slots: [], holdWindow: false, holdMath: false, holdMathError: false }; globalThis.__markdownObservation = s;
 const meta = new WeakMap();
 const gate = (row, record, deliver, kind) => { const slot = { rowIndex: s.rows.indexOf(row), messageIndex: row.messages.indexOf(record), errorIndex: row.errors.indexOf(record), kind, waiting: true }; s.slots.push(slot); slot.release = () => { if (!slot.waiting) return; slot.waiting = false; deliver(); }; };
 class ObservedWorker extends Base {
  constructor(...args) {
   const expectedUrl = String(args[0]), missing = s.failMathResource && expectedUrl.includes('markdown-math-worker'); if (missing) s.failMathResource = false; const actualArgs = missing ? [expectedUrl + '.__m9_missing_resource__', ...args.slice(1)] : args;
   super(...actualArgs); const row = { url: expectedUrl, ...(missing ? { requestedUrl: String(actualArgs[0]), failureInjected: 'native missing-module URL; real Worker ErrorEvent' } : {}), inputs: [], messages: [], errors: [], terminated: 0 }, entry = { worker: this, row, handler: null, errorHandler: null }; s.rows.push(row); s.objects.push(entry); meta.set(this, row);
   Object.defineProperty(this, 'onmessage', { configurable: true, get: () => entry.handler, set: handler => {
    entry.handler = handler; descriptor.set.call(this, handler ? event => {
     const before = JSON.stringify(event.data), record = { data: structuredClone(event.data), before, trusted: event.isTrusted, at: Date.now() }; row.messages.push(record);
     const deliver = () => { record.after = JSON.stringify(event.data); if (record.before !== record.after) throw Error('Original Worker reply changed'); record.deliveredAt = Date.now(); handler.call(this, event); };
     if (row.markdown && event.data?.type === 'window' && s.holdWindow) { s.holdWindow = false; gate(row, record, deliver, 'window'); }
     else if (row.math && event.data?.type === 'math-result' && s.holdMath) { s.holdMath = false; gate(row, record, deliver, 'math-result'); }
     else deliver();
    } : null);
   } });
   Object.defineProperty(this, 'onerror', { configurable: true, get: () => entry.errorHandler, set: handler => {
    entry.errorHandler = handler; errorDescriptor.set.call(this, handler ? event => {
     const snapshot = () => JSON.stringify({ message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, type: event.type }), before = snapshot(), record = { core: JSON.parse(before), before, trusted: event.isTrusted, at: Date.now(), defaultPreventedBefore: event.defaultPrevented }; row.errors.push(record);
     const deliver = () => { record.after = snapshot(); if (record.before !== record.after) throw Error('Original Worker error changed'); record.deliveredAt = Date.now(); handler.call(this, event); record.defaultPreventedAfter = event.defaultPrevented; };
     if (row.math && s.holdMathError) { s.holdMathError = false; event.preventDefault(); record.preventedByGate = true; gate(row, record, deliver, 'math-error'); } else deliver();
    } : null);
   } });
  }
  postMessage(...args) { const row = meta.get(this); if (row) { row.markdown ||= args[0]?.type === 'parse' && typeof args[0]?.source === 'string'; row.math ||= args[0]?.type === 'render-math'; const input = { data: structuredClone(args[0]), before: JSON.stringify(args[0]), at: Date.now() }; row.inputs.push(input); const result = post.apply(this, args); input.after = JSON.stringify(args[0]); if (input.before !== input.after) throw Error('Original Worker input changed'); return result; } return post.apply(this, args); }
  terminate(...args) { const row = meta.get(this); if (row) row.terminated++; return terminate.apply(this, args); }
 }
 globalThis.Worker = ObservedWorker; return true;
}
export const installMarkdownWorkerObserver = app => app.evaluate('(' + install.toString() + ')()');
export const holdMarkdownWindow = app => app.evaluate('globalThis.__markdownObservation.holdWindow=true;true');
export const holdMarkdownMath = app => app.evaluate('globalThis.__markdownObservation.holdMath=true;true');
export const holdMarkdownMathError = app => app.evaluate('globalThis.__markdownObservation.holdMathError=true;true');
export const observeMarkdownWorkers = app => app.evaluate('(()=>{const s=globalThis.__markdownObservation;return{rows:s.rows,slots:s.slots.map(({release,...slot})=>slot)}})()');
export const releaseMarkdownWindows = app => app.evaluate('globalThis.__markdownObservation.slots.filter(x=>x.waiting).forEach(x=>x.release());true');
export const restoreMarkdownWorkerObserver = app => app.evaluate('(()=>{const s=globalThis.__markdownObservation;s.holdWindow=s.holdMath=s.holdMathError=s.failMathResource=false;s.slots.forEach(x=>x.release?.());for(const e of s.objects){delete e.worker.onmessage;delete e.worker.onerror;s.descriptor.set.call(e.worker,e.handler);s.errorDescriptor.set.call(e.worker,e.errorHandler)}globalThis.Worker=s.Base;const result={constructor:globalThis.Worker===s.Base,postMessage:s.Base.prototype.postMessage===s.post,terminate:s.Base.prototype.terminate===s.terminate,allMarkdownWorkersTerminated:s.rows.filter(x=>x.markdown).every(x=>x.terminated>0),allMathWorkersTerminated:s.rows.filter(x=>x.math).every(x=>x.terminated>0),allSlotsReleased:s.slots.every(x=>!x.waiting)};delete globalThis.__markdownObservation;return result})()');
