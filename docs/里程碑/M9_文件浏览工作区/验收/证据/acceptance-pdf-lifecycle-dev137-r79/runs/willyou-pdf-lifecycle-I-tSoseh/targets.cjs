var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/lib/pdf-worker-targets.mjs
var pdf_worker_targets_exports = {};
__export(pdf_worker_targets_exports, {
  observePdfWorkers: () => observePdfWorkers
});
module.exports = __toCommonJS(pdf_worker_targets_exports);
async function observePdfWorkers(app) {
  const rows = [], pending = /* @__PURE__ */ new Map(), off = [], jobs = /* @__PURE__ */ new Set(), errors = [];
  let serial = 10, holdNext = false;
  const request = (row, method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, key = row.sessionId + ":" + id, timer = setTimeout(() => {
      pending.delete(key);
      reject(Error("PDF Worker CDP request timed out: " + method));
    }, 5e3);
    pending.set(key, { resolve, reject, timer, row });
    app.cdp("Target.sendMessageToTarget", { sessionId: row.sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
      pending.delete(key);
      clearTimeout(timer);
      reject(error);
    });
  });
  const gone = (row) => !!(row.destroyedAt || row.detachedAt);
  const resume = async (row) => {
    try {
      await request(row, "Runtime.runIfWaitingForDebugger");
      row.resumedAt = Date.now();
    } catch (error) {
      if (gone(row) || /session|target.*closed|terminated/i.test(String(error))) row.resumeAfterTermination = true;
      else throw error;
    }
  };
  off.push(app.onCDP("Target.attachedToTarget", (e) => {
    if (e.targetInfo.type !== "worker") return;
    const row = { targetId: e.targetInfo.targetId, sessionId: e.sessionId, url: e.targetInfo.url, waitingForDebugger: e.waitingForDebugger, attachedAt: Date.now(), held: holdNext };
    rows.push(row);
    holdNext = false;
    const p = (async () => {
      if (row.held) {
        if (!row.waitingForDebugger) throw Error("PDF Worker startup was not actually paused");
        await new Promise((r) => row.release = () => {
          row.releasedAt = Date.now();
          delete row.release;
          r();
        });
      }
      await resume(row);
    })();
    jobs.add(p);
    p.catch((error) => errors.push(String(error))).finally(() => jobs.delete(p));
  }));
  off.push(app.onCDP("Target.receivedMessageFromTarget", (e) => {
    const m = JSON.parse(e.message);
    if (m.method === "Debugger.paused") {
      const row = rows.find((r) => r.sessionId === e.sessionId);
      if (row) row.pausedAt = Date.now();
    }
    const key = e.sessionId + ":" + m.id, job = pending.get(key);
    if (job) {
      pending.delete(key);
      clearTimeout(job.timer);
      m.error ? job.reject(Error(m.error.message)) : job.resolve(m.result);
    }
  }));
  const ended = (e, field) => {
    const row = rows.find((r) => field === "destroyedAt" ? r.targetId === e.targetId : r.sessionId === e.sessionId);
    if (!row) return;
    row[field] = Date.now();
    row.release?.();
    for (const [key, job] of pending) if (job.row === row) {
      pending.delete(key);
      clearTimeout(job.timer);
      job.reject(Error("PDF Worker target terminated"));
    }
  };
  off.push(app.onCDP("Target.detachedFromTarget", (e) => ended(e, "detachedAt")), app.onCDP("Target.targetDestroyed", (e) => ended(e, "destroyedAt")));
  await app.cdp("Target.setDiscoverTargets", { discover: true, filter: [{ type: "worker" }, { exclude: true }] });
  await app.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: false, filter: [{ type: "worker" }, { exclude: true }] });
  return { rows, errors, holdNext: () => {
    holdNext = true;
    return true;
  }, releaseAll: () => {
    for (const row of rows) row.release?.();
  }, snapshot: () => rows.map(({ release, ...row }) => ({ ...row })), request, pause: async (row) => {
    await request(row, "Debugger.enable");
    await request(row, "Debugger.pause");
  }, crash: (row) => request(row, "Runtime.evaluate", { expression: "setTimeout(()=>{throw new Error('DEV137 controlled native PDF Worker crash')},0);true", returnByValue: true }), exit: (row) => request(row, "Runtime.evaluate", { expression: "close();true", returnByValue: true }), close: async () => {
    holdNext = false;
    for (const row of rows) row.release?.();
    await Promise.all([...jobs]);
    await app.cdp("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: false });
    await app.cdp("Target.setDiscoverTargets", { discover: false });
    off.forEach((f) => f());
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(Error("PDF target observation closed"));
    }
    pending.clear();
    return { rows: rows.map(({ release, ...row }) => ({ ...row })), errors: [...errors], restored: true };
  } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  observePdfWorkers
});
